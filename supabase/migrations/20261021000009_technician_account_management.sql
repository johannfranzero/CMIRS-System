-- CMIRS Migration 9: Technician Account Management Support
-- Phase 4E: administrator account management for real technician accounts.
--
-- =============================================================================
-- PURPOSE
-- =============================================================================
-- The administrator settings screen must be able to distinguish a REAL, usable technician
-- account from a manually inserted profile row that has no Supabase Auth user behind it.
-- Phase 4E requires:
--   * "Ensure each operational technician is linked to a valid Supabase Auth user."
--   * "Do not pretend a manually inserted profile without a valid authentication account is
--      a working technician."
--
-- This migration adds exactly two narrow, hardened functions:
--
-- 1. public.profile_has_auth_account(p_profile_id UUID) -> BOOLEAN
--    A READ-ONLY existence check against auth.users. It returns a single boolean and never
--    exposes an email address, a token, a session, a password hash, or any other auth
--    attribute. It is the minimum information required to tell an operable account from a
--    profile row that cannot sign in.
--
-- 2. public.admin_update_profile_operational_state(
--        p_profile_id UUID, p_role user_role, p_is_active BOOLEAN, p_reason TEXT
--    ) -> JSONB
--    A SECURITY DEFINER command that changes a profile's role and/or activation state and
--    writes the `role_change_audit` row in the SAME transaction, so the audit trail can
--    never drift from the change it records.
--
-- =============================================================================
-- SECURITY CONTROLS
-- =============================================================================
--   * The caller must be an ACTIVE administrator (derived from auth.uid() only).
--   * An administrator may never alter their own row (mirrors the existing
--     `profiles_update_admin` RLS policy).
--   * The target profile must exist and must not be the caller.
--   * The audit row is written only when the role actually changes, matching the
--     `chk_role_changed` CHECK constraint on `public.role_change_audit`.
--   * No other table, policy, permission, or data is touched.
-- =============================================================================

-- =============================================================================
-- 1. Read-only auth-account linkage check
-- =============================================================================
CREATE OR REPLACE FUNCTION public.profile_has_auth_account(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_profile_id
      AND u.confirmed_at IS NOT NULL
      AND u.email_confirmed_at IS NOT NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.profile_has_auth_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_has_auth_account(UUID) TO authenticated;

-- =============================================================================
-- 2. Administrator account-management command
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_update_profile_operational_state(
  p_profile_id UUID,
  p_role public.user_role,
  p_is_active BOOLEAN,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role public.user_role;
  v_old_role public.user_role;
  v_old_active BOOLEAN;
  v_new_role public.user_role;
  v_new_active BOOLEAN;
  v_reason TEXT;
BEGIN
  -- Identity and authorization ---------------------------------------------------
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CMIRS_NOT_AUTHENTICATED: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.is_active;

  IF v_actor_role IS DISTINCT FROM 'administrator' THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: only Administrators may manage institutional accounts'
      USING ERRCODE = '42501';
  END IF;

  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: a target account is required'
      USING ERRCODE = '22023';
  END IF;

  -- An administrator may never alter their own account (mirrors the RLS policy).
  IF p_profile_id = v_actor THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: an administrator may not alter their own account'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the target row -----------------------------------------------------------
  SELECT p.role, p.is_active INTO v_old_role, v_old_active
  FROM public.profiles p
  WHERE p.id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CMIRS_NOT_FOUND: the target account could not be found'
      USING ERRCODE = 'P0002';
  END IF;

  v_new_role := coalesce(p_role, v_old_role);
  v_new_active := coalesce(p_is_active, v_old_active);
  v_reason := NULLIF(btrim(coalesce(p_reason, '')), '');

  IF v_new_role = v_old_role AND v_new_active = v_old_active THEN
    RAISE EXCEPTION 'CMIRS_INVALID_STATE: the account already has the requested state'
      USING ERRCODE = '22023';
  END IF;

  IF v_new_role <> v_old_role AND (v_reason IS NULL OR length(v_reason) < 5) THEN
    RAISE EXCEPTION 'CMIRS_INVALID_INPUT: a reason of at least 5 characters is required for a role change'
      USING ERRCODE = '22023';
  END IF;

  -- Source mutation ----------------------------------------------------------------
  UPDATE public.profiles
     SET role = v_new_role,
         is_active = v_new_active
   WHERE id = p_profile_id;

  -- Audit trail (only when the role actually changed, per `chk_role_changed`) --------
  IF v_new_role <> v_old_role THEN
    INSERT INTO public.role_change_audit (user_id, changed_by, old_role, new_role, reason)
    VALUES (p_profile_id, v_actor, v_old_role, v_new_role, v_reason);
  END IF;

  RETURN jsonb_build_object(
    'profile_id', p_profile_id,
    'old_role', v_old_role::text,
    'new_role', v_new_role::text,
    'old_is_active', v_old_active,
    'new_is_active', v_new_active,
    'role_changed', (v_new_role <> v_old_role),
    'has_auth_account', public.profile_has_auth_account(p_profile_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_profile_operational_state(UUID, public.user_role, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_profile_operational_state(UUID, public.user_role, BOOLEAN, TEXT) TO authenticated;
