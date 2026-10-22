-- CMIRS Migration 10: Bulk Auth-Account Linkage Status
-- Phase 4E: the administrator user directory must show, for every account, whether a
-- confirmed Supabase Auth user actually exists behind it.
--
-- Migration 9 added the single-row check `public.profile_has_auth_account(uuid)`. The
-- directory can contain up to 1000 accounts, so this migration adds the equivalent BULK
-- form so that the whole directory is resolved with ONE round trip instead of one call per
-- account.
--
-- The function returns one boolean per requested profile id and nothing else: no email
-- address, no token, no session, no password hash, no auth metadata.
--
-- Security:
--   * SECURITY DEFINER with a fixed search_path.
--   * EXECUTE is granted to `authenticated` only.
--   * It is strictly read-only.

CREATE OR REPLACE FUNCTION public.profiles_auth_account_status(p_profile_ids UUID[])
RETURNS TABLE (profile_id UUID, has_auth_account BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
  SELECT p.id,
         EXISTS (
           SELECT 1
           FROM auth.users u
           WHERE u.id = p.id
             AND u.confirmed_at IS NOT NULL
             AND u.email_confirmed_at IS NOT NULL
         )
  FROM unnest(coalesce(p_profile_ids, ARRAY[]::uuid[])) AS p(id);
$function$;

REVOKE ALL ON FUNCTION public.profiles_auth_account_status(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profiles_auth_account_status(UUID[]) TO authenticated;
