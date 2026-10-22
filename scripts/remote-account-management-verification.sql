-- =============================================================================
-- CMIRS — Remote Account Management & Auth-Linkage Verification Harness
-- File: scripts/remote-account-management-verification.sql
--
-- Verifies, against the real Supabase project and with a rolled-back transaction:
--   * public.profile_has_auth_account() reports the REAL auth linkage per profile;
--   * public.profiles_auth_account_status() resolves the whole directory in one call;
--   * an administrator can change another account's role, and the change is recorded in
--     public.role_change_audit;
--   * an administrator can activate / deactivate an account;
--   * an administrator may NOT alter their own account;
--   * a non-administrator is refused;
--   * a role change without a reason is refused;
--   * a no-op change is refused.
--
-- SAFETY: everything runs inside ONE transaction that is ALWAYS rolled back.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE am_results (
  check_id text primary key,
  expectation text,
  observed text,
  verdict text
) ON COMMIT DROP;

CREATE TEMP TABLE am_actor (
  role_name text primary key,
  profile_id uuid
) ON COMMIT DROP;

INSERT INTO am_actor
SELECT p.role::text, p.id
FROM public.profiles p
WHERE p.role::text IN ('administrator', 'coordinator', 'technician');

-- Privileged snapshot of the real auth linkage, captured BEFORE the role switch.
CREATE TEMP TABLE am_auth_truth (profile_id uuid primary key, has_auth boolean) ON COMMIT DROP;
INSERT INTO am_auth_truth
SELECT p.id,
       EXISTS (SELECT 1 FROM auth.users u
               WHERE u.id = p.id AND u.confirmed_at IS NOT NULL AND u.email_confirmed_at IS NOT NULL)
FROM public.profiles p;
GRANT SELECT ON am_auth_truth TO authenticated;
GRANT SELECT, INSERT ON am_results, am_actor TO authenticated;
GRANT SELECT, INSERT ON am_results, am_actor TO anon;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_admin uuid;
  v_coordinator uuid;
  v_tech uuid;
  v_tech2 uuid;
  v_n integer;
  v_ok boolean;
  v_txt text;
  v_err text;
  v_result jsonb;
