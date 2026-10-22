-- CMIRS Migration 7: Notification Lifecycle Command RPCs
-- Phase 4C implementation (approved design: PHASE_4C_2_NOTIFICATION_BACKEND_SPEC.md,
-- decisions PHASE_4C_6_OWNER_DECISION_SUMMARY.md P-01..P-10, S-01..S-07, I-01..I-06)
--
-- =============================================================================
-- SCOPE
-- =============================================================================
-- Additive only. This migration:
--   * adds a private command-receipt table and an event-key column/index;
--   * adds five narrow, hardened SECURITY DEFINER command RPCs that perform the report
--     lifecycle mutation AND its notifications in ONE transaction;
--   * adds two private helper functions that are callable only by those RPCs;
--   * removes the generic authenticated INSERT/DELETE privilege on public.notifications.
--
-- It does NOT create, drop or alter any RLS policy, and it does not touch any existing
-- table's data. The direct authenticated lifecycle policies are deliberately RETAINED
-- (I-02 / S-06: the restriction release is a separate, gated step that may only happen
-- after every legitimate writer has been converted and verified).
--
-- =============================================================================
-- APPROVED PRODUCT DECISIONS IMPLEMENTED HERE
-- =============================================================================
-- P-01  Coordinator audience ............ all ACTIVE coordinators.
-- P-02  Actor notification .............. the actor is NEVER a recipient.
-- P-03  Completed event ................. `completed` emits BOTH `status_changed`
--                                          (reporter + technician) and
--                                          `verification_required` (active coordinators).
-- P-04  Triage without assignment ....... triage may ONLY target 'under_review';
--                                          the assignment RPC owns 'assigned'.
-- P-05  Same-technician reassignment ... rejected as a no-op, with no notification.
-- P-06  Priority event ................. DEFERRED - not emitted by this slice.
-- P-07  Comment event ................. DEFERRED - not emitted by this slice.
-- P-08  Decline event ................. DEFERRED - not emitted by this slice.
-- P-09  Urgent presentation ........... `report_submitted` with a minimal urgent marker.
-- P-10  Read model .................... `is_read` only; no `read_at` column is added.
--
-- =============================================================================
-- SECURITY CONTROLS (S-01..S-05)
-- =============================================================================
-- S-01  Narrow SECURITY DEFINER command RPCs provide the transaction boundary.
-- S-03  p_request_id + the receipt table make a replay return the original result
--       without repeating the source mutation or the notification delivery.
-- S-04  Notification rows can only be created by the private helper, which is not
--       executable by `authenticated`; there is no generic insert path.
-- S-05  Every function is SECURITY DEFINER with a fixed search_path, derives the actor
--       from auth.uid() only, re-checks role and state internally, and is granted
--       EXECUTE to `authenticated` only.
-- S-07  Any failure rolls back the receipt, the report/assignment mutation and the
--       notification rows together.
-- =============================================================================

-- =============================================================================
-- 1. Additive schema: command receipts and per-recipient event keys
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.notification_command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  command_name TEXT NOT NULL,
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  report_id UUID NULL REFERENCES public.reports(id) ON DELETE SET NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_command_receipts_actor_command_request_key
  ON public.notification_command_receipts (actor_id, command_name, request_id);

CREATE INDEX IF NOT EXISTS notification_command_receipts_created_at
  ON public.notification_command_receipts (created_at);

-- Per-recipient delivery uniqueness (S-03). Nullable so existing rows are untouched.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_recipient_unique
  ON public.notifications (event_key, recipient_id)
  WHERE event_key IS NOT NULL;

-- S-04: no generic authenticated insert/delete surface on notifications.
REVOKE INSERT, DELETE ON public.notifications FROM authenticated;

