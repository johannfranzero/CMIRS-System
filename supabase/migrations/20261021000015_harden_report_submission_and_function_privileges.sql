-- =============================================================================
-- CMIRS Migration 15: Authorization Hardening for the Report-Submission Path
-- =============================================================================
-- STATUS: PREPARED AND LOCALLY VALIDATED — NOT APPLIED.
--
-- Applying this migration to the remote project changes database behaviour and
-- therefore requires EXPLICIT OWNER AUTHORIZATION. It must NOT be applied as part
-- of an unattended `supabase db push`.
--
-- -----------------------------------------------------------------------------
-- FINDING 1 (HIGH) — the report-submission role restriction is enforced only in
--                   the application layer.
-- -----------------------------------------------------------------------------
-- `docs/ROLES.md` (PD-R6) records the resolution that ONLY Student/Personnel and
-- Maintenance Coordinator may file a maintenance report, and states that this is
-- enforced "on the server ... and, in
-- `supabase/migrations/20261021000014_restrict_report_submission_roles.sql`, at the
-- database layer".
--
-- The live database does not enforce it:
--
--   * The live `reports_insert` RLS policy has no role restriction, because
--     migration 014 has not been applied.
--   * `public.submit_report_with_notifications(...)` is SECURITY DEFINER (it
--     executes as the table owner, so RLS never applies to it) and it only requires
--     an ACTIVE PROFILE with a role. It performs NO reporter-role check.
--
-- Consequence: any authenticated session (technician, administrator, management) can
-- create a report by calling the RPC directly, or by POSTing to
-- `/rest/v1/reports`, bypassing the Next.js Server Action entirely. The publishable
-- Supabase key is public, so no secret is needed to do this.
--
-- REMEDIATION (this migration)
--   A single control point is added at the table itself: a BEFORE INSERT trigger on
--   `public.reports` that rejects the insert unless the authenticated caller holds
--   the reporter role. Because the trigger fires for EVERY insert path, it closes the
--   RPC path, the PostgREST path and any future path at once — including the path
--   migration 014 restricts. Migration 014 remains valuable as defence in depth and
--   should still be applied.
--
--   `auth.uid() IS NULL` means the insert did not originate from an authenticated
--   session (owner tooling, `service_role`, the seed file). Those callers keep their
--   existing access; anonymous PostgREST callers are still stopped by RLS.
--
-- -----------------------------------------------------------------------------
-- FINDING 2 (HIGH) — `soft_delete_attachment(UUID)` is executable by `anon`, and
--                   its only authorization check fails open.
-- -----------------------------------------------------------------------------
-- Two independent defects combine:
--
--   (a) Migration 11 revoked the `anon` EXECUTE grant from thirteen project
--       functions but omitted `soft_delete_attachment(UUID)`. Supabase's
--       `ALTER DEFAULT PRIVILEGES` grants `anon` an EXPLICIT EXECUTE privilege, so
--       `REVOKE ... FROM PUBLIC` does not remove it. The unauthenticated role can
--       therefore still reach the function. This was confirmed against the live
--       project on 2026-10-22.
--
--   (b) The function's only authorization check is
--
--           caller_role := public.get_user_role();
--           IF caller_role != 'coordinator' THEN
--             RAISE EXCEPTION 'Access denied: ...';
--           END IF;
--
--       `get_user_role()` returns NULL when the caller has no profile row, and in
--       PL/pgSQL `IF NULL THEN` is FALSE. The exception therefore never fires and
--       execution continues into the SECURITY DEFINER UPDATE.
--
-- REMEDIATION (this migration)
--   * The `anon` EXECUTE grant is revoked, together with the six trigger functions
--     that migration 11 also omitted.
--   * The guard is rewritten to fail CLOSED: `IS DISTINCT FROM 'coordinator'` and an
--     explicit requirement for an active institutional profile.
--
-- -----------------------------------------------------------------------------
-- FINDING 3 (MEDIUM) — `decline_assignment` has the same NULL-unsafe guard.
-- ------------------------------------------------------------------------------
-- The same `IF caller_role != 'technician'` pattern is rewritten to fail closed.
--
-- -----------------------------------------------------------------------------
-- FINDING 4 (MEDIUM) — `public.notification_command_receipts` has no Row Level
--                       Security enabled.
-- ------------------------------------------------------------------------------
-- It is the only table in the `public` schema without RLS. It is protected today
-- only by `REVOKE ALL ... FROM anon, authenticated`, which leaves it one accidental
-- grant away from being exposed. RLS is enabled here so that the table is protected
-- by two independent mechanisms. The SECURITY DEFINER command functions that own the
-- table continue to work: the table owner and `service_role` are not subject to RLS.
--
-- -----------------------------------------------------------------------------
-- FINDING 5 (LOW) — `anon` retains blanket table privileges on `public.notifications`.
-- ------------------------------------------------------------------------------
-- Supabase's default privileges grant `anon` INSERT/UPDATE/DELETE on every table in
-- the `public` schema. No policy targets `anon`, so the privileges are inert today,
-- but they would become live the moment a policy is added for `anon`. The grants are
-- revoked here.
--
-- =============================================================================
-- SCOPE
-- =============================================================================
-- * Adds one trigger function and one trigger.
-- * Replaces two function bodies with fail-closed equivalents (same signatures,
--   same return types, same behaviour for every authorized caller).
-- * Enables RLS on one table that has no client-facing policies.
-- * Revokes EXECUTE from `anon` on seven functions and table privileges from `anon`
--   on one table.
-- * Grants nothing. Changes no data. Deletes nothing. Truncates nothing.
-- =============================================================================

