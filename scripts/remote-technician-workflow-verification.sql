-- =============================================================================
-- CMIRS — Remote Technician Assignment & Work-Completion Workflow Verification
-- File: scripts/remote-technician-workflow-verification.sql
--
-- Exercises the complete technician workflow against the real Supabase project:
--   W-01  the coordinator can assign an existing, eligible technician account
--   W-02  the assignment is persisted with an assignment date
--   W-03  the assigned technician can read the work order
--   W-04  an unrelated authenticated user cannot read the work order
--   W-05  the technician can start the work
--   W-06  completing WITHOUT repair notes is refused
--   W-07  completing WITH repair notes succeeds and the notes are recorded
--   W-08  the report is awaiting verification, not verified
--   W-09  the coordinator can inspect the technician's notes
--   W-10  the technician may not verify their own repair
--   W-11  a satisfactory verification resolves the report
--   W-12  a rejected verification returns the report for further repair
--   W-13  the assignment is reactivated so the work order is actionable again
--   W-14  the technician can resume the returned work
--   W-15  the audit history is preserved across the whole lifecycle
--
-- SAFETY: everything runs inside ONE transaction that is ALWAYS rolled back.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE wf_results (
  check_id text primary key,
  expectation text,
  observed text,
  verdict text
) ON COMMIT DROP;

CREATE TEMP TABLE wf_actor (
  role_name text primary key,
  profile_id uuid
) ON COMMIT DROP;

INSERT INTO wf_actor
SELECT p.role::text, p.id
FROM public.profiles p
WHERE p.role::text IN ('student_personnel','coordinator','technician','administrator');

GRANT SELECT, INSERT ON wf_results, wf_actor TO authenticated;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_student uuid;
  v_coord uuid;
  v_tech uuid;
  v_admin uuid;
  v_cat uuid;
  v_loc uuid;
  v_report uuid;
  v_assignment uuid;
  v_req1 uuid := gen_random_uuid();
  v_req2 uuid := gen_random_uuid();
  v_req3 uuid := gen_random_uuid();
  v_req4 uuid := gen_random_uuid();
  v_req5 uuid := gen_random_uuid();
  v_req6 uuid := gen_random_uuid();
  v_req7 uuid := gen_random_uuid();
  v_req8 uuid := gen_random_uuid();
  v_res jsonb;
  v_n integer;
  v_txt text;
  v_err text;
  v_status text;
  v_reason text;
