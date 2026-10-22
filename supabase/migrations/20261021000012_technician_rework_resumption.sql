-- CMIRS Migration 12: Technician Rework Resumption and Mandatory Repair Notes
-- Phase 4G: technician assignment and work-completion workflow repair.
--
-- =============================================================================
-- WHY THIS MIGRATION EXISTS
-- =============================================================================
-- The Phase 4C notification lifecycle (migration 007) implemented the report lifecycle as five
-- hardened command RPCs. Two gaps in that implementation were found while verifying the
-- technician work-completion workflow end to end:
--
-- GAP 1 — the coordinator's "Return for Further Repair" did not reactivate the assignment.
--   `verify_report_with_notifications` moved the report to 'reopened' and wrote the
--   verification record, but left the technician's assignment in the terminal 'completed'
--   state. Two consequences followed:
--     * the technician could see the work order again (the RLS technician branch accepts any
--       assignment whose status is not 'declined'), but
--     * every technician command refuses an assignment that is not in
--       ('assigned','in_progress','on_hold') — the work_logs insert policy has the same
--       restriction — so the technician could NOT resume the repair.
--   This migration reactivates the assignment to 'in_progress' (and clears `completed_at`)
--   inside the SAME transaction that records the rejection, so the report state and the
--   assignment state can never diverge and no partial lifecycle update is possible.
--
-- GAP 2 — the technician could complete a repair without recording any notes.
--   The application now requires repair completion notes, but the database did not. This
--   migration makes the requirement authoritative at the database boundary: a transition to
--   'completed' without at least 5 characters of repair notes is refused with
--   CMIRS_INVALID_INPUT.
--
-- =============================================================================
-- SCOPE AND SAFETY
-- =============================================================================
--   * Exactly two function bodies are replaced. Both already exist and are replaced with a
--     body that is identical except for the two corrections above.
--   * No table, column, index, trigger, policy, role, grant, or data is created, altered, or
--     removed. No existing authorization rule is relaxed: the role checks, the state checks,
--     the separation-of-duties checks and the notification deliveries are byte-identical.
--   * The approval rules are preserved verbatim: only a coordinator may verify, the reporter
--     and the assigned technician may not verify their own work, and a report may only be
--     verified from the 'completed' status.
--   * Reversible: re-running the migration-007 definitions restores the previous behaviour.
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

  -- Return for further repair (D2 / approved lifecycle):
  -- the work order must become ACTIONABLE again for the same technician, and the assignment
  -- must not stay in a terminal 'completed' state. The assignment is reactivated in the SAME
  -- transaction so the report state and the assignment state can never diverge.
  IF NOT coalesce(p_is_satisfactory, FALSE) AND v_technician IS NOT NULL THEN
    UPDATE public.assignments
       SET status = 'in_progress',
           completed_at = NULL
     WHERE report_id = p_report_id
       AND technician_id = v_technician
       AND status = 'completed';
  END IF;

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
-- Privileges — unchanged from migration 007.
-- =============================================================================
REVOKE ALL ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_report_with_notifications(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_report_with_notifications(UUID, BOOLEAN, TEXT, UUID) TO authenticated;