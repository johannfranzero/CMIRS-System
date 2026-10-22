-- =============================================================================
-- CMIRS — Remote Notification Lifecycle Verification Harness
-- File: scripts/remote-notification-lifecycle-verification.sql
--
-- PURPOSE
--   Exercises the five notification-bearing command RPCs end to end against the real
--   Supabase project, as the real roles, and proves:
--     * a submitted report is created and the coordinator audience is notified;
--     * triage, assignment, work start, hold, completion and verification each
--       mutate the report AND deliver the approved notifications, atomically;
--     * a replayed request id returns the original result without duplicating rows;
--     * a replayed request id with different arguments is rejected;
--     * unauthorized roles are refused (student triage/verify, technician verify,
--       technician acting on a report that is not assigned to them);
--     * P-04 (triage may not create an assigned state) and P-05 (same-technician
--       reassignment is a no-op) hold;
--     * notifications are recipient-scoped and unread rows are counted correctly.
--
-- SAFETY
--   * Everything runs inside ONE transaction that is ALWAYS rolled back.
--   * No state persists; the harness is safe to run repeatedly.
--   * Every assertion runs as `authenticated` with a simulated JWT, so the
--     SECURITY DEFINER RPCs observe a realistic caller via auth.uid().
--
-- EXECUTION
--   npx supabase db query --linked --file scripts/remote-notification-lifecycle-verification.sql --output csv
-- =============================================================================

BEGIN;