BEGIN
  SELECT profile_id INTO v_student FROM wf_actor WHERE role_name = 'student_personnel';
  SELECT profile_id INTO v_coord   FROM wf_actor WHERE role_name = 'coordinator';
  SELECT profile_id INTO v_tech    FROM wf_actor WHERE role_name = 'technician';
  SELECT profile_id INTO v_admin   FROM wf_actor WHERE role_name = 'administrator';

  SELECT c.id INTO v_cat FROM public.categories c WHERE c.is_active ORDER BY c.id LIMIT 1;
  SELECT l.id INTO v_loc FROM public.locations l WHERE l.is_active ORDER BY l.id LIMIT 1;

  -- -------------------------------------------------------------------
  -- 1. The student submits, the coordinator triages and assigns
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role','authenticated')::text, true);

  v_res := public.submit_report_with_notifications(
    'Technician workflow harness report',
    'Created by the technician workflow verification harness to exercise the full lifecycle.',
    v_cat, v_loc, FALSE, v_req1);
  v_report := (v_res ->> 'report_id')::uuid;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_coord, 'role','authenticated')::text, true);

  PERFORM public.triage_report_with_notifications(
    v_report, 'medium'::public.priority_level, 'under_review'::public.report_status, v_req2);

  v_res := public.assign_or_reassign_report_with_notifications(
    v_report, v_tech, 'Dispatched by the technician workflow harness.', v_req3);
  v_assignment := (v_res ->> 'assignment_id')::uuid;

  INSERT INTO wf_results VALUES (
    'W-01 the coordinator assigned an existing, eligible technician account',
    'an assignment id and the technician id',
    coalesce((v_res ->> 'assignment_id') || ' / ' || (v_res ->> 'technician_id'), 'null'),
    CASE WHEN (v_res ->> 'assignment_id') IS NOT NULL
          AND (v_res ->> 'technician_id') = v_tech::text
         THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT count(*) INTO v_n
  FROM public.assignments a
  WHERE a.id = v_assignment AND a.report_id = v_report
    AND a.technician_id = v_tech AND a.status = 'assigned'
    AND a.assigned_by = v_coord AND a.assigned_at IS NOT NULL;

  INSERT INTO wf_results VALUES (
    'W-02 the assignment is persisted with a technician, a dispatcher and an assignment date',
    '1 assignment row',
    v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 2. Visibility
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_tech, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.reports WHERE id = v_report;

  INSERT INTO wf_results VALUES (
    'W-03 the assigned technician can read the work order',
    '1',
    v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.reports WHERE id = v_report;

  INSERT INTO wf_results VALUES (
    'W-04 an unrelated authenticated user cannot read the work order',
    '0',
    v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 3. The technician starts the work
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_tech, 'role','authenticated')::text, true);

  v_res := public.transition_report_status_with_notifications(
    v_report, 'in_progress'::public.report_status, NULL, v_req4);

  INSERT INTO wf_results VALUES (
    'W-05 the assigned technician can start the work',
    'in_progress',
    coalesce(v_res ->> 'new_status', 'null'),
    CASE WHEN (v_res ->> 'new_status') = 'in_progress' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 4. Completing without repair notes is refused
  -- -------------------------------------------------------------------
  BEGIN
    PERFORM public.transition_report_status_with_notifications(
      v_report, 'completed'::public.report_status, NULL, v_req5);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO wf_results VALUES (
    'W-06 completing without repair notes is refused',
    'CMIRS_INVALID_INPUT',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_INPUT%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- The report must NOT have moved to completed.
  SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
  INSERT INTO wf_results VALUES (
    'W-06b the report did not move to completed after the refused completion',
    'in_progress',
    coalesce(v_status, 'null'),
    CASE WHEN v_status = 'in_progress' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 5. Completing WITH repair notes
  -- -------------------------------------------------------------------
  v_res := public.transition_report_status_with_notifications(
    v_report, 'completed'::public.report_status,
    'Replaced the leaking isolation valve and pressure-tested the line to 6 bar.', v_req6);

  INSERT INTO wf_results VALUES (
    'W-07 completing with repair notes succeeds',
    'completed',
    coalesce(v_res ->> 'new_status', 'null'),
    CASE WHEN (v_res ->> 'new_status') = 'completed' THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT reason INTO v_reason
  FROM public.report_status_history h
  WHERE h.report_id = v_report AND h.new_status = 'completed'
  ORDER BY h.created_at DESC, h.id DESC LIMIT 1;

  INSERT INTO wf_results VALUES (
    'W-07b the repair notes are recorded in the status history for the coordinator to read',
    'the technician notes are stored',
    coalesce(v_reason, 'null'),
    CASE WHEN v_reason IS NOT NULL
          AND v_reason LIKE '%Replaced the leaking isolation valve%'
         THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
  INSERT INTO wf_results VALUES (
    'W-08 the report is awaiting verification, not resolved',
    'completed',
    coalesce(v_status, 'null'),
    CASE WHEN v_status = 'completed' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 6. The coordinator inspects the notes and verifies
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_coord, 'role','authenticated')::text, true);

  SELECT count(*) INTO v_n
  FROM public.report_status_history h
  WHERE h.report_id = v_report AND h.new_status = 'completed' AND h.reason IS NOT NULL;

  INSERT INTO wf_results VALUES (
    'W-09 the coordinator can inspect the technician completion notes',
    '>=1 history row with notes',
    v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
  );

  -- The technician may not verify their own repair.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_tech, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.verify_report_with_notifications(
      v_report, TRUE, 'Self verification attempt.', v_req7);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO wf_results VALUES (
    'W-10 the technician may not verify their own repair',
    'CMIRS_FORBIDDEN',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_FORBIDDEN%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- A student may not verify.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_student, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.verify_report_with_notifications(
      v_report, TRUE, 'Reporter verification attempt.', v_req7);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO wf_results VALUES (
    'W-10b the reporter may not verify their own report',
    'CMIRS_FORBIDDEN',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_FORBIDDEN%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- A non-coordinator may not verify.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.verify_report_with_notifications(
      v_report, TRUE, 'Administrator verification attempt.', v_req7);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO wf_results VALUES (
    'W-10c a non-coordinator may not verify',
    'CMIRS_FORBIDDEN',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_FORBIDDEN%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 7. A satisfactory verification resolves the report (second scenario)
  -- -------------------------------------------------------------------
  DECLARE
    v_report2 uuid;
    v_res2 jsonb;
    v_err2 text;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_student, 'role','authenticated')::text, true);

    v_res2 := public.submit_report_with_notifications(
      'Satisfactory verification harness report',
      'Second scenario used to verify that a satisfactory inspection resolves the report.',
      v_cat, v_loc, FALSE, gen_random_uuid());
    v_report2 := (v_res2 ->> 'report_id')::uuid;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_coord, 'role','authenticated')::text, true);
    PERFORM public.triage_report_with_notifications(
      v_report2, 'low'::public.priority_level, 'under_review'::public.report_status, gen_random_uuid());
    PERFORM public.assign_or_reassign_report_with_notifications(
      v_report2, v_tech, 'Dispatched for the verification harness.', gen_random_uuid());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_tech, 'role','authenticated')::text, true);
    PERFORM public.transition_report_status_with_notifications(
      v_report2, 'in_progress'::public.report_status, NULL, gen_random_uuid());
    PERFORM public.transition_report_status_with_notifications(
      v_report2, 'completed'::public.report_status,
      'Replaced the faulty ballast and confirmed stable output.', gen_random_uuid());

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_coord, 'role','authenticated')::text, true);
    v_res2 := public.verify_report_with_notifications(
      v_report2, TRUE, 'Inspected the repair; the work meets the required standard.', gen_random_uuid());

    INSERT INTO wf_results VALUES (
      'W-11 a satisfactory verification resolves the report',
      'verified',
      coalesce(v_res2 ->> 'new_status', 'null'),
      CASE WHEN (v_res2 ->> 'new_status') = 'verified' THEN 'PASS' ELSE 'FAIL' END
    );

    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report2;
    INSERT INTO wf_results VALUES (
      'W-11b the report is resolved only after a successful verification',
      'verified',
      coalesce(v_status, 'null'),
      CASE WHEN v_status = 'verified' THEN 'PASS' ELSE 'FAIL' END
    );

    -- A resolved report may no longer be verified again.
    BEGIN
      PERFORM public.verify_report_with_notifications(
        v_report2, TRUE, 'Second verification attempt.', gen_random_uuid());
      v_err2 := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_err2 := SQLERRM;
    END;
    INSERT INTO wf_results VALUES (
      'W-11c a resolved report may not be verified again',
      'CMIRS_INVALID_STATE',
      coalesce(v_err2, 'no error raised'),
      CASE WHEN v_err2 LIKE '%CMIRS_INVALID_STATE%' THEN 'PASS' ELSE 'FAIL' END
    );
  END;

  -- -------------------------------------------------------------------
  -- 8. The coordinator returns the work for further repair
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_coord, 'role','authenticated')::text, true);

  v_res := public.verify_report_with_notifications(
    v_report, FALSE, 'The isolation valve is replaced but the joint still seeps.', v_req8);

  INSERT INTO wf_results VALUES (
    'W-12 a rejected verification returns the report for further repair',
    'reopened',
    coalesce(v_res ->> 'new_status', 'null'),
    CASE WHEN (v_res ->> 'new_status') = 'reopened' THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT status::text INTO v_status FROM public.assignments WHERE id = v_assignment;
  INSERT INTO wf_results VALUES (
    'W-13 the assignment is reactivated so the work order is actionable again',
    'in_progress',
    coalesce(v_status, 'null'),
    CASE WHEN v_status = 'in_progress' THEN 'PASS' ELSE 'FAIL' END
  );

  -- The technician can resume the returned work.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_tech, 'role','authenticated')::text, true);

  BEGIN
    v_res := public.transition_report_status_with_notifications(
      v_report, 'in_progress'::public.report_status, 'Resuming the repair after the rework.', v_req8);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    v_res := NULL;
  END;
  INSERT INTO wf_results VALUES (
    'W-14 the technician can resume the returned work',
    'in_progress',
    coalesce(v_res ->> 'new_status', v_err),
    CASE WHEN (v_res ->> 'new_status') = 'in_progress' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 8. The audit history is preserved
  -- -------------------------------------------------------------------
  SELECT count(*) INTO v_n
  FROM public.report_status_history h
  WHERE h.report_id = v_report;

  INSERT INTO wf_results VALUES (
    'W-15 the audit history is preserved across the whole lifecycle',
    '>=4 history rows (submitted, under_review, in_progress, completed, reopened)',
    v_n::text,
    CASE WHEN v_n >= 4 THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM wf_results
ORDER BY check_id;

ROLLBACK;
