-- CMIRS Migration 5: Row Level Security Policies for All Tables
-- Phase 4A: Migration SQL Generation (No Execution)
-- Source: docs/database-design/RLS_POLICY_PROPOSAL.md, PHASE_3G_PRE_MIGRATION_GATE.md

-- =============================================================================
-- Enable Row Level Security on all 12 tables
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Table 1: profiles
-- =============================================================================
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.get_user_role() IN ('coordinator', 'administrator', 'management')
);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
);

DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.get_user_role() = 'administrator'
  AND id != auth.uid() -- Administrators cannot alter their own role
)
WITH CHECK (
  public.get_user_role() = 'administrator'
  AND id != auth.uid()
);

-- =============================================================================
-- Table 2: role_change_audit (APPROVED OD-NEW-1)
-- =============================================================================
DROP POLICY IF EXISTS "role_change_audit_select" ON public.role_change_audit;
CREATE POLICY "role_change_audit_select" ON public.role_change_audit
FOR SELECT TO authenticated
USING (
  public.get_user_role() IN ('administrator', 'management')
);

DROP POLICY IF EXISTS "role_change_audit_insert" ON public.role_change_audit;
CREATE POLICY "role_change_audit_insert" ON public.role_change_audit
FOR INSERT TO authenticated
WITH CHECK (
  public.get_user_role() = 'administrator'
  AND changed_by = auth.uid()
);

-- =============================================================================
-- Table 3: categories
-- =============================================================================
DROP POLICY IF EXISTS "categories_select" ON public.categories;
CREATE POLICY "categories_select" ON public.categories
FOR SELECT TO authenticated
USING (
  is_active = true
  OR public.get_user_role() IN ('coordinator', 'administrator', 'management')
);

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
CREATE POLICY "categories_insert" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (
  public.get_user_role() IN ('coordinator', 'administrator')
);

DROP POLICY IF EXISTS "categories_update" ON public.categories;
CREATE POLICY "categories_update" ON public.categories
FOR UPDATE TO authenticated
USING (
  public.get_user_role() IN ('coordinator', 'administrator')
)
WITH CHECK (
  public.get_user_role() IN ('coordinator', 'administrator')
);

-- =============================================================================
-- Table 4: locations
-- =============================================================================
DROP POLICY IF EXISTS "locations_select" ON public.locations;
CREATE POLICY "locations_select" ON public.locations
FOR SELECT TO authenticated
USING (
  is_active = true
  OR public.get_user_role() IN ('coordinator', 'administrator', 'management')
);

DROP POLICY IF EXISTS "locations_insert" ON public.locations;
CREATE POLICY "locations_insert" ON public.locations
FOR INSERT TO authenticated
WITH CHECK (
  public.get_user_role() IN ('coordinator', 'administrator')
);

DROP POLICY IF EXISTS "locations_update" ON public.locations;
CREATE POLICY "locations_update" ON public.locations
FOR UPDATE TO authenticated
USING (
  public.get_user_role() IN ('coordinator', 'administrator')
)
WITH CHECK (
  public.get_user_role() IN ('coordinator', 'administrator')
);

-- =============================================================================
-- Table 5: reports
-- =============================================================================
DROP POLICY IF EXISTS "reports_select" ON public.reports;
CREATE POLICY "reports_select" ON public.reports
FOR SELECT TO authenticated
USING (
  public.can_view_report(id)
);

-- All five authenticated roles may submit reports (APPROVED PD-R6)
-- R2 Remediation: Restrict initial report values to submitted status and NULL confirmed priority
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
CREATE POLICY "reports_insert" ON public.reports
FOR INSERT TO authenticated
WITH CHECK (
  reporter_id = auth.uid()
  AND status = 'submitted'
  AND confirmed_priority IS NULL
);

-- Coordinators may update non-terminal reports (APPROVED PD-W3)
DROP POLICY IF EXISTS "reports_update_coordinator" ON public.reports;
CREATE POLICY "reports_update_coordinator" ON public.reports
FOR UPDATE TO authenticated
USING (
  public.get_user_role() = 'coordinator'
  AND status NOT IN ('verified', 'cancelled')
)
WITH CHECK (
  public.get_user_role() = 'coordinator'
);

-- Reporters may cancel their own reports in submitted or under_review only (APPROVED PD-W2)
DROP POLICY IF EXISTS "reports_update_reporter_cancel" ON public.reports;
CREATE POLICY "reports_update_reporter_cancel" ON public.reports
FOR UPDATE TO authenticated
USING (
  reporter_id = auth.uid()
  AND status IN ('submitted', 'under_review')
)
WITH CHECK (
  reporter_id = auth.uid()
  AND status = 'cancelled'
);

-- Technicians may transition hold states on assigned reports (APPROVED PD-W1)
DROP POLICY IF EXISTS "reports_update_technician_hold" ON public.reports;
CREATE POLICY "reports_update_technician_hold" ON public.reports
FOR UPDATE TO authenticated
USING (
  public.get_user_role() = 'technician'
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = reports.id
      AND a.technician_id = auth.uid()
      AND a.status IN ('in_progress', 'on_hold')
  )
  AND status IN ('in_progress', 'on_hold')
)
WITH CHECK (
  public.get_user_role() = 'technician'
  AND status IN ('in_progress', 'on_hold')
);