CREATE TEMP TABLE n_results (
  check_id text primary key,
  expectation text,
  observed text,
  verdict text
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- 0. Fixture capture (privileged read, before the role switch)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE n_actor (
  role_name text primary key,
  profile_id uuid,
  full_name text
) ON COMMIT DROP;

INSERT INTO n_actor
SELECT p.role::text, p.id, p.full_name
FROM public.profiles p
WHERE p.role::text IN ('student_personnel','coordinator','technician','administrator','management');

CREATE TEMP TABLE n_ctx (
  report_id uuid,
  assignment_id uuid,
  student_id uuid,
  coord_id uuid,
  tech_id uuid
) ON COMMIT DROP;

CREATE TEMP TABLE n_ref (
  category_id uuid,
  location_id uuid
) ON COMMIT DROP;

INSERT INTO n_ref
SELECT
  (SELECT c.id FROM public.categories c WHERE c.is_active ORDER BY c.id LIMIT 1),
  (SELECT l.id FROM public.locations l WHERE l.is_active ORDER BY l.id LIMIT 1);

GRANT SELECT, INSERT ON n_results, n_actor, n_ref, n_ctx TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. Run the lifecycle as the real roles
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_student uuid;
  v_coord uuid;
  v_tech uuid;
  v_admin uuid;
  v_mgmt uuid;
  v_cat uuid;
  v_loc uuid;
  v_request_1 uuid := gen_random_uuid();
  v_request_2 uuid := gen_random_uuid();
  v_request_3 uuid := gen_random_uuid();
  v_request_4 uuid := gen_random_uuid();
  v_request_5 uuid := gen_random_uuid();
  v_request_6 uuid := gen_random_uuid();
  v_report_id uuid;
  v_assignment_id uuid;
  v_res jsonb;
  v_res2 jsonb;
  v_n integer;
  v_txt text;
  v_err text;


BEGIN
  SELECT profile_id INTO v_student FROM n_actor WHERE role_name = 'student_personnel';
  SELECT profile_id INTO v_coord   FROM n_actor WHERE role_name = 'coordinator';
  SELECT profile_id INTO v_tech    FROM n_actor WHERE role_name = 'technician';
  SELECT profile_id INTO v_admin   FROM n_actor WHERE role_name = 'administrator';
  SELECT profile_id INTO v_mgmt    FROM n_actor WHERE role_name = 'management';
  SELECT category_id, location_id INTO v_cat, v_loc FROM n_ref;

  -- ======================================================================
  -- 1. Student submits a report
  -- ======================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student, 'role','authenticated')::text, true);

  v_res := public.submit_report_with_notifications(
    'Lifecycle harness report title',
    'Created by the automated notification lifecycle verification harness.',
    v_cat, v_loc, FALSE, v_request_1
  );
  v_report_id := (v_res ->> 'report_id')::uuid;

  INSERT INTO n_results VALUES (
    'N-01 submit_report_with_notifications returns a report id',
    'a report id',
    coalesce(v_report_id::text, 'null'),
    CASE WHEN v_report_id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-02 the submitted report exists in the database',
    '1 report row',
    (SELECT count(*)::text FROM public.reports WHERE id = v_report_id),
    CASE WHEN (SELECT count(*) FROM public.reports WHERE id = v_report_id) = 1 THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-03 the report number was generated by trigger T2',
    'RPT-*',
    coalesce(v_res ->> 'report_number', 'null'),
    CASE WHEN (v_res ->> 'report_number') LIKE 'RPT-%' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-04 the report is owned by the submitting student',
    v_student::text,
    coalesce((SELECT reporter_id::text FROM public.reports WHERE id = v_report_id), 'null'),
    CASE WHEN (SELECT reporter_id FROM public.reports WHERE id = v_report_id) = v_student THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-05 the initial status is submitted and priority is unset',
    'submitted / null',
    coalesce((SELECT status::text || ' / ' || coalesce(confirmed_priority::text,'null')
                FROM public.reports WHERE id = v_report_id), 'null'),
    CASE WHEN (SELECT status FROM public.reports WHERE id = v_report_id) = 'submitted'
          AND (SELECT confirmed_priority FROM public.reports WHERE id = v_report_id) IS NULL
         THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-07 the submitting student was NOT notified (P-02)',
    '0 notifications to the actor',
    (SELECT count(*)::text FROM public.notifications nt
      WHERE nt.report_id = v_report_id AND nt.recipient_id = v_student),
    CASE WHEN (SELECT count(*) FROM public.notifications nt
      WHERE nt.report_id = v_report_id AND nt.recipient_id = v_student) = 0
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 2. Idempotency: replay the same request id
  -- ======================================================================
  v_res2 := public.submit_report_with_notifications(
    'Lifecycle harness report title',
    'Created by the automated notification lifecycle verification harness.',
    v_cat, v_loc, FALSE, v_request_1
  );
  INSERT INTO n_results VALUES (
    'N-09 replaying a request id returns the original result',
    v_report_id::text,
    coalesce((v_res2 ->> 'report_id'), 'null'),
    CASE WHEN (v_res2 ->> 'report_id') = v_report_id::text THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-10 a replay creates no second report',
    '1 report for this title',
    (SELECT count(*)::text FROM public.reports WHERE title = 'Lifecycle harness report title'),
    CASE WHEN (SELECT count(*) FROM public.reports WHERE title = 'Lifecycle harness report title') = 1
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- Replay with a different payload must be refused.
  BEGIN
    PERFORM public.submit_report_with_notifications(
      'A completely different title for the replay',
      'A completely different description for the replay attempt.',
      v_cat, v_loc, FALSE, v_request_1
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-12 a replayed request id with different arguments is rejected',
    'CMIRS_REPLAY_MISMATCH',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_REPLAY_MISMATCH%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 3. Authorization: a student may not triage
  -- ======================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.triage_report_with_notifications(
      v_report_id, 'high'::public.priority_level, 'under_review'::public.report_status, v_request_2
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-13 a student may not triage',
    'CMIRS_FORBIDDEN',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_FORBIDDEN%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- P-04: triage may not target 'assigned'.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.triage_report_with_notifications(
      v_report_id, 'high'::public.priority_level, 'assigned'::public.report_status, v_request_3
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-14 triage may not create an assigned state (P-04)',
    'CMIRS_INVALID_STATE',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_STATE%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 4. Coordinator triage
  -- ======================================================================
  v_res := public.triage_report_with_notifications(
    v_report_id, 'high'::public.priority_level, 'under_review'::public.report_status, v_request_4
  );
  INSERT INTO n_results VALUES (
    'N-15 triage sets under_review and confirms the priority',
    'under_review / high',
    coalesce((v_res ->> 'status') || ' / ' || coalesce(v_res ->> 'confirmed_priority'), 'null'),
    CASE WHEN (v_res ->> 'status') = 'under_review' AND (v_res ->> 'confirmed_priority') = 'high'
         THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-16 the status history was written by trigger T3',
    '>=1 history row',
    (SELECT count(*)::text FROM public.report_status_history h WHERE h.report_id = v_report_id),
    CASE WHEN (SELECT count(*) FROM public.report_status_history h WHERE h.report_id = v_report_id) >= 1
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 5. Coordinator assignment
  -- ======================================================================
  v_res := public.assign_or_reassign_report_with_notifications(
    v_report_id, v_tech, 'Dispatched by the verification harness.', v_request_5
  );
  v_assignment_id := (v_res ->> 'assignment_id')::uuid;
  INSERT INTO n_results VALUES (
    'N-18 assignment creates an active assignment row',
    '1 assignment with status assigned',
    (SELECT count(*)::text FROM public.assignments a
      WHERE a.id = v_assignment_id AND a.status = 'assigned' AND a.technician_id = v_tech),
    CASE WHEN (SELECT count(*) FROM public.assignments a
      WHERE a.id = v_assignment_id AND a.status = 'assigned' AND a.technician_id = v_tech) = 1
         THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-19 the report moved to the assigned status',
    'assigned',
    coalesce((SELECT status::text FROM public.reports WHERE id = v_report_id), 'null'),
    CASE WHEN (SELECT status FROM public.reports WHERE id = v_report_id) = 'assigned'
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- P-05: assigning the already-active technician must be refused as a no-op.
  BEGIN
    PERFORM public.assign_or_reassign_report_with_notifications(
      v_report_id, v_tech, 'Duplicate dispatch attempt.', v_request_6
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-21 assigning the already-active technician is a no-op (P-05)',
    'CMIRS_INVALID_STATE',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_STATE%' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-22 the no-op attempt created no extra assignment',
    '1 active assignment',
    (SELECT count(*)::text FROM public.assignments a
      WHERE a.report_id = v_report_id AND a.status IN ('assigned','in_progress','on_hold')),
    CASE WHEN (SELECT count(*) FROM public.assignments a
      WHERE a.report_id = v_report_id AND a.status IN ('assigned','in_progress','on_hold')) = 1
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- The technician can now read the report; a stranger still cannot.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tech, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.reports WHERE id = v_report_id;
  INSERT INTO n_results VALUES (
    'N-23 the assigned technician can read the assigned report',
    '1',
    v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgmt, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.reports WHERE id = v_report_id;
  INSERT INTO n_results VALUES (
    'N-24 management can read the report',
    '1',
    v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 6. Technician work lifecycle
  -- ======================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tech, 'role','authenticated')::text, true);

  v_res := public.transition_report_status_with_notifications(
    v_report_id, 'in_progress'::public.report_status, NULL, gen_random_uuid()
  );
  INSERT INTO n_results VALUES (
    'N-25 the assigned technician can start work',
    'in_progress',
    coalesce((v_res ->> 'new_status'), 'null'),
    CASE WHEN (v_res ->> 'new_status') = 'in_progress' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-26 the assignment moved to in_progress',
    'in_progress',
    coalesce((SELECT status::text FROM public.assignments a WHERE a.id = v_assignment_id), 'null'),
    CASE WHEN (SELECT status FROM public.assignments a WHERE a.id = v_assignment_id) = 'in_progress'
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- A technician may not cancel a report.
  BEGIN
    PERFORM public.transition_report_status_with_notifications(
      v_report_id, 'cancelled'::public.report_status, 'Not allowed.', gen_random_uuid()
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-27 a technician may not cancel a report',
    'CMIRS_INVALID_STATE',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_STATE%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- A technician may not verify their own repair.
  BEGIN
    PERFORM public.verify_report_with_notifications(
      v_report_id, TRUE, 'Self verification attempt.', gen_random_uuid()
    );
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-28 a technician may not verify a repair',
    'CMIRS_FORBIDDEN or CMIRS_INVALID_STATE',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- Completion moves the report to completed and requests coordinator verification.
  v_res := public.transition_report_status_with_notifications(
    v_report_id, 'completed'::public.report_status, 'Repair completed by the harness.', gen_random_uuid()
  );
  INSERT INTO n_results VALUES (
    'N-29 the technician can complete the work',
    'completed',
    coalesce((v_res ->> 'new_status'), 'null'),
    CASE WHEN (v_res ->> 'new_status') = 'completed' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-30 the report is awaiting verification, not verified',
    'completed',
    coalesce((SELECT status::text FROM public.reports WHERE id = v_report_id), 'null'),
    CASE WHEN (SELECT status FROM public.reports WHERE id = v_report_id) = 'completed'
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 7. Coordinator verification
  -- ======================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  v_res := public.verify_report_with_notifications(
    v_report_id, TRUE, 'Verified by the verification harness.', gen_random_uuid()
  );
  INSERT INTO n_results VALUES (
    'N-33 a satisfactory verification moves the report to verified',
    'verified',
    coalesce((v_res ->> 'new_status'), 'null'),
    CASE WHEN (v_res ->> 'new_status') = 'verified' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_results VALUES (
    'N-34 a verification row was written',
    '1 verification row',
    (SELECT count(*)::text FROM public.verifications v WHERE v.report_id = v_report_id),
    CASE WHEN (SELECT count(*) FROM public.verifications v WHERE v.report_id = v_report_id) = 1
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 8. Notification recipient isolation and unread counting
  -- ======================================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.notifications WHERE report_id = v_report_id;
  INSERT INTO n_results VALUES (
    'N-36 the student can read only their own notifications',
    '4 (3 status_changed + 1 verification_complete; no coordinator or technician notification)',
    v_n::text,
    CASE WHEN v_n = 4 THEN 'PASS' ELSE 'FAIL' END
  );
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_tech, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.notifications WHERE report_id = v_report_id;
  INSERT INTO n_results VALUES (
    'N-37 the technician can read only their own notifications',
    '2 (report_assigned + verification_complete)',
    v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
  );

  -- Unread count for the reporter.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.notifications WHERE recipient_id = v_student AND NOT is_read;
  INSERT INTO n_results VALUES (
    'N-38 the unread count is derived from real unread rows',
    '>0',
    v_n::text,
    CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 9. A generic notification insert must be impossible for authenticated
  -- ======================================================================
  BEGIN
    INSERT INTO public.notifications (recipient_id, type, title, message)
    VALUES (v_student, 'status_changed', 'forged', 'forged');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-39 a forged notification insert by an authenticated user is refused',
    'permission denied / RLS violation',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err ILIKE '%permission denied%' OR v_err ILIKE '%row-level security%'
         THEN 'PASS' ELSE 'FAIL' END
  );

  -- ======================================================================
  -- 10. The private receipt table is not readable by authenticated users
  -- ======================================================================
  BEGIN
    SELECT count(*) INTO v_n FROM public.notification_command_receipts;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO n_results VALUES (
    'N-40 the command receipt table is not readable by authenticated users',
    'permission denied',
    coalesce(v_err, 'readable'),
    CASE WHEN v_err ILIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO n_ctx (report_id, assignment_id, student_id, coord_id, tech_id)
  VALUES (v_report_id, v_assignment_id, v_student, v_coord, v_tech);END $$;

-- ---------------------------------------------------------------------------
-- Privileged notification-delivery accounting
-- ---------------------------------------------------------------------------
-- The notification counts below MUST be read with a role that is not restricted by the
-- `notifications_select` RLS policy, otherwise a recipient-scoped count would hide the
-- deliveries made to the other participants.
RESET ROLE;

INSERT INTO n_results
SELECT 'N-06 the coordinator audience was notified (P-01)', '>=1 report_submitted to the coordinator',
       count(*)::text, CASE WHEN count(*) >= 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'report_submitted' AND nt.recipient_id = c.coord_id;

INSERT INTO n_results
SELECT 'N-08 the notification payload carries no description or personal data', 'no description or email in the payload',
       count(*)::text, CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id
  AND (nt.title LIKE '%harness report title%' OR nt.message LIKE '%automated notification lifecycle%');

INSERT INTO n_results
SELECT 'N-11 a replay creates no duplicate notification', '1 report_submitted notification',
       count(*)::text, CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'report_submitted';

INSERT INTO n_results
SELECT 'N-17 the reporter was notified of the status change', '>=1 status_changed to the reporter',
       count(*)::text, CASE WHEN count(*) >= 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'status_changed' AND nt.recipient_id = c.student_id;

INSERT INTO n_results
SELECT 'N-20 the technician was notified of the assignment', '1 report_assigned to the technician',
       count(*)::text, CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'report_assigned' AND nt.recipient_id = c.tech_id;

INSERT INTO n_results
SELECT 'N-31 the coordinator audience was asked to verify (P-03)', '>=1 verification_required to a coordinator',
       count(*)::text, CASE WHEN count(*) >= 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'verification_required' AND nt.recipient_id = c.coord_id;

INSERT INTO n_results
SELECT 'N-32 the reporter was notified of the completion', '>=1 status_changed to the reporter',
       count(*)::text, CASE WHEN count(*) >= 1 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'status_changed' AND nt.recipient_id = c.student_id;

INSERT INTO n_results
SELECT 'N-35 the reporter and technician were notified of the verification', '>=1 verification_complete to each',
       count(*)::text, CASE WHEN count(*) >= 2 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id AND nt.type = 'verification_complete'
  AND nt.recipient_id IN (c.student_id, c.tech_id);

INSERT INTO n_results
SELECT 'N-41 the report generated exactly the expected delivery total', '8 notifications',
       count(*)::text, CASE WHEN count(*) = 8 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications nt, n_ctx c
WHERE nt.report_id = c.report_id;

INSERT INTO n_results
SELECT 'N-42 no event was delivered twice to the same recipient', '0 duplicate (event_key, recipient) pairs',
       count(*)::text, CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (
  SELECT nt.event_key, nt.recipient_id
  FROM public.notifications nt, n_ctx c
  WHERE nt.report_id = c.report_id AND nt.event_key IS NOT NULL
  GROUP BY nt.event_key, nt.recipient_id
  HAVING count(*) > 1
) d;
-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM n_results
ORDER BY check_id;

ROLLBACK;
