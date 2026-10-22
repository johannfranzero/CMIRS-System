-- =============================================================================
-- CMIRS — Remote RLS / Role Verification Harness
-- File: scripts/remote-rls-verification.sql
--
-- PURPOSE
--   Verifies, against the real Supabase project, that Row Level Security and the
--   report-visibility helper behave exactly as the approved design requires, for
--   every one of the five canonical roles plus an unrelated authenticated user.
--
-- SAFETY
--   * The whole script runs inside a single transaction that is ALWAYS rolled back.
--   * No INSERT / UPDATE / DELETE / TRUNCATE is executed.
--   * The caller must be the management role only to capture fixture identifiers;
--     every assertion then runs as `authenticated` with a simulated JWT so that
--     RLS and SECURITY DEFINER functions observe a realistic caller.
--   * Nothing is persisted. Re-running is always safe.
--
-- EXECUTION
--   npx supabase db query --linked --file scripts/remote-rls-verification.sql --output csv
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Results table + fixture capture (privileged read, before the role switch)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE v_results (
  check_id text primary key,
  expectation text,
  observed text,
  verdict text
) ON COMMIT DROP;

CREATE TEMP TABLE v_fixture (
  role_name text primary key,
  profile_id uuid,
  full_name text,
  is_active boolean
) ON COMMIT DROP;

INSERT INTO v_fixture
SELECT p.role::text, p.id, p.full_name, p.is_active
FROM public.profiles p
WHERE p.role::text IN ('student_personnel','coordinator','technician','administrator','management');

CREATE TEMP TABLE v_report (
  id uuid primary key,
  report_number text,
  status text,
  reporter_id uuid
) ON COMMIT DROP;

INSERT INTO v_report
SELECT r.id, r.report_number, r.status::text, r.reporter_id
FROM public.reports r
ORDER BY r.created_at DESC
LIMIT 1;

-- The expected visibility of every role is COMPUTED from the real data before the role switch,
-- because it depends on the data itself (a technician who reported a report may always see
-- their own report, and an administrator may see everything). Hard-coded expectations would
-- be wrong as soon as the project's own test accounts submit a report.
CREATE TEMP TABLE v_expected (
  role_name text primary key,
  reports_visible integer
) ON COMMIT DROP;

INSERT INTO v_expected
SELECT p.role::text,
       CASE
         WHEN p.role::text IN ('coordinator','administrator','management')
           THEN (SELECT count(*) FROM public.reports)
         ELSE
           (SELECT count(*) FROM public.reports r
             WHERE r.reporter_id = p.id
                OR EXISTS (
                  SELECT 1 FROM public.assignments a
                  WHERE a.report_id = r.id
                    AND a.technician_id = p.id
                    AND a.status <> 'declined'
                ))
       END
FROM public.profiles p
WHERE p.role::text IN ('student_personnel','coordinator','technician','administrator','management');

GRANT SELECT, INSERT ON v_expected, v_fixture, v_report, v_results TO authenticated;
GRANT SELECT, INSERT ON v_expected, v_fixture, v_report, v_results TO anon;

