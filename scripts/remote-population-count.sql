-- CMIRS — Population count (read-only)
BEGIN TRANSACTION READ ONLY;
SELECT 'auth_users' AS object, count(*)::text AS n FROM auth.users
UNION ALL SELECT 'profiles', count(*)::text FROM public.profiles
UNION ALL SELECT 'reports', count(*)::text FROM public.reports
UNION ALL SELECT 'assignments', count(*)::text FROM public.assignments
UNION ALL SELECT 'notifications', count(*)::text FROM public.notifications
UNION ALL SELECT 'work_logs', count(*)::text FROM public.work_logs
UNION ALL SELECT 'verifications', count(*)::text FROM public.verifications
UNION ALL SELECT 'report_attachments', count(*)::text FROM public.report_attachments
UNION ALL SELECT 'role_change_audit', count(*)::text FROM public.role_change_audit;
ROLLBACK;
