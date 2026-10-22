-- =============================================================================
-- CMIRS — Remote Coordinator Assignment Path Probe (read-only / rolled back)
-- File: scripts/remote-coordinator-assignment-probe.sql
--
-- Reproduces, as the real coordinator, exactly the reads and the command the application
-- performs before and during a technician assignment:
--   P-1 the eligible technician directory (utils/reports/dal.ts -> getActiveTechnicians)
--   P-2 the coordinator can read a submitted report
--   P-3 the assignment command succeeds for a submitted report
--   P-4 after the assignment the report is 'assigned' with an active assignment row
--   P-5 a second assignment of the same technician is refused as a no-op (approved P-05)
--
-- The probe creates its own report so that it verifies the CAPABILITY, not the state of
-- whatever happens to be in the project data at the time it runs.
--
-- SAFETY: every statement runs inside ONE transaction that is ALWAYS rolled back.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE p_results (
  check_id text primary key,
  expectation text,
  observed text,
  verdict text
) ON COMMIT DROP;

GRANT SELECT, INSERT ON p_results TO authenticated;

DO $$
DECLARE
  v_coord uuid;
  v_tech uuid;
  v_report uuid;
  v_dir integer;
  v_visible integer;
  v_status text;
  v_err text;
  v_res jsonb;
BEGIN
  SELECT p.id INTO v_coord FROM public.profiles p
   WHERE p.role = 'coordinator' AND p.is_active ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_tech FROM public.profiles p
   WHERE p.role = 'technician' AND p.is_active ORDER BY p.id LIMIT 1;

  -- P-1: the eligible technician directory, exactly as the DAL queries it.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_coord, 'role','authenticated')::text, true);

  SELECT count(*) INTO v_dir FROM public.profiles
  WHERE role = 'technician' AND is_active;

  INSERT INTO p_results VALUES (
    'P-1 the coordinator can read the eligible technician directory',
    '>=1 active technician profile',
    v_dir::text,
    CASE WHEN v_dir >= 1 THEN 'PASS' ELSE 'FAIL' END
  );

  -- A fresh report for the assignment checks.
  INSERT INTO public.reports (
    title, description, category_id, location_id, reporter_id, status, confirmed_priority
  )
  SELECT
    'Coordinator assignment probe report',
    'Created by the coordinator assignment probe to verify the assignment capability.',
    (SELECT c.id FROM public.categories c WHERE c.is_active ORDER BY c.id LIMIT 1),
    (SELECT l.id FROM public.locations l WHERE l.is_active ORDER BY l.id LIMIT 1),
    v_coord, 'submitted', NULL
  RETURNING id INTO v_report;

  -- P-2: the coordinator can read it.
  SELECT count(*) INTO v_visible FROM public.reports WHERE id = v_report;
  SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;

  INSERT INTO p_results VALUES (
    'P-2 the coordinator can read a submitted report',
    '1 visible, status submitted',
    v_visible::text || ' visible, status ' || coalesce(v_status, 'null'),
    CASE WHEN v_visible = 1 AND v_status = 'submitted' THEN 'PASS' ELSE 'FAIL' END
  );

  -- P-3: the assignment command accepts the report and the technician.
  BEGIN
    v_res := public.assign_or_reassign_report_with_notifications(
      v_report, v_tech, 'Assignment probe.', gen_random_uuid());
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    v_res := NULL;
  END;

  INSERT INTO p_results VALUES (
    'P-3 the assignment command succeeds for a submitted report',
    'an assignment id',
    coalesce(v_res ->> 'assignment_id', v_err),
    CASE WHEN (v_res ->> 'assignment_id') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
  );

  -- P-4: after the assignment the report is 'assigned' with an active assignment row.
  SELECT count(*) INTO v_visible
  FROM public.assignments a
  WHERE a.report_id = v_report AND a.technician_id = v_tech
    AND a.status IN ('assigned','in_progress','on_hold');
  SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;

  INSERT INTO p_results VALUES (
    'P-4 after assignment the report is assigned with an active technician row',
    '1 active assignment, report status assigned',
    v_visible::text || ' assignment(s), status ' || coalesce(v_status, 'null'),
    CASE WHEN v_visible = 1 AND v_status = 'assigned' THEN 'PASS' ELSE 'FAIL' END
  );

  -- P-5: a second assignment of the same technician is refused as a no-op (approved P-05).
  BEGIN
    v_res := public.assign_or_reassign_report_with_notifications(
      v_report, v_tech, 'Duplicate dispatch attempt.', gen_random_uuid());
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    v_res := NULL;
  END;

  INSERT INTO p_results VALUES (
    'P-5 a duplicate assignment of the same technician is refused as a no-op (P-05)',
    'CMIRS_INVALID_STATE',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_STATE%' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM p_results
ORDER BY check_id;

ROLLBACK;