BEGIN
  SELECT profile_id INTO v_admin      FROM am_actor WHERE role_name = 'administrator';
  SELECT profile_id INTO v_coordinator FROM am_actor WHERE role_name = 'coordinator';
  SELECT profile_id INTO v_tech       FROM am_actor WHERE role_name = 'technician';

  -- Pick a second technician to act on. The remote currently has one technician, so the
  -- coordinator account is used as the management target.
  v_tech2 := v_coordinator;

  -- -------------------------------------------------------------------
  -- 1. Auth linkage status
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  SELECT public.profile_has_auth_account(v_admin) INTO v_ok;
  INSERT INTO am_results VALUES (
    'AM-01 profile_has_auth_account reports the real linkage for the administrator',
    'true (a confirmed auth user exists)',
    v_ok::text,
    CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT count(*) INTO v_n
  FROM public.profiles_auth_account_status(ARRAY[v_admin, v_tech]);

  INSERT INTO am_results VALUES (
    'AM-02 the bulk linkage status resolves one row per requested profile',
    '2',
    v_n::text,
    CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END
  );

  -- The linkage status must agree with a privileged snapshot of auth.users.
  SELECT count(*) INTO v_n
  FROM public.profiles p
  WHERE p.id IN (v_admin, v_tech)
    AND public.profile_has_auth_account(p.id)
    AND (SELECT t.has_auth FROM am_auth_truth t WHERE t.profile_id = p.id);

  INSERT INTO am_results VALUES (
    'AM-03 the reported linkage matches a direct read of auth.users',
    '2',
    v_n::text,
    CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 2. A non-administrator is refused
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_coordinator, 'role','authenticated')::text, true);

  BEGIN
    PERFORM public.admin_update_profile_operational_state(
      v_tech2, 'technician'::public.user_role, TRUE, 'Coordinator attempt');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO am_results VALUES (
    'AM-04 a non-administrator may not manage accounts',
    'CMIRS_FORBIDDEN',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_FORBIDDEN%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 3. An administrator may not alter their own account
  -- -------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  BEGIN
    PERFORM public.admin_update_profile_operational_state(
      v_admin, 'administrator'::public.user_role, TRUE, 'Self management attempt');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO am_results VALUES (
    'AM-05 an administrator may not alter their own account',
    'CMIRS_FORBIDDEN',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_FORBIDDEN%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 4. A role change without a reason is refused
  -- -------------------------------------------------------------------
  BEGIN
    PERFORM public.admin_update_profile_operational_state(
      v_tech2, 'technician'::public.user_role, TRUE, '');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO am_results VALUES (
    'AM-06 a role change without a reason is refused',
    'CMIRS_INVALID_INPUT',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_INPUT%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 5. A role change succeeds and is recorded in the audit trail
  -- -------------------------------------------------------------------
  v_result := public.admin_update_profile_operational_state(
    v_tech2, 'technician'::public.user_role, TRUE,
    'Reassigned to the technician role by the verification harness'
  );

  INSERT INTO am_results VALUES (
    'AM-07 the role change reports the previous and the new role',
    'coordinator -> technician',
    coalesce((v_result ->> 'old_role') || ' -> ' || (v_result ->> 'new_role'), 'null'),
    CASE WHEN (v_result ->> 'old_role') = 'coordinator' AND (v_result ->> 'new_role') = 'technician'
         THEN 'PASS' ELSE 'FAIL' END
  );

  SELECT count(*) INTO v_n
  FROM public.role_change_audit a
  WHERE a.user_id = v_tech2 AND a.changed_by = v_admin
    AND a.old_role = 'coordinator' AND a.new_role = 'technician';

  INSERT INTO am_results VALUES (
    'AM-08 the role change is recorded in the role-change audit trail',
    '1 audit row',
    v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 6. An activation change succeeds without a role change
  -- -------------------------------------------------------------------
  v_result := public.admin_update_profile_operational_state(
    v_tech2, 'technician'::public.user_role, FALSE,
    'Suspended by the verification harness'
  );

  INSERT INTO am_results VALUES (
    'AM-09 an activation-only change succeeds',
    'technician / is_active=false',
    coalesce((v_result ->> 'new_role') || ' / is_active=' || (v_result ->> 'new_is_active')::text, 'null'),
    CASE WHEN (v_result ->> 'new_is_active') = 'false' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 7. A no-op change is refused
  -- -------------------------------------------------------------------
  BEGIN
    PERFORM public.admin_update_profile_operational_state(
      v_tech2, 'technician'::public.user_role, FALSE, 'No-op attempt');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO am_results VALUES (
    'AM-10 a no-op account change is refused',
    'CMIRS_INVALID_STATE',
    coalesce(v_err, 'no error raised'),
    CASE WHEN v_err LIKE '%CMIRS_INVALID_STATE%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- -------------------------------------------------------------------
  -- 8. The command is not executable by the anonymous role
  -- -------------------------------------------------------------------
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.admin_update_profile_operational_state(
      v_tech2, 'technician'::public.user_role, TRUE, 'Anonymous attempt');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO am_results VALUES (
    'AM-11 the account-management command is not executable by the anon role',
    'permission denied',
    coalesce(v_err, 'executed'),
    CASE WHEN v_err ILIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END
  );

  -- The linkage helper must not leak auth data either.
  BEGIN
    SELECT public.profile_has_auth_account(v_admin) INTO v_ok;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  INSERT INTO am_results VALUES (
    'AM-12 the linkage helper is not executable by the anon role',
    'permission denied',
    coalesce(v_err, 'executed'),
    CASE WHEN v_err ILIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END
  );
END $$;

SELECT
  check_id,
  expectation,
  observed,
  verdict,
  CASE WHEN verdict = 'PASS' THEN '' ELSE '  <-- FAILED' END AS note
FROM am_results
ORDER BY check_id;

ROLLBACK;
