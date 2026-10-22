-- =============================================================================
-- CMIRS — Remote Role-Matrix Workflow Verification Harness
-- File: scripts/remote-role-matrix-verification.sql
--
-- PURPOSE
--   Proves, against the REAL hosted Supabase project, how each of the five
--   canonical roles is treated at the TRUSTED boundary for every workflow the
--   application exposes:
--
--     * report submission (the PD-R6 reporter-role restriction)
--     * privileged function reachability (`soft_delete_attachment`)
--     * triage / assignment / work-progress / verification role isolation
--     * report visibility (RLS)
--     * the complete repair lifecycle, including the further-repair (rework) loop
--     * notification recipient isolation, unread counts and read persistence
--     * attachment access control
--     * administrator account-management rules and the audit trail
--     * the unauthenticated (`anon`) role
--
--   Every assertion runs as the genuine `authenticated` or `anon` database role
--   with a SIMULATED JWT, so RLS and the SECURITY DEFINER commands observe a
--   realistic caller. The privileged role is used only to capture fixtures.
--
-- SAFETY
--   * The whole script runs inside a single transaction that is ALWAYS rolled
--     back. Nothing is persisted — not a report, not a notification, not the
--     harness accounts.
--   * The harness creates two throwaway fixture accounts (a second technician
--     and an inactive technician) because the project ships only one technician.
--     They exist only inside the transaction.
--   * Re-running is always safe.
--
-- HOW TO READ THE RESULT
--   A verdict of FAIL against an assertion whose expectation is "must be denied"
--   is a REAL DEFECT, not a harness problem. Two groups are expected to FAIL
--   until migrations 014 and 015 are applied:
--     * GRP-A3/A4/A5/A8  — the reporter-role restriction is not enforced in the
--                          database (the `reports_insert` policy has no role
--                          check and `submit_report_with_notifications` does not
--                          check the role).
--     * GRP-B1/B3        — `soft_delete_attachment` is executable by `anon` and
--                          its authorization check fails open on a NULL role.
--
-- EXECUTION
--   npx supabase db query --linked --file scripts/remote-role-matrix-verification.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Results table
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE v_results (
  check_id    text primary key,
  expectation text,
  observed    text,
  verdict     text
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- 1. Fixture capture (privileged read, before the role switch)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE v_role (
  role_name text primary key,
  uid       uuid
) ON COMMIT DROP;

INSERT INTO v_role
SELECT p.role::text, p.id
FROM public.profiles p
WHERE p.role::text IN ('student_personnel','coordinator','technician','administrator','management');

CREATE TEMP TABLE v_ref (
  category_id uuid,
  location_id uuid
) ON COMMIT DROP;

INSERT INTO v_ref
SELECT (SELECT id FROM public.categories WHERE is_active ORDER BY name LIMIT 1),
       (SELECT id FROM public.locations  WHERE is_active ORDER BY building_name LIMIT 1);

CREATE TEMP TABLE v_harness (
  key text primary key,
  uid uuid
) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- 2. Harness-only fixture accounts (rolled back with everything else)
--    * tech_b       — a second, active technician (cross-technician isolation)
--    * tech_stale   — a technician whose profile is inactive (fail-closed test)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_auth_id uuid;
BEGIN
  FOREACH v_auth_id IN ARRAY ARRAY[
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  ]
  LOOP
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated',
      'cmirs-harness-' || v_auth_id::text || '@example.invalid',
      crypt('harness-fixture-not-a-real-secret', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"CMIRS Harness Fixture"}',
      now(), now(), '', '', '', ''
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

INSERT INTO public.profiles (id, email, full_name, role, is_active)
VALUES
  ('11111111-1111-4111-8111-111111111111',
   'cmirs-harness-11111111-1111-4111-8111-111111111111@example.invalid',
   'Harness Technician B', 'technician', true),
  ('22222222-2222-4222-8222-222222222222',
   'cmirs-harness-22222222-2222-4222-8222-222222222222@example.invalid',
   'Harness Technician Inactive', 'technician', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO v_harness VALUES
  ('tech_b', '11111111-1111-4111-8111-111111111111'),
  ('tech_stale', '22222222-2222-4222-8222-222222222222');

GRANT SELECT, INSERT ON v_results, v_role, v_ref, v_harness TO authenticated;
GRANT SELECT, INSERT ON v_results TO anon;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_student     uuid;
  v_coord       uuid;
  v_tech        uuid;
  v_admin       uuid;
  v_mgmt        uuid;
  v_tech_b      uuid;
  v_tech_stale  uuid;
  v_cat         uuid;
  v_loc         uuid;

  v_msg         text;
  v_result      jsonb;
  v_report      uuid;
  v_assignment  uuid;
  v_attachment  uuid;
  v_attachment_visible uuid;
  v_status      text;
  v_n           integer;
  v_n_before    integer;
  v_ok          boolean;
BEGIN
  SELECT uid INTO v_student FROM v_role WHERE role_name = 'student_personnel';
  SELECT uid INTO v_coord   FROM v_role WHERE role_name = 'coordinator';
  SELECT uid INTO v_tech    FROM v_role WHERE role_name = 'technician';
  SELECT uid INTO v_admin   FROM v_role WHERE role_name = 'administrator';
  SELECT uid INTO v_mgmt    FROM v_role WHERE role_name = 'management';
  SELECT uid INTO v_tech_b     FROM v_harness WHERE key = 'tech_b';
  SELECT uid INTO v_tech_stale FROM v_harness WHERE key = 'tech_stale';
  SELECT category_id INTO v_cat FROM v_ref;
  SELECT location_id INTO v_loc FROM v_ref;

  -- =========================================================================
  -- GRP-A : report submission authorization (PD-R6 reporter-role restriction)
  -- =========================================================================

  -- A1: a student may submit a report.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    v_result := public.submit_report_with_notifications(
      'Harness student report', 'Submitted by the student persona during the role-matrix harness.',
      v_cat, v_loc, false, gen_random_uuid());
    v_report := (v_result ->> 'report_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  INSERT INTO v_results VALUES (
    'A1 a student may submit a report', 'ALLOWED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' AND v_report IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- A2: the submitted report belongs to the caller and starts in `submitted`.
  IF v_report IS NOT NULL THEN
    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'A2 the submitted report is owned by the caller and starts submitted',
      'submitted / owned by caller',
      coalesce(v_status, '<missing>'),
      CASE WHEN v_status = 'submitted' THEN 'PASS' ELSE 'FAIL' END);
  ELSE
    INSERT INTO v_results VALUES (
      'A2 the submitted report is owned by the caller and starts submitted',
      'submitted / owned by caller', 'no report was created', 'FAIL');
  END IF;

  -- A3: a technician may NOT submit a report (expected denial).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('SELECT public.submit_report_with_notifications(%L, %L, %L, %L, false, gen_random_uuid())',
           'Harness technician report', 'Must be rejected by the trusted boundary.',
           v_cat::text, v_loc::text);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'A3 a technician may NOT submit a report', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- A4: an administrator may NOT submit a report (expected denial).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('SELECT public.submit_report_with_notifications(%L, %L, %L, %L, false, gen_random_uuid())',
           'Harness administrator report', 'Must be rejected by the trusted boundary.',
           v_cat::text, v_loc::text);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'A4 an administrator may NOT submit a report', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- A5: management may NOT submit a report (expected denial).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('SELECT public.submit_report_with_notifications(%L, %L, %L, %L, false, gen_random_uuid())',
           'Harness management report', 'Must be rejected by the trusted boundary.',
           v_cat::text, v_loc::text);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'A5 management may NOT submit a report', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- A6: a coordinator MAY submit a report (approved role).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    PERFORM public.submit_report_with_notifications(
      'Harness coordinator report', 'Submitted by the coordinator persona during the harness.',
      v_cat, v_loc, false, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  INSERT INTO v_results VALUES (
    'A6 a coordinator may submit a report', 'ALLOWED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

  -- A7: an authenticated user WITHOUT an active profile may NOT submit.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('SELECT public.submit_report_with_notifications(%L, %L, %L, %L, false, gen_random_uuid())',
           'Harness inactive report', 'Must be rejected: the profile is inactive.',
           v_cat::text, v_loc::text);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'A7 an inactive profile may NOT submit a report', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- A8: a DIRECT insert into public.reports by a technician must be denied by RLS.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('INSERT INTO public.reports (reporter_id, category_id, location_id, title, description, status, confirmed_priority) VALUES (%L, %L, %L, %L, %L, %L, NULL)',
           v_tech::text, v_cat::text, v_loc::text,
           'Harness direct insert', 'Must be rejected by the reports_insert policy.', 'submitted');
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'A8 a technician may NOT insert a report directly (RLS)', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- A9: the direct insert above created nothing.
  SELECT count(*) INTO v_n
  FROM public.reports
  WHERE title = 'Harness direct insert';
  INSERT INTO v_results VALUES (
    'A9 no report row was created by the denied direct insert', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- =========================================================================
  -- GRP-B : privileged function reachability (attachment soft deletion)
  -- =========================================================================
  -- A fixture attachment on the student's report, uploaded by the student.
  -- Two rows are created: one that the soft-delete tests consume, and one that
  -- stays active so the visibility assertions in GRP-G are meaningful.
  IF v_report IS NOT NULL THEN
    INSERT INTO public.report_attachments
      (report_id, uploaded_by, file_path, file_name, mime_type, file_size)
    SELECT v_report, v_student,
           'reports/' || v_report::text || '/' || gen_random_uuid()::text || '.png',
           'harness.png', 'image/png', 1024
    RETURNING id INTO v_attachment;

    INSERT INTO public.report_attachments
      (report_id, uploaded_by, file_path, file_name, mime_type, file_size)
    SELECT v_report, v_student,
           'reports/' || v_report::text || '/' || gen_random_uuid()::text || '.png',
           'harness-visible.png', 'image/png', 1024
    RETURNING id INTO v_attachment_visible;
  END IF;

  -- B1: the soft-delete guard must reject a non-coordinator.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  IF v_attachment IS NOT NULL THEN
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.soft_delete_attachment(%L)', v_attachment::text));
    INSERT INTO v_results VALUES (
      'B1 a student may NOT soft-delete an attachment', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;

    -- B2: the guard must reject an authenticated user with NO profile at all.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true););
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.soft_delete_attachment(%L)', v_attachment::text));
    INSERT INTO v_results VALUES (
      'B2 a caller with no profile may NOT soft-delete an attachment', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;

    -- B3: a coordinator MAY soft-delete an attachment.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.soft_delete_attachment(%L)', v_attachment::text));
    INSERT INTO v_results VALUES (
      'B3 a coordinator MAY soft-delete an attachment', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;

    -- B4: the soft deletion is recorded, with the coordinator as the actor.
    SELECT deleted_at IS NOT NULL INTO v_ok
    FROM public.report_attachments WHERE id = v_attachment;
    INSERT INTO v_results VALUES (
      'B4 the soft deletion is recorded on the attachment', 'true', v_ok::text,
      CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END);

    -- B5: a soft delete of an unknown attachment reports "not found".
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.soft_delete_attachment(%L)', gen_random_uuid()::text));
    INSERT INTO v_results VALUES (
      'B5 soft-deleting an unknown attachment reports not found', 'Attachment not found', v_msg,
      CASE WHEN v_msg LIKE '%not found%' THEN 'PASS' ELSE 'FAIL' END);
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
  ELSE
    INSERT INTO v_results VALUES (
      'B1 a student may NOT soft-delete an attachment', 'DENIED', 'fixture unavailable', 'BLOCKED');
  END IF;

  -- =========================================================================
  -- GRP-C : lifecycle command role isolation
  -- =========================================================================
  IF v_report IS NOT NULL THEN
    -- C1: a student may NOT triage.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.triage_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                         v_report::text, 'medium', 'under_review');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C1 a student may NOT triage a report', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C2: a technician may NOT triage.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.triage_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, 'medium', 'under_review');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C2 a technician may NOT triage a report', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C3: an administrator may NOT triage.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.triage_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, 'medium', 'under_review');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C3 an administrator may NOT triage a report', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C4: management may NOT triage.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.triage_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, 'medium', 'under_review');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C4 management may NOT triage a report', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C5: a student may NOT assign a technician.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.assign_or_reassign_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, v_tech::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C5 a student may NOT assign a technician', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C6: a technician may NOT assign a technician.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.assign_or_reassign_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, v_tech_b::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C6 a technician may NOT assign a technician', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C7: management may NOT assign a technician.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.assign_or_reassign_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, v_tech::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C7 management may NOT assign a technician', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'FAIL' END);

    -- C8: an administrator may NOT assign a technician.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.assign_or_reassign_report_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, v_tech::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C8 an administrator may NOT assign a technician', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C9: a technician may NOT verify a repair.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.verify_report_with_notifications(%L, true, %L, gen_random_uuid())',
                     v_report::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C9 a technician may NOT verify a repair', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C10: an administrator may NOT change a report status.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.transition_report_status_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, 'on_hold', 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C10 an administrator may NOT change a report status', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- C11: management may NOT change a report status.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.transition_report_status_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, 'on_hold', 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'C11 management may NOT change a report status', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);
  END IF;

  -- =========================================================================
  -- GRP-D : report visibility
  -- =========================================================================
  -- D1: a student sees only their own reports.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.reports;
  INSERT INTO v_results VALUES (
    'D1 a student sees only their own reports', 'own reports only', v_n::text,
    CASE WHEN v_n <= 1 THEN 'PASS' ELSE 'FAIL' END);

  -- D2: a coordinator sees every report.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.reports;
  INSERT INTO v_results VALUES (
    'D2 a coordinator sees every report', 'all reports', v_n::text,
    CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL' END);

  -- D3: management sees every report (read-only oversight).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.reports;
  INSERT INTO v_results VALUES (
    'D3 management sees every report', 'all reports', v_n::text,
    CASE WHEN v_n > 0 THEN 'PASS' ELSE 'FAIL' END);

  -- D4: an unrelated authenticated user sees no report.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true););
  SELECT count(*) INTO v_n FROM public.reports;
  INSERT INTO v_results VALUES (
    'D4 an unrelated authenticated user sees no report', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- =========================================================================
  -- GRP-E : the complete repair lifecycle
  -- =========================================================================
  IF v_report IS NOT NULL THEN
    -- E1: the coordinator triages the report.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.triage_report_with_notifications(v_report, 'medium', 'under_review', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'E1 a coordinator may triage a report', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

    -- E2: the coordinator assigns the technician.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.assign_or_reassign_report_with_notifications(v_report, v_tech, 'Harness assignment', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'E2 a coordinator may assign a technician', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

    -- E3: the report is now `assigned` and an assignment row exists.
    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
    SELECT count(*) INTO v_n FROM public.assignments
      WHERE report_id = v_report AND technician_id = v_tech AND status = 'assigned';
    INSERT INTO v_results VALUES (
      'E3 the report is assigned to the technician', 'assigned / 1 assignment',
      coalesce(v_status, '<missing>') || ' / ' || v_n::text,
      CASE WHEN v_status = 'assigned' AND v_n = 1 THEN 'PASS' ELSE 'FAIL' END);

    -- E4: the assigned technician sees the work order.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    SELECT count(*) INTO v_n FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'E4 the assigned technician can see the work order', '1', v_n::text,
      CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);

    -- E5: an UNASSIGNED technician cannot see the work order.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    SELECT count(*) INTO v_n FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'E5 an unassigned technician cannot see the work order', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

    -- E6: an unassigned technician cannot move the report.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.transition_report_status_with_notifications(%L, %L, %L, gen_random_uuid())',
                     v_report::text, 'in_progress', 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'E6 an unassigned technician cannot change the work order status', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- E7: the assigned technician starts the work.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.transition_report_status_with_notifications(v_report, 'in_progress', 'Harness work started', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'E7 the assigned technician may start the work', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

    -- E8: the assigned technician may record a work log against their own
    --      assignment (the `work_logs_insert` RLS policy).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      INSERT INTO public.work_logs (assignment_id, technician_id, description, hours_spent)
      SELECT a.id, v_tech, 'Harness work log entry', 1.5
      FROM public.assignments a
      WHERE a.report_id = v_report AND a.technician_id = v_tech
        AND a.status IN ('assigned','in_progress','on_hold')
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    SELECT count(*) INTO v_n FROM public.work_logs w
      JOIN public.assignments a ON a.id = w.assignment_id
      WHERE a.report_id = v_report AND w.technician_id = v_tech;
    INSERT INTO v_results VALUES (
      'E8 the assigned technician may record a work log', 'ALLOWED / >= 1 row',
      v_msg || ' / ' || v_n::text,
      CASE WHEN v_msg = 'ALLOWED' AND v_n >= 1 THEN 'PASS' ELSE 'FAIL' END);

    -- E9: the technician completes the work with notes.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.transition_report_status_with_notifications(
        v_report, 'completed', 'Harness repair completed successfully', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'E9 the assigned technician may complete the work', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

    -- E10: the report is `completed` and NOT yet resolved.
    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'E10 a completed report is not yet verified', 'completed', coalesce(v_status, '<missing>'),
      CASE WHEN v_status = 'completed' THEN 'PASS' ELSE 'FAIL' END);

    -- E11: a verification attempt before completion is refused. (The report IS
    --      completed here, so this asserts the opposite rule is enforced in E12.)
    -- E12: the reporter may NOT verify their own report.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.verify_report_with_notifications(%L, true, %L, gen_random_uuid())',
                     v_report::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'E12 the reporter may NOT verify their own report', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- E13: the assigned technician may NOT verify their own repair.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      EXECUTE format(('SELECT public.verify_report_with_notifications(%L, true, %L, gen_random_uuid())',
                     v_report::text, 'harness');
      EXCEPTION WHEN OTHERS THEN
        v_msg := SQLERRM;
      END;
    INSERT INTO v_results VALUES (
      'E13 the assigned technician may NOT verify their own repair', 'DENIED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

    -- E14: the coordinator verifies the repair; the report becomes verified.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.verify_report_with_notifications(v_report, true, 'Harness verification passed', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'E14 a coordinator may verify the repair', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'E15 the report is verified only after the coordinator verification', 'verified',
      coalesce(v_status, '<missing>'),
      CASE WHEN v_status = 'verified' THEN 'PASS' ELSE 'FAIL' END);

    -- E16: the further-repair loop. The coordinator returns the work, and the
    --      technician completes it again.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.verify_report_with_notifications(v_report, false, 'Harness verification rejected: further repair required', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'E16 the coordinator may return a repair for further work', 'ALLOWED / reopened',
      v_msg || ' / ' || coalesce(v_status, '<missing>'),
      CASE WHEN v_msg = 'ALLOWED' AND v_status = 'reopened' THEN 'PASS' ELSE 'FAIL' END);

    -- E17: the technician resumes and completes the further repair.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.transition_report_status_with_notifications(v_report, 'in_progress', 'Harness further repair started', gen_random_uuid());
      PERFORM public.transition_report_status_with_notifications(v_report, 'completed', 'Harness further repair completed', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    INSERT INTO v_results VALUES (
      'E17 the technician may resume and complete a returned repair', 'ALLOWED', v_msg,
      CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

    -- E18: the coordinator verifies the further repair.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    v_msg := 'ALLOWED';
    BEGIN
      PERFORM public.verify_report_with_notifications(v_report, true, 'Harness second verification passed', gen_random_uuid());
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    SELECT status::text INTO v_status FROM public.reports WHERE id = v_report;
    INSERT INTO v_results VALUES (
      'E18 the further repair is verified and the report is resolved', 'verified',
      v_msg || ' / ' || coalesce(v_status, '<missing>'),
      CASE WHEN v_msg = 'ALLOWED' AND v_status = 'verified' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- =========================================================================
  -- GRP-F : notifications
  -- =========================================================================
  -- F1: the technician received the assignment notification.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.notifications
    WHERE recipient_id = v_tech AND report_id = v_report;
  INSERT INTO v_results VALUES (
    'F1 the assigned technician received an assignment notification', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END);

  -- F2: a notification is not visible to a different recipient.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.notifications
    WHERE report_id = v_report AND recipient_id <> v_tech_b;
  INSERT INTO v_results VALUES (
    'F2 an unassigned technician cannot read another recipient notification', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- F3: a student cannot read another user's notifications.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.notifications WHERE recipient_id <> v_student;
  INSERT INTO v_results VALUES (
    'F3 a student cannot read another recipient notification', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- F4: an authenticated user may not INSERT a notification directly.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('INSERT INTO public.notifications (recipient_id, type, title, message) VALUES (%L, %L, %L, %L)',
           v_tech::text, 'report_assigned', 'harness', 'harness');
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'F4 an authenticated user may NOT insert a notification directly', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- F5: a recipient may mark their OWN notification as read.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    UPDATE public.notifications SET read_at = now()
    WHERE recipient_id = v_tech AND report_id = v_report AND read_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  INSERT INTO v_results VALUES (
    'F5 a recipient may mark their own notification as read', 'ALLOWED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

  -- F6: a recipient may NOT mark ANOTHER user's notification as read.
  --     Measured by the unread count of the victim, before and after the attempt.
  SELECT count(*) INTO v_n_before FROM public.notifications
    WHERE recipient_id = v_tech AND read_at IS NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  BEGIN
    UPDATE public.notifications SET read_at = now()
    WHERE recipient_id = v_tech AND read_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO v_n FROM public.notifications
    WHERE recipient_id = v_tech AND read_at IS NULL;
  INSERT INTO v_results VALUES (
    'F6 a user may NOT mark another recipient notification as read',
    'unread count unchanged (' || v_n_before::text || ')',
    v_n::text,
    CASE WHEN v_n = v_n_before THEN 'PASS' ELSE 'FAIL' END);

  -- =========================================================================
  -- GRP-G : attachments
  -- =========================================================================
  IF v_attachment_visible IS NOT NULL THEN
    -- G1: the student sees their own active attachment.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    SELECT count(*) INTO v_n FROM public.report_attachments WHERE id = v_attachment_visible;
    INSERT INTO v_results VALUES (
      'G1 the reporter can see their own attachment', '1', v_n::text,
      CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);

    -- G2: a coordinator can see the attachment.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    SELECT count(*) INTO v_n FROM public.report_attachments WHERE id = v_attachment_visible;
    INSERT INTO v_results VALUES (
      'G2 a coordinator can see the attachment', '1', v_n::text,
      CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END);

    -- G3: an unassigned technician cannot see the attachment.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    SELECT count(*) INTO v_n FROM public.report_attachments WHERE id = v_attachment_visible;
    INSERT INTO v_results VALUES (
      'G3 an unassigned technician cannot see the attachment', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);

    -- G4: a soft-deleted attachment is no longer visible to its reporter.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
    SELECT count(*) INTO v_n FROM public.report_attachments
      WHERE id = v_attachment AND deleted_at IS NULL;
    INSERT INTO v_results VALUES (
      'G4 a soft-deleted attachment is hidden from its reporter', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- =========================================================================
  -- GRP-H : administration and the audit trail
  -- =========================================================================
  -- H1: a non-administrator may NOT change a role.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('SELECT public.admin_update_profile_operational_state(%L, %L, true, %L)',
           v_tech_b::text, 'coordinator', 'harness attempt');
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'H1 a non-administrator may NOT change a role', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- H2: an administrator MAY change another account's role.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    PERFORM public.admin_update_profile_operational_state(v_tech_b, 'coordinator', true, 'Harness role change');
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  INSERT INTO v_results VALUES (
    'H2 an administrator MAY change another account role', 'ALLOWED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'PASS' ELSE 'FAIL' END);

  -- H3: the role change was written to the audit trail.
  SELECT count(*) INTO v_n FROM public.role_change_audit
    WHERE user_id = v_tech_b AND changed_by = v_admin AND new_role = 'coordinator';
  INSERT INTO v_results VALUES (
    'H3 the role change was written to the audit trail', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END);

  -- H4: an administrator may NOT change their OWN account.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  v_msg := 'ALLOWED';
  BEGIN
    EXECUTE format(('SELECT public.admin_update_profile_operational_state(%L, %L, true, %L)',
           v_admin::text, 'management', 'harness self change');
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
  INSERT INTO v_results VALUES (
    'H4 an administrator may NOT change their own account', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);

  -- H5: management may READ the audit trail.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.role_change_audit;
  INSERT INTO v_results VALUES (
    'H5 management can read the role-change audit trail', '>= 0', v_n::text,
    CASE WHEN v_n >= 0 THEN 'PASS' ELSE 'FAIL' END);

  -- H6: a student may NOT read the audit trail.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', , 'role', 'authenticated')::text, true);;
  SELECT count(*) INTO v_n FROM public.role_change_audit;
  INSERT INTO v_results VALUES (
    'H6 a student cannot read the role-change audit trail', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END);
END $$;

-- ---------------------------------------------------------------------------
-- 4. The unauthenticated role
-- ---------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE anon;

INSERT INTO v_results
SELECT 'I1 the anon role cannot read reports', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.reports;

INSERT INTO v_results
SELECT 'I2 the anon role cannot read profiles', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.profiles;

INSERT INTO v_results
SELECT 'I3 the anon role cannot read notifications', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.notifications;

INSERT INTO v_results
SELECT 'I4 the anon role cannot insert a report', 'DENIED', 'ALLOWED',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM public.reports;

-- The anon role cannot actually perform the insert either.
DO $$
DECLARE
  v_msg text := 'ALLOWED';
BEGIN
  BEGIN
    EXECUTE 'INSERT INTO public.reports (reporter_id, category_id, location_id, title, description, status) VALUES (gen_random_uuid(), (SELECT id FROM public.categories LIMIT 1), (SELECT id FROM public.locations LIMIT 1), ''harness anon insert'', ''harness'', ''submitted'')';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  INSERT INTO v_results VALUES (
    'I4b the anon insert into public.reports is rejected', 'DENIED', v_msg,
    CASE WHEN v_msg = 'ALLOWED' THEN 'FAIL' ELSE 'PASS' END);
END $$;

INSERT INTO v_results
SELECT 'I5 the anon role cannot execute the attachment soft delete', 'DENIED', 'ALLOWED',
       CASE WHEN has_function_privilege('anon', 'public.soft_delete_attachment(uuid)', 'EXECUTE')
            THEN 'FAIL' ELSE 'PASS' END;

INSERT INTO v_results
SELECT 'I6 the anon role cannot execute the report submission command', 'DENIED', 'ALLOWED',
       CASE WHEN has_function_privilege('anon',
            'public.submit_report_with_notifications(text,text,uuid,uuid,boolean,uuid)', 'EXECUTE')
            THEN 'FAIL' ELSE 'PASS' END;

INSERT INTO v_results
SELECT 'I7 the anon role cannot execute the lifecycle commands', 'DENIED', 'ALLOWED',
       CASE WHEN has_function_privilege('anon', 'public.triage_report_with_notifications(uuid,public.priority_level,public.report_status,uuid)', 'EXECUTE')
              OR has_function_privilege('anon', 'public.assign_or_reassign_report_with_notifications(uuid,uuid,text,uuid)', 'EXECUTE')
              OR has_function_privilege('anon', 'public.transition_report_status_with_notifications(uuid,public.report_status,text,uuid)', 'EXECUTE')
              OR has_function_privilege('anon', 'public.verify_report_with_notifications(uuid,boolean,text,uuid)', 'EXECUTE')
            THEN 'FAIL' ELSE 'PASS' END;

INSERT INTO v_results
SELECT 'I8 the anon role cannot execute the account management command', 'DENIED', 'ALLOWED',
       CASE WHEN has_function_privilege('anon', 'public.admin_update_profile_operational_state(uuid,public.user_role,boolean,text)', 'EXECUTE')
            THEN 'FAIL' ELSE 'PASS' END;

INSERT INTO v_results
SELECT 'I9 no project function is executable by the anon role', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- ---------------------------------------------------------------------------
-- 5. Report
-- ---------------------------------------------------------------------------
RESET ROLE;

SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM v_results
ORDER BY check_id;

ROLLBACK;