-- =============================================================================
-- 1. Enforce the reporter role on every insert into `public.reports`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_report_submission_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_caller_role public.user_role;
BEGIN
  -- No authenticated session: owner tooling, `service_role` and the seed file.
  -- The Row Level Security policies remain the authority for anonymous callers.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.role INTO v_caller_role
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.is_active;

  IF v_caller_role IS NULL
     OR v_caller_role NOT IN ('student_personnel', 'coordinator') THEN
    RAISE EXCEPTION 'CMIRS_FORBIDDEN: only Students/Personnel and Maintenance Coordinators may submit maintenance reports'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- A trigger function needs no EXECUTE privilege for the triggering user at runtime
-- (PostgreSQL checks EXECUTE only when the trigger is created), so the public
-- execution path is closed without affecting the trigger itself.
REVOKE ALL ON FUNCTION public.enforce_report_submission_role() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_enforce_report_submission_role ON public.reports;

CREATE TRIGGER trg_enforce_report_submission_role
  BEFORE INSERT ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_report_submission_role();

-- =============================================================================
-- 2. Fail-closed `soft_delete_attachment`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.soft_delete_attachment(attachment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller_role user_role;
  current_deleted_at TIMESTAMPTZ;
BEGIN
  caller_role := public.get_user_role();

  -- Fail CLOSED: `IS DISTINCT FROM` is true when `caller_role` is NULL, so a caller
  -- without an active institutional profile is rejected instead of passing the check.
  IF caller_role IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Access denied: Only coordinators may soft-delete attachments.';
  END IF;

  SELECT deleted_at INTO current_deleted_at
  FROM public.report_attachments
  WHERE id = attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attachment not found.';
  END IF;

  IF current_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Attachment is already deleted.';
  END IF;

  UPDATE public.report_attachments
  SET deleted_at = now(),
      deleted_by = auth.uid()
  WHERE id = attachment_id;
END;
$$;

-- =============================================================================
-- 3. Fail-closed `decline_assignment`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.decline_assignment(target_assignment_id UUID, reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller_role user_role;
  curr_tech_id UUID;
  curr_status assignment_status;
BEGIN
  caller_role := public.get_user_role();

  -- Fail CLOSED on a NULL role (see finding 3).
  IF caller_role IS DISTINCT FROM 'technician' THEN
    RAISE EXCEPTION 'Access denied: Only technicians may decline assignments.';
  END IF;

  IF reason IS NULL OR btrim(reason) = '' THEN
    RAISE EXCEPTION 'A non-empty decline reason is required.';
  END IF;

  SELECT technician_id, status INTO curr_tech_id, curr_status
  FROM public.assignments
  WHERE id = target_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found.';
  END IF;

  IF curr_tech_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied: You can only decline your own assignment.';
  END IF;

  IF curr_status IS DISTINCT FROM 'assigned' THEN
    RAISE EXCEPTION 'Assignments can only be declined from assigned status.';
  END IF;

  UPDATE public.assignments
  SET status = 'declined',
      decline_reason = reason
  WHERE id = target_assignment_id;
END;
$$;

-- =============================================================================
-- 4. Row Level Security on the command-receipt table.
-- =============================================================================
ALTER TABLE public.notification_command_receipts ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. Least-privilege cleanup of the `anon` role.
-- =============================================================================
-- The mutating RPC that migration 11 omitted.
REVOKE ALL ON FUNCTION public.soft_delete_attachment(UUID) FROM anon;

-- The six trigger functions that migration 11 also omitted. They cannot be called
-- directly (`RETURNS TRIGGER`), but the grants are an undocumented residual
-- privilege and are removed for a consistent least-privilege posture.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.generate_report_number() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_report_immutable_col_update() FROM anon;
REVOKE ALL ON FUNCTION public.record_status_history() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.lock_attachment_count() FROM anon;

-- Blanket table privileges that Supabase's default privileges grant to `anon`.
REVOKE ALL ON public.notifications FROM anon;