-- =============================================================================
-- 2. Private helpers (not executable by `authenticated`)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2.1 notification_deliver()
-- Inserts exactly ONE notification row for ONE server-derived recipient.
-- S-04: the only row-insert surface for public.notifications.
-- P-02: the actor never receives a notification for their own action.
-- S-03: the (event_key, recipient_id) unique index makes delivery idempotent.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_deliver(
  p_actor_id UUID,
  p_recipient_id UUID,
  p_type public.notification_type,
  p_title TEXT,
  p_message TEXT,
  p_report_id UUID,
  p_event_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  -- P-02 (approved): exclude the actor. A null recipient means "no specific recipient",
  -- which is never deliverable, so it is skipped as well.
  IF p_recipient_id IS NULL OR p_recipient_id = p_actor_id THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    recipient_id, type, title, message, report_id, is_read, event_key
  )
  VALUES (
    p_recipient_id, p_type, p_title, p_message, p_report_id, FALSE, p_event_key
  )
  ON CONFLICT (event_key, recipient_id) WHERE event_key IS NOT NULL DO NOTHING;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2.2 notification_receipt_acquire()
-- S-03: acquires (or replays) the per-actor command receipt.
-- Returns jsonb: {"receipt_id": uuid, "replay": boolean, "result": jsonb}
-- A committed receipt with a different payload hash is a replay mismatch and fails.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_receipt_acquire(
  p_actor_id UUID,
  p_command_name TEXT,
  p_request_id UUID,
  p_request_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_receipt_id UUID;
  v_stored_hash TEXT;
  v_result JSONB;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: request id is required'
      USING ERRCODE = '22023';
  END IF;

  LOOP
    BEGIN
      INSERT INTO public.notification_command_receipts (
        actor_id, command_name, request_id, request_hash, report_id, result
      )
      VALUES (
        p_actor_id, p_command_name, p_request_id, p_request_hash, NULL, '{}'::jsonb
      )
      RETURNING id INTO v_receipt_id;

      RETURN jsonb_build_object(
        'receipt_id', v_receipt_id,
        'replay', FALSE,
        'result', NULL
      );
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent or previous invocation owns this key. Lock its receipt and decide.
      SELECT id, request_hash, result
        INTO v_receipt_id, v_stored_hash, v_result
      FROM public.notification_command_receipts
      WHERE actor_id = p_actor_id
        AND command_name = p_command_name
        AND request_id = p_request_id
      FOR UPDATE;

      IF NOT FOUND THEN
        -- The competing transaction rolled back; try to claim the key again.
        CONTINUE;
      END IF;

      IF v_stored_hash <> p_request_hash THEN
        RAISE EXCEPTION 'CMIRS_REPLAY_MISMATCH: request id reused with different arguments'
          USING ERRCODE = '22023';
      END IF;

      RETURN jsonb_build_object(
        'receipt_id', v_receipt_id,
        'replay', TRUE,
        'result', v_result
      );
    END;
  END LOOP;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 2.3 notification_receipt_complete()
-- Stores the minimal successful result on the receipt so a replay can return it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notification_receipt_complete(
  p_receipt_id UUID,
  p_report_id UUID,
  p_result JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
BEGIN
  UPDATE public.notification_command_receipts
     SET report_id = COALESCE(p_report_id, report_id),
         result = p_result
   WHERE id = p_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.notification_deliver(UUID, UUID, public.notification_type, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notification_receipt_acquire(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notification_receipt_complete(UUID, UUID, JSONB) FROM PUBLIC;

-- =============================================================================
-- 3. Command RPC 1: submit_report_with_notifications
-- Replaces the direct authenticated INSERT performed by createReportRecord().
-- =============================================================================
CREATE OR REPLACE FUNCTION public.submit_report_with_notifications(
  p_title TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_location_id UUID,
  p_is_urgent_hazard BOOLEAN,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_role public.user_role;
  v_receipt JSONB;
  v_receipt_id UUID;
  v_replay BOOLEAN;
  v_report_id UUID;
  v_report_number TEXT;
  v_status public.report_status;
  v_created_at TIMESTAMPTZ;
  v_result JSONB;
  v_hash TEXT;
  v_coord RECORD;
  v_event_key TEXT;
BEGIN
  -- Identity / authorization --------------------------------------------------
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CMIRS_NOT_AUTHENTICATED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.is_active;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: no active institutional profile'
      USING ERRCODE = '42501';
  END IF;

  -- Input validation ----------------------------------------------------------
  IF p_title IS NULL OR btrim(p_title) = '' OR length(btrim(p_title)) < 5 OR length(btrim(p_title)) > 150 THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: title must be 5-150 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_description IS NULL OR btrim(p_description) = '' OR length(btrim(p_description)) < 10 OR length(btrim(p_description)) > 2000 THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: description must be 10-2000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_category_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.categories c WHERE c.id = p_category_id AND c.is_active
  ) THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: unknown or inactive category'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = p_location_id AND l.is_active
  ) THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: unknown or inactive location'
      USING ERRCODE = '22023';
  END IF;

  -- Idempotency ----------------------------------------------------------------
  v_hash := md5(
    coalesce(p_title, '') || '|' || coalesce(p_description, '') || '|' ||
    coalesce(p_category_id::text, '') || '|' || coalesce(p_location_id::text, '') || '|' ||
    coalesce(p_is_urgent_hazard::text, 'false')
  );

  v_receipt := public.notification_receipt_acquire(
    v_actor, 'submit_report_with_notifications', p_request_id, v_hash
  );
  v_receipt_id := (v_receipt ->> 'receipt_id')::uuid;
  v_replay := coalesce((v_receipt ->> 'replay')::boolean, FALSE);

  IF v_replay THEN
    RETURN v_receipt -> 'result';
  END IF;

  -- Source mutation ------------------------------------------------------------
  INSERT INTO public.reports (
    title, description, category_id, location_id, is_urgent_hazard,
    reporter_id, status, confirmed_priority
  )
  VALUES (
    btrim(p_title), btrim(p_description), p_category_id, p_location_id,
    coalesce(p_is_urgent_hazard, FALSE), v_actor, 'submitted', NULL
  )
  RETURNING id, report_number, status, created_at
  INTO v_report_id, v_report_number, v_status, v_created_at;

  -- Notifications (P-01 all active coordinators, P-02 exclude the actor) -------
  v_event_key := 'command:' || v_receipt_id::text || ':report_submitted';

  FOR v_coord IN
    SELECT p.id FROM public.profiles p
    WHERE p.role = 'coordinator' AND p.is_active
  LOOP
    PERFORM public.notification_deliver(
      v_actor,
      v_coord.id,
      'report_submitted',
      CASE
        WHEN coalesce(p_is_urgent_hazard, FALSE)
          THEN 'Urgent maintenance report ' || v_report_number
        ELSE 'New maintenance report ' || v_report_number
      END,
      CASE
        WHEN coalesce(p_is_urgent_hazard, FALSE)
          THEN v_report_number || ' was submitted and flagged as an urgent hazard. Triage is required.'
        ELSE v_report_number || ' was submitted and is waiting for triage.'
      END,
      v_report_id,
      v_event_key
    );
  END LOOP;

  -- Result ---------------------------------------------------------------------
  v_result := jsonb_build_object(
    'report_id', v_report_id,
    'report_number', v_report_number,
    'status', v_status::text,
    'created_at', v_created_at
  );

  PERFORM public.notification_receipt_complete(v_receipt_id, v_report_id, v_result);

  RETURN v_result;
END;
$function$;

-- =============================================================================
-- 4. Command RPC 2: triage_report_with_notifications
-- Coordinator-only priority confirmation. P-04: may only target 'under_review'.
-- P-06: the priority event is deferred, so only `status_changed` is emitted.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.triage_report_with_notifications(
  p_report_id UUID,
  p_confirmed_priority public.priority_level,
  p_target_status public.report_status,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_role public.user_role;
  v_receipt JSONB;
  v_receipt_id UUID;
  v_replay BOOLEAN;
  v_status public.report_status;
  v_priority public.priority_level;
  v_reporter UUID;
  v_technician UUID;
  v_result JSONB;
  v_hash TEXT;
  v_event_key TEXT;
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CMIRS_NOT_AUTHENTICATED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.is_active;

  IF v_role IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: only Maintenance Coordinators may triage reports'
      USING ERRCODE = '42501';
  END IF;

  -- P-04 (approved): triage may not create an assigned state. The assignment RPC owns it.
  IF p_target_status != 'under_review' THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: triage may only target the under_review status'
      USING ERRCODE = '22023';
  END IF;

  IF p_confirmed_priority IS NULL THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: a confirmed priority is required'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(
    coalesce(p_report_id::text, '') || '|' ||
    coalesce(p_confirmed_priority::text, '') || '|' ||
    coalesce(p_target_status::text, '')
  );

  v_receipt := public.notification_receipt_acquire(
    v_actor, 'triage_report_with_notifications', p_request_id, v_hash
  );
  v_receipt_id := (v_receipt ->> 'receipt_id')::uuid;
  v_replay := coalesce((v_receipt ->> 'replay')::boolean, FALSE);

  IF v_replay THEN
    RETURN v_receipt -> 'result';
  END IF;

  -- Lock and validate the report -----------------------------------------------
  SELECT r.status, r.reporter_id INTO v_status, v_reporter
  FROM public.reports r
  WHERE r.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CMIRS_NOT_FOUND: report not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('verified', 'cancelled') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: report is already in a terminal state'
      USING ERRCODE = '22023';
  END IF;

  -- Source mutation -------------------------------------------------------------
  UPDATE public.reports
     SET confirmed_priority = p_confirmed_priority,
         status = p_target_status
   WHERE id = p_report_id
  RETURNING status, confirmed_priority INTO v_status, v_priority;

  -- Notifications ---------------------------------------------------------------
  SELECT a.technician_id INTO v_technician
  FROM public.assignments a
  WHERE a.report_id = p_report_id
    AND a.status IN ('assigned', 'in_progress', 'on_hold')
  ORDER BY a.assigned_at DESC
  LIMIT 1;

  v_event_key := 'command:' || v_receipt_id::text || ':status_changed';
  v_title := 'Report status changed';
  v_message := 'A maintenance report you are involved in changed status.';

  PERFORM public.notification_deliver(
    v_actor, v_reporter, 'status_changed', v_title, v_message, p_report_id, v_event_key
  );

  IF v_technician IS NOT NULL THEN
    PERFORM public.notification_deliver(
      v_actor, v_technician, 'status_changed', v_title, v_message, p_report_id, v_event_key
    );
  END IF;

  v_result := jsonb_build_object(
    'report_id', p_report_id,
    'status', v_status::text,
    'confirmed_priority', v_priority::text
  );

  PERFORM public.notification_receipt_complete(v_receipt_id, p_report_id, v_result);

  RETURN v_result;
END;
$function$;

-- =============================================================================
-- 5. Command RPC 3: assign_or_reassign_report_with_notifications
-- Coordinator-only assignment. P-05: reassigning to the already-active technician is
-- rejected as a no-op and produces no notification.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.assign_or_reassign_report_with_notifications(
  p_report_id UUID,
  p_technician_id UUID,
  p_notes TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_role public.user_role;
  v_receipt JSONB;
  v_receipt_id UUID;
  v_replay BOOLEAN;
  v_status public.report_status;
  v_assignment_id UUID;
  v_assignment_status public.assignment_status;
  v_was_reassignment BOOLEAN := FALSE;
  v_previous_tech UUID;
  v_result JSONB;
  v_hash TEXT;
  v_event_key TEXT;
  v_type public.notification_type;
  v_lock RECORD;
  v_title TEXT;
  v_message TEXT;
  v_report_number TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CMIRS_NOT_AUTHENTICATED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.is_active;

  IF v_role IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: only Maintenance Coordinators may assign technicians'
      USING ERRCODE = '42501';
  END IF;

  IF p_technician_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_technician_id AND p.role = 'technician' AND p.is_active
  ) THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: technician must be an active technician account'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(
    coalesce(p_report_id::text, '') || '|' ||
    coalesce(p_technician_id::text, '') || '|' ||
    coalesce(p_notes, '')
  );

  v_receipt := public.notification_receipt_acquire(
    v_actor, 'assign_or_reassign_report_with_notifications', p_request_id, v_hash
  );
  v_receipt_id := (v_receipt ->> 'receipt_id')::uuid;
  v_replay := coalesce((v_receipt ->> 'replay')::boolean, FALSE);

  IF v_replay THEN
    RETURN v_receipt -> 'result';
  END IF;

  -- Lock the report -------------------------------------------------------------
  SELECT r.status, r.report_number INTO v_status, v_report_number
  FROM public.reports r
  WHERE r.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CMIRS_NOT_FOUND: report not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('verified', 'cancelled') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: report is already in a terminal state'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the active assignments in a deterministic order ------------------------
  FOR v_lock IN
    SELECT a.id FROM public.assignments a
    WHERE a.report_id = p_report_id AND a.status IN ('assigned', 'in_progress', 'on_hold')
    ORDER BY a.id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  -- P-05 (approved): reassigning to the already-active technician is a no-op.
  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = p_report_id
      AND a.technician_id = p_technician_id
      AND a.status IN ('assigned', 'in_progress', 'on_hold')
  ) THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: the technician is already assigned to this report'
      USING ERRCODE = '22023';
  END IF;

  -- Close out the previous active assignment ------------------------------------
  SELECT a.technician_id INTO v_previous_tech
  FROM public.assignments a
  WHERE a.report_id = p_report_id AND a.status IN ('assigned', 'in_progress', 'on_hold')
  ORDER BY a.assigned_at DESC
  LIMIT 1;

  IF v_previous_tech IS NOT NULL THEN
    UPDATE public.assignments
       SET status = 'reassigned'
     WHERE report_id = p_report_id AND status IN ('assigned', 'in_progress', 'on_hold');
    v_was_reassignment := TRUE;
  END IF;

  -- Create the new assignment ----------------------------------------------------
  INSERT INTO public.assignments (report_id, technician_id, assigned_by, status, notes)
  VALUES (p_report_id, p_technician_id, v_actor, 'assigned', NULLIF(btrim(coalesce(p_notes, '')), ''))
  RETURNING id, status INTO v_assignment_id, v_assignment_status;

  -- The report becomes assigned -------------------------------------------------
  UPDATE public.reports
     SET status = 'assigned'
   WHERE id = p_report_id AND status IN ('submitted', 'under_review', 'assigned', 'in_progress', 'on_hold');

  -- Notifications -----------------------------------------------------------------
  IF v_was_reassignment THEN
    v_type := 'report_reassigned';
    v_event_key := 'command:' || v_receipt_id::text || ':report_reassigned';
    v_title := 'Report reassigned';
    v_message := 'A maintenance report has been reassigned to a different technician.';
  ELSE
    v_type := 'report_assigned';
    v_event_key := 'command:' || v_receipt_id::text || ':report_assigned';
    v_title := 'New work order assigned';
    v_message := 'A maintenance report has been assigned to you for repair.';
  END IF;

  PERFORM public.notification_deliver(
    v_actor, p_technician_id, v_type, v_title, v_message, p_report_id, v_event_key
  );

  IF v_was_reassignment AND v_previous_tech IS NOT NULL THEN
    PERFORM public.notification_deliver(
      v_actor, v_previous_tech, v_type, v_title, v_message, p_report_id, v_event_key
    );
  END IF;

  v_result := jsonb_build_object(
    'assignment_id', v_assignment_id,
    'report_id', p_report_id,
    'technician_id', p_technician_id,
    'status', v_assignment_status::text,
    'was_reassignment', v_was_reassignment
  );

  PERFORM public.notification_receipt_complete(v_receipt_id, p_report_id, v_result);

  RETURN v_result;
END;
$function$;

-- =============================================================================
-- 6. Command RPC 4: transition_report_status_with_notifications
-- Owns the work-order status transitions. It may not target 'under_review' (triage owns
-- it), 'assigned' (the assignment RPC owns it), or 'verified'/'reopened' (verification owns
-- those). P-03: `completed` emits both `status_changed` and `verification_required`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.transition_report_status_with_notifications(
  p_report_id UUID,
  p_target_status public.report_status,
  p_reason TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_role public.user_role;
  v_receipt JSONB;
  v_receipt_id UUID;
  v_replay BOOLEAN;
  v_status public.report_status;
  v_previous public.report_status;
  v_reporter UUID;
  v_technician UUID;
  v_assignment_id UUID;
  v_result JSONB;
  v_hash TEXT;
  v_event_key TEXT;
  v_coord RECORD;
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CMIRS_NOT_AUTHENTICATED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.is_active;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: no active institutional profile'
      USING ERRCODE = '42501';
  END IF;

  -- Lifecycle ownership boundaries ------------------------------------------------
  IF p_target_status = 'under_review' THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: the under_review status is owned by triage'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_status = 'assigned' THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: the assigned status is owned by the assignment command'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_status IN ('verified', 'reopened') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: verification owns the verified and reopened statuses'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_status NOT IN ('in_progress', 'on_hold', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: unsupported target status'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_status IN ('on_hold', 'cancelled')
     AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: a reason is required for this status change'
      USING ERRCODE = '22023';
  END IF;

  v_hash := md5(
    coalesce(p_report_id::text, '') || '|' ||
    coalesce(p_target_status::text, '') || '|' ||
    coalesce(p_reason, '')
  );

  v_receipt := public.notification_receipt_acquire(
    v_actor, 'transition_report_status_with_notifications', p_request_id, v_hash
  );
  v_receipt_id := (v_receipt ->> 'receipt_id')::uuid;
  v_replay := coalesce((v_receipt ->> 'replay')::boolean, FALSE);

  IF v_replay THEN
    RETURN v_receipt -> 'result';
  END IF;

  -- Lock the report and the active assignment ------------------------------------
  SELECT r.status, r.reporter_id INTO v_status, v_reporter
  FROM public.reports r
  WHERE r.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CMIRS_NOT_FOUND: report not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('verified', 'cancelled') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: report is already in a terminal state'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.id, a.technician_id INTO v_assignment_id, v_technician
  FROM public.assignments a
  WHERE a.report_id = p_report_id AND a.status IN ('assigned', 'in_progress', 'on_hold')
  ORDER BY a.assigned_at DESC
  LIMIT 1
  FOR UPDATE;

  -- Role / relationship authorization --------------------------------------------
  IF v_role = 'student_personnel' THEN
    IF v_reporter <> v_actor THEN
      RAISE EXCEPTION 'CMIRS_FORBIDDEN: reporters may only change their own reports'
        USING ERRCODE = '42501';
    END IF;
    IF p_target_status <> 'cancelled' THEN
      RAISE EXCEPTION 'CMIRS_INVALID_STATE: reporters may only cancel their own reports'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_role = 'technician' THEN
    IF v_technician IS NULL OR v_technician <> v_actor THEN
      RAISE EXCEPTION 'CMIRS_FORBIDDEN: technicians may only update work assigned to them'
        USING ERRCODE = '42501';
    END IF;
    IF p_target_status NOT IN ('in_progress', 'on_hold', 'completed') THEN
      RAISE EXCEPTION 'CMIRS_INVALID_STATE: technicians may only start, hold, or complete their work'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_role = 'coordinator' THEN
    IF p_target_status NOT IN ('in_progress', 'on_hold', 'cancelled') THEN
      RAISE EXCEPTION 'CMIRS_INVALID_STATE: coordinators may only resume, hold, or cancel work'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: this role may not change report status'
      USING ERRCODE = '42501';
  END IF;

  v_previous := v_status;

  -- Source mutation -----------------------------------------------------------------
  UPDATE public.reports
     SET status = p_target_status
   WHERE id = p_report_id;

  -- T3 records the status history automatically, but it never carries the reason.
  -- Attach the reason to the history row this transaction just produced.
  IF p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN
    UPDATE public.report_status_history h
       SET reason = btrim(p_reason)
     WHERE h.id = (
       SELECT sh.id FROM public.report_status_history sh
       WHERE sh.report_id = p_report_id
         AND sh.changed_by = v_actor
       ORDER BY sh.created_at DESC, sh.id DESC
       LIMIT 1
     );
  END IF;

  IF v_assignment_id IS NOT NULL THEN
    IF p_target_status = 'in_progress' THEN
      UPDATE public.assignments
         SET status = 'in_progress',
             started_at = coalesce(started_at, now())
       WHERE id = v_assignment_id;
    ELSIF p_target_status = 'on_hold' THEN
      UPDATE public.assignments SET status = 'on_hold' WHERE id = v_assignment_id;
    ELSIF p_target_status = 'completed' THEN
      UPDATE public.assignments
         SET status = 'completed',
             completed_at = now()
       WHERE id = v_assignment_id;
    ELSIF p_target_status = 'cancelled' THEN
      UPDATE public.assignments SET status = 'cancelled' WHERE id = v_assignment_id;
    END IF;
  END IF;

  -- Notifications ---------------------------------------------------------------------
  v_event_key := 'command:' || v_receipt_id::text || ':status_changed';
  v_title := 'Report status changed';
  v_message := 'A maintenance report you are involved in changed status.';

  PERFORM public.notification_deliver(
    v_actor, v_reporter, 'status_changed', v_title, v_message, p_report_id, v_event_key
  );

  IF v_technician IS NOT NULL THEN
    PERFORM public.notification_deliver(
      v_actor, v_technician, 'status_changed', v_title, v_message, p_report_id, v_event_key
    );
  END IF;

  -- P-03 (approved): `completed` also notifies the coordinator audience.
  IF p_target_status = 'completed' THEN
    v_event_key := 'command:' || v_receipt_id::text || ':verification_required';
    FOR v_coord IN
      SELECT p.id FROM public.profiles p
      WHERE p.role = 'coordinator' AND p.is_active
    LOOP
      PERFORM public.notification_deliver(
        v_actor,
        v_coord.id,
        'verification_required',
        'Repair awaiting verification',
        'A completed maintenance report is waiting for coordinator verification.',
        p_report_id,
        v_event_key
      );
    END LOOP;
  END IF;

  IF p_target_status = 'cancelled' THEN
    v_event_key := 'command:' || v_receipt_id::text || ':report_cancelled';
    PERFORM public.notification_deliver(
      v_actor, v_reporter, 'report_cancelled',
      'Report cancelled', 'A maintenance report was cancelled.', p_report_id, v_event_key
    );
    IF v_technician IS NOT NULL THEN
      PERFORM public.notification_deliver(
        v_actor, v_technician, 'report_cancelled',
        'Report cancelled', 'A maintenance report was cancelled.', p_report_id, v_event_key
      );
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'report_id', p_report_id,
    'previous_status', v_previous::text,
    'new_status', p_target_status::text
  );

  PERFORM public.notification_receipt_complete(v_receipt_id, p_report_id, v_result);

  RETURN v_result;
END;
$function$;

-- =============================================================================
-- 7. Command RPC 5: verify_report_with_notifications
-- Coordinator-only. Requires a `completed` report and separates verification from the
-- reporter and the technician who performed the repair (D2 / PD-R4).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.verify_report_with_notifications(
  p_report_id UUID,
  p_is_satisfactory BOOLEAN,
  p_notes TEXT,
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_role public.user_role;
  v_receipt JSONB;
  v_receipt_id UUID;
  v_replay BOOLEAN;
  v_status public.report_status;
  v_reporter UUID;
  v_technician UUID;
  v_verification_id UUID;
  v_new_status public.report_status;
  v_result JSONB;
  v_hash TEXT;
  v_event_key TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CMIRS_NOT_AUTHENTICATED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.is_active;

  IF v_role IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: only Maintenance Coordinators may verify repairs'
      USING ERRCODE = '42501';
  END IF;

  v_hash := md5(
    coalesce(p_report_id::text, '') || '|' ||
    coalesce(p_is_satisfactory::text, 'false') || '|' ||
    coalesce(p_notes, '')
  );

  v_receipt := public.notification_receipt_acquire(
    v_actor, 'verify_report_with_notifications', p_request_id, v_hash
  );
  v_receipt_id := (v_receipt ->> 'receipt_id')::uuid;
  v_replay := coalesce((v_receipt ->> 'replay')::boolean, FALSE);

  IF v_replay THEN
    RETURN v_receipt -> 'result';
  END IF;

  SELECT r.status, r.reporter_id INTO v_status, v_reporter
  FROM public.reports r
  WHERE r.id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CMIRS_NOT_FOUND: report not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: only a completed report can be verified'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.technician_id INTO v_technician
  FROM public.assignments a
  WHERE a.report_id = p_report_id AND a.status IN ('assigned', 'in_progress', 'on_hold', 'completed')
  ORDER BY a.assigned_at DESC
  LIMIT 1;

  -- Separation of duties (D2 / PD-R4) -------------------------------------------
  IF v_reporter = v_actor THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: a reporter may not verify their own report'
      USING ERRCODE = '42501';
  END IF;

  IF v_technician IS NOT NULL AND v_technician = v_actor THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: the assigned technician may not verify their own repair'
      USING ERRCODE = '42501';
  END IF;

  -- Source mutation -----------------------------------------------------------------
  INSERT INTO public.verifications (report_id, verified_by, is_satisfactory, notes)
  VALUES (p_report_id, v_actor, coalesce(p_is_satisfactory, FALSE), NULLIF(btrim(coalesce(p_notes, '')), ''))
  RETURNING id INTO v_verification_id;

  v_new_status := CASE WHEN coalesce(p_is_satisfactory, FALSE) THEN 'verified'::public.report_status
                       ELSE 'reopened'::public.report_status END;

  UPDATE public.reports SET status = v_new_status WHERE id = p_report_id;

  -- Notifications ---------------------------------------------------------------------
  IF coalesce(p_is_satisfactory, FALSE) THEN
    v_event_key := 'command:' || v_receipt_id::text || ':verification_complete';
    PERFORM public.notification_deliver(
      v_actor, v_reporter, 'verification_complete',
      'Repair verified', 'A maintenance report you reported has been verified as complete.',
      p_report_id, v_event_key
    );
    IF v_technician IS NOT NULL THEN
      PERFORM public.notification_deliver(
        v_actor, v_technician, 'verification_complete',
        'Repair verified', 'Your completed repair has been verified.',
        p_report_id, v_event_key
      );
    END IF;
  ELSE
    v_event_key := 'command:' || v_receipt_id::text || ':verification_failed';
    IF v_technician IS NOT NULL THEN
      PERFORM public.notification_deliver(
        v_actor, v_technician, 'verification_failed',
        'Repair returned for rework', 'A completed repair was returned for further work.',
        p_report_id, v_event_key
      );
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'verification_id', v_verification_id,
    'report_id', p_report_id,
    'is_satisfactory', coalesce(p_is_satisfactory, FALSE),
    'new_status', v_new_status::text
  );

  PERFORM public.notification_receipt_complete(v_receipt_id, p_report_id, v_result);

  RETURN v_result;
END;
$function$;

-- =============================================================================
-- 8. Privileges — S-05: EXECUTE for `authenticated` only, never for PUBLIC.
-- =============================================================================
REVOKE ALL ON FUNCTION public.submit_report_with_notifications(TEXT, TEXT, UUID, UUID, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.triage_report_with_notifications(UUID, public.priority_level, public.report_status, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_or_reassign_report_with_notifications(UUID, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_report_with_notifications(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_report_with_notifications(TEXT, TEXT, UUID, UUID, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.triage_report_with_notifications(UUID, public.priority_level, public.report_status, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_or_reassign_report_with_notifications(UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_report_with_notifications(UUID, BOOLEAN, TEXT, UUID) TO authenticated;

-- The receipt table is an internal implementation detail: no direct access.
REVOKE ALL ON public.notification_command_receipts FROM anon, authenticated;
GRANT SELECT ON public.notification_command_receipts TO postgres;