-- =============================================================================
-- Table 6: assignments
-- =============================================================================
DROP POLICY IF EXISTS "assignments_select" ON public.assignments;
CREATE POLICY "assignments_select" ON public.assignments
FOR SELECT TO authenticated
USING (
  (public.get_user_role() = 'technician' AND technician_id = auth.uid())
  OR public.get_user_role() IN ('coordinator', 'administrator', 'management')
);

DROP POLICY IF EXISTS "assignments_insert_coordinator" ON public.assignments;
CREATE POLICY "assignments_insert_coordinator" ON public.assignments
FOR INSERT TO authenticated
WITH CHECK (
  public.get_user_role() = 'coordinator'
  AND assigned_by = auth.uid()
);

DROP POLICY IF EXISTS "assignments_update_coordinator" ON public.assignments;
CREATE POLICY "assignments_update_coordinator" ON public.assignments
FOR UPDATE TO authenticated
USING (
  public.get_user_role() = 'coordinator'
)
WITH CHECK (
  public.get_user_role() = 'coordinator'
);

-- R3 Remediation: Separate technician decline and active work transitions

-- Policy 1: Decline transition strictly from 'assigned' status (APPROVED PD-R2, OD-NEW-3, OD-REC-1)
DROP POLICY IF EXISTS "assignments_update_technician" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update_technician_decline" ON public.assignments;
CREATE POLICY "assignments_update_technician_decline" ON public.assignments
FOR UPDATE TO authenticated
USING (
  public.get_user_role() = 'technician'
  AND technician_id = auth.uid()
  AND status = 'assigned'
)
WITH CHECK (
  public.get_user_role() = 'technician'
  AND technician_id = auth.uid()
  AND status = 'declined'
  AND decline_reason IS NOT NULL
  AND btrim(decline_reason) != ''
  -- Protect coordinator-authored and assignment metadata fields
  AND report_id = (SELECT a.report_id FROM public.assignments a WHERE a.id = assignments.id)
  AND assigned_by = (SELECT a.assigned_by FROM public.assignments a WHERE a.id = assignments.id)
  AND assigned_at = (SELECT a.assigned_at FROM public.assignments a WHERE a.id = assignments.id)
  AND notes IS NOT DISTINCT FROM (SELECT a.notes FROM public.assignments a WHERE a.id = assignments.id)
);

-- Policy 2: Active work transitions (in_progress, on_hold, completed) (APPROVED PD-W1)
DROP POLICY IF EXISTS "assignments_update_technician_work" ON public.assignments;
CREATE POLICY "assignments_update_technician_work" ON public.assignments
FOR UPDATE TO authenticated
USING (
  public.get_user_role() = 'technician'
  AND technician_id = auth.uid()
  AND status IN ('assigned', 'in_progress', 'on_hold')
)
WITH CHECK (
  public.get_user_role() = 'technician'
  AND technician_id = auth.uid()
  AND status IN ('in_progress', 'on_hold', 'completed')
  AND decline_reason IS NULL
  -- Protect coordinator-authored and assignment metadata fields
  AND report_id = (SELECT a.report_id FROM public.assignments a WHERE a.id = assignments.id)
  AND assigned_by = (SELECT a.assigned_by FROM public.assignments a WHERE a.id = assignments.id)
  AND assigned_at = (SELECT a.assigned_at FROM public.assignments a WHERE a.id = assignments.id)
  AND notes IS NOT DISTINCT FROM (SELECT a.notes FROM public.assignments a WHERE a.id = assignments.id)
);

-- =============================================================================
-- Table 7: report_attachments (APPROVED PD-D2, OD-NEW-2)
-- File metadata is immutable. Soft deletion handled via RPC soft_delete_attachment
-- =============================================================================
DROP POLICY IF EXISTS "report_attachments_select" ON public.report_attachments;
CREATE POLICY "report_attachments_select" ON public.report_attachments
FOR SELECT TO authenticated
USING (
  (deleted_at IS NULL AND public.can_view_report(report_id))
  OR (deleted_at IS NOT NULL AND public.get_user_role() IN ('coordinator', 'administrator', 'management'))
);

DROP POLICY IF EXISTS "report_attachments_insert" ON public.report_attachments;
CREATE POLICY "report_attachments_insert" ON public.report_attachments
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND deleted_at IS NULL
  AND deleted_by IS NULL
  AND (
    public.get_user_role() = 'coordinator'
    OR (
      public.get_user_role() = 'student_personnel'
      AND EXISTS (
        SELECT 1 FROM public.reports r
        WHERE r.id = report_attachments.report_id
          AND r.reporter_id = auth.uid()
          AND r.status IN ('submitted', 'under_review')
      )
    )
    OR (
      public.get_user_role() = 'technician'
      AND EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.report_id = report_attachments.report_id
          AND a.technician_id = auth.uid()
          AND a.status IN ('assigned', 'in_progress', 'on_hold')
      )
    )
  )
);

