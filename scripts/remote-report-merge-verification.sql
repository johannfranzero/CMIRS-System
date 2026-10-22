-- =============================================================================
-- CMIRS — Remote Report Row-Merge Verification
-- File: scripts/remote-report-merge-verification.sql
--
-- PostgREST embeds a to-many relation with a LEFT JOIN, so a report that has several child
-- rows (for example a reassigned report, which keeps its old 'reassigned' assignment row
-- next to the new 'assigned' one) is returned once per (report × child) combination.
--
-- Without merging those rows back, the report queue would list the report several times and
-- the report DETAIL query would fail outright with
-- "JSON object requested, multiple (or no) rows returned".
--
-- This harness proves the raw database shape that the application has to cope with. The
-- merge itself is a pure function and is covered by
-- `tests/unit/phase-4g-technician-workflow.test.mjs`.
--
-- SAFETY: everything runs inside ONE transaction that is ALWAYS rolled back, and the setup
-- and the checks live in a SINGLE statement so that no cross-statement state can escape.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE v_results (check_id text primary key, expectation text, observed text, verdict text) ON COMMIT DROP;

DO $$
DECLARE
  v_coord uuid;
  v_tech uuid;
  v_report uuid;
  v_raw integer;
  v_assignments integer;
  v_history integer;
  v_active_status text;
BEGIN
  SELECT p.id INTO v_coord FROM public.profiles p
   WHERE p.role = 'coordinator' AND p.is_active ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_tech FROM public.profiles p
   WHERE p.role = 'technician' AND p.is_active ORDER BY p.id LIMIT 1;

  -- A report with two assignment rows, exactly as a reassignment leaves behind.
  INSERT INTO public.reports (
    id, title, description, category_id, location_id, reporter_id, status, confirmed_priority
  )
  SELECT
    gen_random_uuid(),
    'Row merge harness report',
    'Used to prove that a report with several child rows is returned once per child.',
    (SELECT c.id FROM public.categories c WHERE c.is_active ORDER BY c.id LIMIT 1),
    (SELECT l.id FROM public.locations l WHERE l.is_active ORDER BY l.id LIMIT 1),
    v_coord, 'assigned', NULL
  RETURNING id INTO v_report;

  INSERT INTO public.assignments (id, report_id, technician_id, assigned_by, status, assigned_at)
  VALUES
    (gen_random_uuid(), v_report, v_tech, v_coord, 'reassigned', now() - interval '2 days'),
    (gen_random_uuid(), v_report, v_tech, v_coord, 'assigned',    now() - interval '1 hour');

  INSERT INTO public.report_status_history (report_id, previous_status, new_status, changed_by, created_at)
  VALUES
    (v_report, 'submitted', 'under_review', v_coord, now() - interval '2 days'),
    (v_report, 'under_review', 'assigned',  v_coord, now() - interval '1 hour');

  -- M-01: the raw join produces one row per child record.
  SELECT count(*) INTO v_raw FROM (
    SELECT r.id
    FROM public.reports r
    LEFT JOIN public.assignments a ON a.report_id = r.id
    WHERE r.id = v_report
  ) x;

  SELECT count(*) INTO v_assignments FROM public.assignments a WHERE a.report_id = v_report;
  SELECT count(*) INTO v_history FROM public.report_status_history h WHERE h.report_id = v_report;

  SELECT a.status::text INTO v_active_status
  FROM public.assignments a
  WHERE a.report_id = v_report AND a.status IN ('assigned','in_progress','on_hold')
  ORDER BY a.assigned_at DESC LIMIT 1;

  INSERT INTO v_results VALUES (
    'M-01 the raw join produces one row per child record',
    '> 1',
    v_raw::text,
    CASE WHEN v_raw > 1 THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO v_results VALUES (
    'M-02 the report itself is a single record',
    '1',
    (SELECT count(*)::text FROM public.reports WHERE id = v_report),
    CASE WHEN (SELECT count(*) FROM public.reports WHERE id = v_report) = 1 THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO v_results VALUES (
    'M-03 both assignment rows exist for the report',
    '2',
    v_assignments::text,
    CASE WHEN v_assignments = 2 THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO v_results VALUES (
    'M-04 the active assignment is the most recent active one',
    'assigned',
    coalesce(v_active_status, 'null'),
    CASE WHEN v_active_status = 'assigned' THEN 'PASS' ELSE 'FAIL' END
  );
  INSERT INTO v_results VALUES (
    'M-05 both status-history rows exist for the report',
    '2',
    v_history::text,
    CASE WHEN v_history = 2 THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM v_results
ORDER BY check_id;

ROLLBACK;