-- ---------------------------------------------------------------------------
-- 1. Switch to an authenticated session
-- ---------------------------------------------------------------------------
-- The temporary fixture/result tables live in pg_temp; the switched role needs explicit
-- privileges on them (PostgreSQL does not inherit the creating role's temp grants).
GRANT SELECT, INSERT ON v_fixture, v_report, v_results TO authenticated;
GRANT SELECT, INSERT ON v_fixture, v_report, v_results TO anon;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 2. Per-role visibility assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f            RECORD;
  v_uid        uuid;
  v_reports    integer;
  v_profiles   integer;
  v_notifs     integer;
  v_total      integer;
  v_expected   integer;
  v_msg        text;
  v_view       boolean;
BEGIN
  -- Helper: activate a simulated session for the given profile.
  -- (Implemented inline to keep the harness self-contained.)

  FOR f IN SELECT * FROM v_fixture ORDER BY role_name LOOP
    v_uid := f.profile_id;
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub', v_uid, 'role', 'authenticated')::text,
      true
    );

    -- (a) The visibility helper must execute without raising 42702.
    BEGIN
      v_view := public.can_view_report((SELECT id FROM v_report));
      v_msg := 'executed, returned ' || coalesce(v_view::text, 'null');
    EXCEPTION WHEN OTHERS THEN
      v_msg := 'RAISED: ' || SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'RLS-01 can_view_report executes for ' || f.role_name,
      'no exception',
      v_msg,
      CASE WHEN v_msg LIKE 'RAISED:%' THEN 'FAIL' ELSE 'PASS' END
    );

    -- (b) Reports visible to this role.
    SELECT count(*) INTO v_reports FROM public.reports;
    SELECT count(*) INTO v_total FROM public.reports;

    v_expected := (SELECT e.reports_visible FROM v_expected e WHERE e.role_name = f.role_name);

    INSERT INTO v_results VALUES (
      'RLS-02 reports visible to ' || f.role_name,
      v_expected::text,
      v_reports::text,
      CASE WHEN v_reports = v_expected THEN 'PASS' ELSE 'FAIL' END
    );

    -- (c) Profiles visible to this role (self + oversight roles only).
    SELECT count(*) INTO v_profiles FROM public.profiles;
    v_expected := CASE f.role_name
      WHEN 'coordinator' THEN (SELECT count(*) FROM v_fixture)
      WHEN 'administrator' THEN (SELECT count(*) FROM v_fixture)
      WHEN 'management' THEN (SELECT count(*) FROM v_fixture)
      ELSE 1
    END;
    INSERT INTO v_results VALUES (
      'RLS-03 profiles visible to ' || f.role_name,
      v_expected::text,
      v_profiles::text,
      CASE WHEN v_profiles = v_expected THEN 'PASS' ELSE 'FAIL' END
    );

    -- (d) Notifications are recipient-scoped: a user may read only their own.
    SELECT count(*) INTO v_notifs FROM public.notifications;
    v_expected := (SELECT count(*) FROM public.notifications WHERE recipient_id = v_uid);
    INSERT INTO v_results VALUES (
      'RLS-04 notifications visible to ' || f.role_name,
      v_expected::text,
      v_notifs::text,
      CASE WHEN v_notifs = v_expected THEN 'PASS' ELSE 'FAIL' END
    );
  END LOOP;

  -- -------------------------------------------------------------------
  -- 2e. An authenticated user with no profile must see nothing.
  -- -------------------------------------------------------------------
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
    true
  );
  SELECT count(*) INTO v_reports FROM public.reports;
  INSERT INTO v_results VALUES (
    'RLS-05 reports visible to an unrelated authenticated user',
    '0',
    v_reports::text,
    CASE WHEN v_reports = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  SELECT count(*) INTO v_profiles FROM public.profiles;
  INSERT INTO v_results VALUES (
    'RLS-06 profiles visible to an unrelated authenticated user',
    '0',
    v_profiles::text,
    CASE WHEN v_profiles = 0 THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

-- ---------------------------------------------------------------------------
-- 3. Anonymous role (no session at all)
-- ---------------------------------------------------------------------------
-- NOTE: `RESET ROLE` would return to the privileged management role, which BYPASSES RLS and
-- would therefore measure the wrong thing. The genuine PostgREST `anon` role is used instead.
SET LOCAL ROLE anon;

INSERT INTO v_results
SELECT 'RLS-07 reports visible to the anon role',
       '0',
       count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.reports;

INSERT INTO v_results
SELECT 'RLS-08 categories visible to the anon role',
       '0',
       count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.categories;

INSERT INTO v_results
SELECT 'RLS-09 active technician profiles visible to the anon role',
       '0',
       count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.profiles WHERE role = 'technician';

-- ---------------------------------------------------------------------------
-- 4. Report
-- ---------------------------------------------------------------------------
SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM v_results
ORDER BY check_id;

ROLLBACK;
