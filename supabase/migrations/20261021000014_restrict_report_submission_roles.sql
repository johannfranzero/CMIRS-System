-- CMIRS Migration 14: Restrict Report Submission to the Reporter Roles (RLS)
-- Phase 4H: technician role, assignment, and completion workflow repair.
--
-- =============================================================================
-- PURPOSE
-- =============================================================================
-- Only the reporter roles may file a maintenance report:
--
--   * Student / School Personnel  — the primary reporter (docs/ROLES.md).
--   * Maintenance Coordinator     — may raise a report on the user's behalf (role matrix).
--
-- A Maintenance Technician, a School Administrator and School Management may NOT file a
-- report. The application already enforces this in the `submitReportAction` Server Action
-- and in the `/reports/new` route; this migration adds the database-level enforcement that
-- `docs/SECURITY.md` requires ("Database-level enforcement. PostgreSQL Row Level Security
-- (RLS) policies must enforce role-based access at the database layer, providing defense in
-- depth").
--
-- The existing `reports_insert` policy checked only that the caller set `reporter_id` to
-- their own id and that the row starts in the `submitted` state, so ANY authenticated role
-- could insert a report directly through PostgREST.
--
-- =============================================================================
-- EFFECT AND SAFETY
-- =============================================================================
--   * The policy is replaced with the same predicate plus a role restriction. No other
--     condition is added or removed.
--   * The application path is unaffected: the submission command
--     `public.submit_report_with_notifications(...)` is SECURITY DEFINER and executes as the
--     table owner, so RLS is not applied to it. The command itself re-checks the caller's
--     role before inserting.
--   * No table, column, index, trigger, role, grant, or data is created, altered or removed.
--   * Reversible: re-running the migration-005 definition restores the previous policy.
--
-- =============================================================================
-- STATUS
-- =============================================================================
-- PREPARED AND LOCALLY VALIDATED — NOT APPLIED. Applying it to the remote project is a
-- production policy change and requires explicit owner authorization. See
-- `docs/frontend/PHASE_4H_TECHNICIAN_WORKFLOW_REPORT.md` for the exact apply command.
-- =============================================================================

DROP POLICY IF EXISTS "reports_insert" ON public.reports;

CREATE POLICY "reports_insert" ON public.reports
FOR INSERT TO authenticated
WITH CHECK (
  reporter_id = auth.uid()
  AND status = 'submitted'
  AND confirmed_priority IS NULL
  -- Only the reporter roles may file a maintenance report (Phase 4H).
  AND public.get_user_role() IN ('student_personnel', 'coordinator')
);
