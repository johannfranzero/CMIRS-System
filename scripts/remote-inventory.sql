-- CMIRS: READ-ONLY remote inventory (Phase 1 / master completion prompt)
-- SELECT-only. No DDL, no DML.
SELECT 'applied_migrations' AS section, string_agg(version, ', ' ORDER BY version) AS detail
FROM supabase_migrations.schema_migrations
UNION ALL
SELECT 'tables_rowcounts', string_agg(
    fmt || '=' || n,
    ' | ' ORDER BY fmt)
FROM (
    SELECT 'profiles' AS fmt, count(*)::text AS n FROM public.profiles
    UNION ALL SELECT 'reports', count(*)::text FROM public.reports
    UNION ALL SELECT 'assignments', count(*)::text FROM public.assignments
    UNION ALL SELECT 'categories', count(*)::text FROM public.categories
    UNION ALL SELECT 'locations', count(*)::text FROM public.locations
    UNION ALL SELECT 'notifications', count(*)::text FROM public.notifications
    UNION ALL SELECT 'report_attachments', count(*)::text FROM public.report_attachments
    UNION ALL SELECT 'work_logs', count(*)::text FROM public.work_logs
    UNION ALL SELECT 'verifications', count(*)::text FROM public.verifications
    UNION ALL SELECT 'report_status_history', count(*)::text FROM public.report_status_history
    UNION ALL SELECT 'report_comments', count(*)::text FROM public.report_comments
    UNION ALL SELECT 'profiles_technician', count(*)::text FROM public.profiles WHERE role = 'technician'
    UNION ALL SELECT 'profiles_active', count(*)::text FROM public.profiles WHERE is_active
) s
UNION ALL
SELECT 'auth_users', string_agg(role || ':' || email_status, ' | ')
FROM (
    SELECT coalesce((SELECT p.role::text FROM public.profiles p WHERE p.id = u.id), 'NO_PROFILE') AS role,
           CASE WHEN u.email_confirmed_at IS NULL THEN 'UNCONFIRMED' ELSE 'CONFIRMED' END AS email_status
    FROM auth.users u
) t
UNION ALL
SELECT 'report_statuses', string_agg(status || '=' || n, ' | ' ORDER BY status)
FROM (SELECT status::text, count(*)::text AS n FROM public.reports GROUP BY status) r
UNION ALL
SELECT 'functions', string_agg(p.proname, ' | ' ORDER BY p.proname)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
UNION ALL
SELECT 'buckets', coalesce(string_agg(b.id || '(public=' || b.public || ')', ' | '), 'none')
FROM storage.buckets b
UNION ALL
SELECT 'policies_count', count(*)::text
FROM pg_policies WHERE schemaname = 'public';
