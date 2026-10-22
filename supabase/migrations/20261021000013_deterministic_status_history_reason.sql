-- CMIRS Migration 13: Deterministic Status-History Reason Attachment
-- Phase 4G: technician work-completion workflow repair (audit-trail integrity).
--
-- =============================================================================
-- DEFECT
-- =============================================================================
-- `public.transition_report_status_with_notifications` records the transition reason by
-- attaching it to "the most recent status-history row written by this actor":
--
--   UPDATE public.report_status_history h SET reason = btrim(p_reason)
--    WHERE h.id = (
--      SELECT sh.id FROM public.report_status_history sh
--      WHERE sh.report_id = p_report_id
--        AND sh.changed_by = v_actor
--      ORDER BY sh.created_at DESC, sh.id DESC
--      LIMIT 1
--    );
--
-- Two properties of the schema make that selection non-deterministic:
--
--   1. Trigger T3 writes `created_at = now()`, and `now()` is the TRANSACTION start time.
--      Every history row written inside one transaction therefore carries an IDENTICAL
--      `created_at`, so `ORDER BY created_at DESC` cannot discriminate between them.
--   2. The tie is broken by `id DESC` on a random UUID, which picks an arbitrary row.
--
-- The consequence is an AUDIT-TRAIL CORRUPTION: when the same actor performs more than one
-- status change inside a single transaction, the reason can be attached to the wrong history
-- row. The technician's repair completion notes could, for example, be recorded against the
-- preceding 'in_progress' row instead of the 'completed' row, and the coordinator would then
-- read an empty completion note at verification time.
--
-- This was detected by `scripts/remote-technician-workflow-verification.sql` (check W-07b),
-- which failed intermittently across repeated runs.
--
-- =============================================================================
-- REPAIR
-- =============================================================================
-- The reason is now attached to the history row that corresponds to THIS transition, matched
-- on the full transition identity: the report, the actor, the previous status and the new
-- status. Trigger T3 writes exactly one row per status change, so this identifies the correct
-- row deterministically for every transition the command performs.
--
-- Nothing else changes: the authorization rules, the state machine, the notification delivery,
-- the privileges, the schema, the policies, and the data are all untouched. The function is
-- replaced with a body that is byte-identical to migration 012 apart from this selection.
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
  v_lock RECORD;
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

  IF p_target_status IN ('on_hold', 'cancelled', 'completed')
     AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: a reason is required for this status change'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_status = 'completed'
     AND (p_reason IS NULL OR length(btrim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: repair completion notes of at least 5 characters are required'
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
  -- Attach the reason to the history row that corresponds to THIS transition. The row is
  -- identified by the full transition identity (report, actor, previous status, new status)
  -- because T3 writes exactly one row per status change. Selecting "the most recent row by
  -- this actor" would be ambiguous: T3 stamps every row with `now()`, which is the
  -- transaction start time, so several rows in one transaction share a `created_at` and the
  -- UUID tie-break picks an arbitrary one.
  IF p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN
    UPDATE public.report_status_history h
       SET reason = btrim(p_reason)
     WHERE h.id = (
       SELECT sh.id FROM public.report_status_history sh
       WHERE sh.report_id = p_report_id
         AND sh.changed_by = v_actor
         AND sh.new_status = p_target_status
         AND sh.previous_status IS NOT DISTINCT FROM v_previous
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

REVOKE ALL ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) TO authenticated;
