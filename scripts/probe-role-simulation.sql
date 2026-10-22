-- CMIRS: Role-simulated verification probe (transaction + ROLLBACK, no persistent changes)
BEGIN;

CREATE TEMP TABLE probe_results (
  probe text primary key,
  detail text
) ON COMMIT DROP;

DO $$
DECLARE
  v_reporter uuid;
  v_result boolean;
  v_seen integer;
  v_report_id uuid;
BEGIN
  SELECT id, reporter_id INTO v_report_id, v_reporter
  FROM public.reports ORDER BY created_at DESC LIMIT 1;

  IF v_report_id IS NULL THEN
    INSERT INTO probe_results VALUES ('probe-0', 'no report rows present');
    RETURN;
  END IF;

  -- Probe 1: the repaired helper must execute without raising 42702 for a non-oversight role.
  v_result := public.can_view_report(v_report_id);
  INSERT INTO probe_results VALUES
    ('probe-1 can_view_report executes', 'returned ' || coalesce(v_result::text, 'null') || ' (no 42702)');

  -- Probe 2: switch the simulated JWT to the report's reporter and read through RLS.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text,
    true
  );

  SELECT count(*) INTO v_seen FROM public.reports;
  INSERT INTO probe_results VALUES
    ('probe-2 reporter RLS visible reports', v_seen::text);

  -- Probe 3: a stranger (no profile) must see nothing.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
    true
  );

  SELECT count(*) INTO v_seen FROM public.reports;
  INSERT INTO probe_results VALUES
    ('probe-3 stranger RLS visible reports', v_seen::text);

  -- Probe 4: the technician directory must list only active technician profiles.
  SELECT count(*) INTO v_seen FROM public.profiles WHERE role = 'technician' AND is_active;
  INSERT INTO probe_results VALUES
    ('probe-4 active technician profiles', v_seen::text);
END $$;

SELECT probe, detail FROM probe_results ORDER BY probe;

ROLLBACK;
