-- CMIRS Migration 8: Report Visibility Function — Parameter Ambiguity Repair (42702)
-- Phase 4D.2: Prepared migration — PREPARED AND LOCALLY VALIDATED, NOT APPLIED
-- Source: docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md §9.1
--         docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md
-- Supersedes the definition of public.can_view_report() created in
--   20261018000004_security_functions_and_rpc.sql (section 2).
--
-- =============================================================================
-- DEFECT
-- =============================================================================
-- Live remote evidence (captured from the running application; see
-- .next/dev/logs/next-development.log):
--
--   [DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous"
--   | code= "42702" | status= "unknown"
--
-- PostgreSQL SQLSTATE 42702 is `ambiguous_column`. It is raised by PL/pgSQL when a
-- name inside a function body can denote either a PL/pgSQL variable (here: the
-- `report_id` input parameter) or a column of a table in the same FROM clause.
-- PL/pgSQL's default `plpgsql.variable_conflict = error` turns that ambiguity into
-- a hard error at parse time.
--
-- The single ambiguous expression in the original body was the technician branch:
--
--   IF caller_role = 'technician' AND EXISTS (
--     SELECT 1 FROM public.assignments a
--     WHERE a.report_id = report_id        -- <-- AMBIGUOUS
--       AND a.technician_id = auth.uid()
--       AND a.status != 'declined'
--   ) THEN
--
-- `public.assignments` has a `report_id` column (20261018000001_core_schema.sql),
-- and the function parameter is also named `report_id`, so the right-hand side is
-- ambiguous. The reporter branch (`r.id = report_id` over `public.reports`) was NOT
-- ambiguous, because `public.reports` has no `report_id` column.
--
-- SECURITY NOTE — why this must be fixed and not left to fail:
-- had the unqualified `report_id` resolved to the COLUMN (as plain SQL would), the
-- predicate would have degraded to `a.report_id = a.report_id`, i.e. always true for
-- any assignment row. That would have let ANY technician satisfy the visibility
-- predicate for ANY report that has any assignment. SQLSTATE 42702 is currently
-- *preventing* that visibility bypass. The repair below restores the intended
-- comparison: `assignments.report_id = <the report id argument>`.
--
-- IMPACT
-- Because the `reports_select` RLS policy is `USING (public.can_view_report(id))`,
-- and because the whole `IF` expression is parsed as one statement, the failure
-- applies to every caller that reaches the third branch. Oversight roles
-- (coordinator, administrator, management) return TRUE in the first branch and are
-- unaffected; `student_personnel` and `technician` are affected, and EVERY
-- `SELECT` on `public.reports` failed for them, together with the dependent
-- policies on `public.report_attachments`, `public.report_status_history`,
-- `public.report_comments`, `public.verifications` and `storage.objects`.
--
-- =============================================================================
-- REPAIR STRATEGY
-- =============================================================================
-- 1. The input parameter is deliberately KEPT as `report_id`.
--    - `CREATE OR REPLACE FUNCTION` cannot rename an input parameter: PostgreSQL
--      rejects it with `cannot change name of input parameter "report_id"`.
--    - `DROP FUNCTION public.can_view_report(UUID)` is not an option either,
--      because the RLS policies and the `storage.objects` policy depend on the
--      function; dropping it would require dropping and recreating those policies,
--      i.e. an RLS change.
--    - Therefore the signature `can_view_report(UUID)` — and consequently every
--      existing call site and the `REVOKE`/`GRANT` privilege statements — remains
--      byte-for-byte compatible.
--
-- 2. The parameter is resolved once into a local variable whose name cannot
--    collide with any column of the tables queried by this function
--    (`public.reports`, `public.assignments`). Every subsequent comparison uses
--    that local, so no name in this body can be ambiguous any more.
--
-- 3. `#variable_conflict use_variable` is declared so that PL/pgSQL always
--    prefers the PL/pgSQL variable when a name could match both a variable and a
--    column. This makes the parameter resolution deterministic and independent of
--    the server's `plpgsql.variable_conflict` setting.
--
-- 4. The three authorization branches are reproduced VERBATIM from the approved
--    definition in migration 4. No condition is added, removed, weakened, or
--    broadened. Report visibility is NOT widened: the oversight, reporter and
--    technician rules are byte-identical to the approved intent.
--
-- 5. `SECURITY DEFINER`, `STABLE` and the fixed `search_path` are preserved, and
--    the `REVOKE`/`GRANT` pair is re-issued so the privilege set is provably
--    unchanged (it is already identical, so this is a no-op that also protects
--    against a drifted remote state).
--
-- No table, column, index, trigger, policy, role, or data is touched by this
-- migration. It replaces exactly one function body.

-- =============================================================================
-- 1. Repaired helper: can_view_report(report_id UUID) (APPROVED OD-NEW-4)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.can_view_report(report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
#variable_conflict use_variable
DECLARE
  caller_role user_role;
  target_report_id UUID;
BEGIN
  -- Resolve the input argument into a local variable whose name cannot collide
  -- with any column of the tables queried below. `public.assignments` owns a
  -- `report_id` column, which is what made the original `a.report_id = report_id`
  -- comparison ambiguous (SQLSTATE 42702).
  target_report_id := report_id;

  caller_role := public.get_user_role();

  -- 1. Oversight roles see all reports
  IF caller_role IN ('coordinator', 'administrator', 'management') THEN
    RETURN TRUE;
  END IF;

  -- 2. Reporter sees own report regardless of current role
  IF EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = target_report_id
      AND r.reporter_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. Technician with qualifying assignment (all statuses EXCEPT declined, APPROVED OD-NEW-4)
  IF caller_role = 'technician' AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = target_report_id
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$;

-- =============================================================================
-- 2. Security hardening — identical to the approved definition in migration 4.
--    Re-issued so the remote privilege set is provably unchanged.
-- =============================================================================
REVOKE ALL ON FUNCTION public.can_view_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_report(UUID) TO authenticated;
