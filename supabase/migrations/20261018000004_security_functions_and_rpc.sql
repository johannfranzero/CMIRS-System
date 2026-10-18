-- CMIRS Migration 4: Security Helper Functions and Privileged RPCs
-- Phase 4A: Migration SQL Generation (No Execution)
-- Source: docs/database-design/RLS_POLICY_PROPOSAL.md, PHASE_3G_PRE_MIGRATION_GATE.md

-- =============================================================================
-- 1. Helper Function: get_user_role()
-- Returns caller's user_role from profiles table
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS user_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  current_role user_role;
BEGIN
  SELECT role INTO current_role
  FROM public.profiles
  WHERE id = auth.uid();

  RETURN current_role;
END;
$$;

-- Security hardening: restrict default execution privileges
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;

-- =============================================================================
-- 2. Helper Function: can_view_report(report_id UUID) (APPROVED OD-NEW-4)
-- Centralized visibility predicate:
-- 1. Coordinators, Administrators, and Management see all reports
-- 2. Reporters see own reports regardless of role
-- 3. Technicians see reports where they have a qualifying assignment (status != 'declined')
-- =============================================================================
CREATE OR REPLACE FUNCTION public.can_view_report(report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  current_role user_role;
BEGIN
  current_role := public.get_user_role();

  -- 1. Oversight roles see all reports
  IF current_role IN ('coordinator', 'administrator', 'management') THEN
    RETURN TRUE;
  END IF;

  -- 2. Reporter sees own report regardless of current role
  IF EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = report_id
      AND r.reporter_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. Technician with qualifying assignment (all statuses EXCEPT declined, APPROVED OD-NEW-4)
  IF current_role = 'technician' AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = report_id
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Security hardening: restrict default execution privileges
REVOKE ALL ON FUNCTION public.can_view_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_report(UUID) TO authenticated;

-- =============================================================================
-- 3. RPC: soft_delete_attachment(attachment_id UUID) (APPROVED PD-D2, OD-NEW-2)
-- Coordinator-only soft deletion:
-- Sets deleted_at = now() and deleted_by = auth.uid()
-- Leaves all immutable file metadata intact
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
  IF caller_role != 'coordinator' THEN
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

-- Security hardening: Finding 6 mitigation
REVOKE ALL ON FUNCTION public.soft_delete_attachment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_attachment(UUID) TO authenticated;

-- =============================================================================
-- 4. RPC: decline_assignment(target_assignment_id UUID, reason TEXT) (APPROVED PD-R2, OD-NEW-3, OD-REC-1)
-- Technician-only assignment decline:
-- Requires non-empty, non-whitespace reason via btrim()
-- Validates caller owns the assignment and assignment is currently in 'assigned' status
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
  IF caller_role != 'technician' THEN
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

  IF curr_tech_id != auth.uid() THEN
    RAISE EXCEPTION 'Access denied: You can only decline your own assignment.';
  END IF;

  IF curr_status != 'assigned' THEN
    RAISE EXCEPTION 'Assignments can only be declined from assigned status.';
  END IF;

  UPDATE public.assignments
  SET status = 'declined',
      decline_reason = reason
  WHERE id = target_assignment_id;
END;
$$;

-- Security hardening: restrict default execution privileges
REVOKE ALL ON FUNCTION public.decline_assignment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_assignment(UUID, TEXT) TO authenticated;