-- Note: UPDATE and DELETE are DENIED for all roles (PD-D2 immutable).
-- Soft deletion is performed exclusively via the SECURITY DEFINER RPC soft_delete_attachment().

-- =============================================================================
-- Table 8: report_status_history
-- Append-only audit trail
-- =============================================================================
DROP POLICY IF EXISTS "report_status_history_select" ON public.report_status_history;
CREATE POLICY "report_status_history_select" ON public.report_status_history
FOR SELECT TO authenticated
USING (
  public.can_view_report(report_id)
);

DROP POLICY IF EXISTS "report_status_history_insert" ON public.report_status_history;
CREATE POLICY "report_status_history_insert" ON public.report_status_history
FOR INSERT TO authenticated
WITH CHECK (
  changed_by = auth.uid()
  AND public.can_view_report(report_id)
);

-- =============================================================================
-- Table 9: report_comments (APPROVED PD-D3, OD-REC-2)
-- Comments are immutable; UPDATE and DELETE DENIED for all roles
-- =============================================================================
DROP POLICY IF EXISTS "report_comments_select" ON public.report_comments;
CREATE POLICY "report_comments_select" ON public.report_comments
FOR SELECT TO authenticated
USING (
  public.can_view_report(report_id)
);

DROP POLICY IF EXISTS "report_comments_insert" ON public.report_comments;
CREATE POLICY "report_comments_insert" ON public.report_comments
FOR INSERT TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND (
    public.get_user_role() = 'coordinator'
    OR (
      public.get_user_role() = 'student_personnel'
      AND EXISTS (
        SELECT 1 FROM public.reports r
        WHERE r.id = report_comments.report_id
          AND r.reporter_id = auth.uid()
      )
    )
    OR (
      public.get_user_role() = 'technician'
      AND EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.report_id = report_comments.report_id
          AND a.technician_id = auth.uid()
          AND a.status != 'declined'
      )
    )
  )
);

-- =============================================================================
-- Table 10: work_logs
-- Append-only session logs
-- =============================================================================
DROP POLICY IF EXISTS "work_logs_select" ON public.work_logs;
CREATE POLICY "work_logs_select" ON public.work_logs
FOR SELECT TO authenticated
USING (
  (public.get_user_role() = 'technician' AND technician_id = auth.uid())
  OR public.get_user_role() IN ('coordinator', 'administrator', 'management')
);

DROP POLICY IF EXISTS "work_logs_insert" ON public.work_logs;
CREATE POLICY "work_logs_insert" ON public.work_logs
FOR INSERT TO authenticated
WITH CHECK (
  public.get_user_role() = 'technician'
  AND technician_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = work_logs.assignment_id
      AND a.technician_id = auth.uid()
      AND a.status IN ('assigned', 'in_progress', 'on_hold')
  )
);

-- =============================================================================
-- Table 11: verifications (APPROVED D2, PD-R4)
-- Coordinator verification with strict self-review and self-verification prohibitions
-- =============================================================================
DROP POLICY IF EXISTS "verifications_select" ON public.verifications;
CREATE POLICY "verifications_select" ON public.verifications
FOR SELECT TO authenticated
USING (
  public.can_view_report(report_id)
);

DROP POLICY IF EXISTS "verifications_insert_coordinator" ON public.verifications;
CREATE POLICY "verifications_insert_coordinator" ON public.verifications
FOR INSERT TO authenticated
WITH CHECK (
  public.get_user_role() = 'coordinator'
  AND verified_by = auth.uid()
  -- Report must be in completed status and coordinator cannot verify own submitted report (APPROVED PD-R4)
  AND EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = verifications.report_id
      AND r.status = 'completed'
      AND r.reporter_id != auth.uid()
  )
  -- Coordinator cannot verify own technician repair work (D2)
  AND NOT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = verifications.report_id
      AND a.technician_id = auth.uid()
      AND a.status IN ('assigned', 'in_progress', 'completed')
  )
);

-- =============================================================================
-- Table 12: notifications
-- =============================================================================
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
FOR SELECT TO authenticated
USING (
  recipient_id = auth.uid()
);

-- R5 Remediation: Restrict notification updates to is_read only
DROP POLICY IF EXISTS "notifications_update_recipient" ON public.notifications;
CREATE POLICY "notifications_update_recipient" ON public.notifications
FOR UPDATE TO authenticated
USING (recipient_id = auth.uid())
WITH CHECK (
  recipient_id = auth.uid()
  AND id = (SELECT n.id FROM public.notifications n WHERE n.id = notifications.id)
  AND type = (SELECT n.type FROM public.notifications n WHERE n.id = notifications.id)
  AND title = (SELECT n.title FROM public.notifications n WHERE n.id = notifications.id)
  AND message = (SELECT n.message FROM public.notifications n WHERE n.id = notifications.id)
  AND report_id IS NOT DISTINCT FROM (SELECT n.report_id FROM public.notifications n WHERE n.id = notifications.id)
  AND created_at = (SELECT n.created_at FROM public.notifications n WHERE n.id = notifications.id)
);

-- R5 Remediation: Column-level UPDATE privilege restriction for defense-in-depth
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
