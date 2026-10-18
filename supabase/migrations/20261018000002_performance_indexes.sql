-- CMIRS Migration 2: Performance and RLS Join Indexes
-- Phase 4A: Migration SQL Generation (No Execution)
-- Source: docs/database-design/SCHEMA_PROPOSAL.md, RLS_POLICY_PROPOSAL.md

-- 1. Profiles Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

-- 2. Role Change Audit Indexes
CREATE INDEX IF NOT EXISTS idx_role_change_audit_user_id ON public.role_change_audit (user_id);
CREATE INDEX IF NOT EXISTS idx_role_change_audit_changed_by ON public.role_change_audit (changed_by);

-- 3. Reports Foreign Key & Filter Indexes
CREATE INDEX IF NOT EXISTS idx_reports_category_id ON public.reports (category_id);
CREATE INDEX IF NOT EXISTS idx_reports_location_id ON public.reports (location_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_id ON public.reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_status ON public.reports (reporter_id, status);

-- 4. Assignments Foreign Key & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_assignments_report_id ON public.assignments (report_id);
CREATE INDEX IF NOT EXISTS idx_assignments_technician_id ON public.assignments (technician_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.assignments (status);
-- Critical compound index supporting can_view_report() technician assignment lookup
CREATE INDEX IF NOT EXISTS idx_assignments_lookup ON public.assignments (report_id, technician_id, status);

-- 5. Report Attachments Indexes
CREATE INDEX IF NOT EXISTS idx_report_attachments_report_id ON public.report_attachments (report_id);
-- Critical index supporting storage.objects SELECT policy join on file_path
CREATE INDEX IF NOT EXISTS idx_report_attachments_file_path ON public.report_attachments (file_path);
-- Compound index supporting active attachment count queries (deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_report_attachments_active ON public.report_attachments (report_id, deleted_at);

-- 6. Report Status History Indexes
CREATE INDEX IF NOT EXISTS idx_report_status_history_report_id ON public.report_status_history (report_id);
CREATE INDEX IF NOT EXISTS idx_report_status_history_changed_by ON public.report_status_history (changed_by);

-- 7. Report Comments Indexes
CREATE INDEX IF NOT EXISTS idx_report_comments_report_id ON public.report_comments (report_id);
CREATE INDEX IF NOT EXISTS idx_report_comments_author_id ON public.report_comments (author_id);

-- 8. Work Logs Indexes
CREATE INDEX IF NOT EXISTS idx_work_logs_assignment_id ON public.work_logs (assignment_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_technician_id ON public.work_logs (technician_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_technician_assignment ON public.work_logs (technician_id, assignment_id);

-- 9. Verifications Indexes
CREATE INDEX IF NOT EXISTS idx_verifications_report_id ON public.verifications (report_id);
CREATE INDEX IF NOT EXISTS idx_verifications_verified_by ON public.verifications (verified_by);

-- 10. Notifications Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id ON public.notifications (recipient_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON public.notifications (recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_report_id ON public.notifications (report_id);
