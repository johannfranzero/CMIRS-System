-- CMIRS Migration 11: Revoke Anonymous Execute Privilege on Project Functions
-- Phase 4C / 4E security hardening.
--
-- =============================================================================
-- FINDING
-- =============================================================================
-- Supabase configures ALTER DEFAULT PRIVILEGES for the `postgres` role so that every newly
-- created function automatically receives EXECUTE for `anon`, `authenticated` and
-- `service_role`. A `REVOKE ALL ... FROM PUBLIC` therefore does NOT remove the `anon`
-- privilege, because the default-privilege grant is an EXPLICIT grant to `anon`, not a grant
-- through PUBLIC.
--
-- Every function added by migrations 007 (notification lifecycle), 009 and 010 (technician
-- account management) was therefore executable by the unauthenticated `anon` role, even though
-- each function's internal authorization check refused the call. The remote verification
-- harness observed this directly:
--
--   AM-11 the account-management command is not executable by the anon role -> observed: executed
--   AM-12 the linkage helper is not executable by the anon role            -> observed: executed
--
-- No data was exposed: every one of these functions re-derives the actor from auth.uid() and
-- raises `CMIRS_NOT_AUTHENTICATED` when there is no session. This migration closes the
-- privilege gap so that the unauthenticated role cannot reach the function at all.
--
-- =============================================================================
-- SCOPE
-- =============================================================================
-- This migration REVOKE EXECUTE from `anon` only. It grants nothing, changes no data, and
-- alters no table, column, policy, role, or RLS rule. `service_role` keeps EXECUTE because it
-- is the trusted server-side role used by owner tooling; `authenticated` keeps EXECUTE because
-- the application calls these functions with a user session.
-- =============================================================================

-- Notification lifecycle command RPCs (migration 007)
REVOKE ALL ON FUNCTION public.submit_report_with_notifications(TEXT, TEXT, UUID, UUID, BOOLEAN, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.triage_report_with_notifications(UUID, public.priority_level, public.report_status, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.assign_or_reassign_report_with_notifications(UUID, UUID, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.transition_report_status_with_notifications(UUID, public.report_status, TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.verify_report_with_notifications(UUID, BOOLEAN, TEXT, UUID) FROM anon;

-- Private notification helpers (migration 007) — never executable by any session role.
REVOKE ALL ON FUNCTION public.notification_deliver(UUID, UUID, public.notification_type, TEXT, TEXT, UUID, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_receipt_acquire(UUID, TEXT, UUID, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_receipt_complete(UUID, UUID, JSONB) FROM anon, authenticated;

-- Technician account management (migrations 009 and 010)
REVOKE ALL ON FUNCTION public.admin_update_profile_operational_state(UUID, public.user_role, BOOLEAN, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.profile_has_auth_account(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.profiles_auth_account_status(UUID[]) FROM anon;

-- Pre-existing project functions that are also reachable by the default privileges.
-- These are re-asserted here so the whole project has one consistent, least-privilege posture.
REVOKE ALL ON FUNCTION public.can_view_report(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.decline_assignment(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_role() FROM anon;
