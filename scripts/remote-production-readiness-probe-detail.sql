-- =============================================================================
-- CMIRS — Remote Production-Readiness Probe, Detail Pass (STRICTLY READ-ONLY)
-- =============================================================================
-- Companion to `scripts/remote-production-readiness-probe.sql`. Focuses on the
-- three findings that need the full definition to be judged:
--   PD-01  the signup trigger's default role
--   PD-02  the complete storage.objects policy set (read / write / delete)
--   PD-03  the server-side role check inside the report-submission command
--   PD-04  the exact privileges on every public table
--
-- Safety contract: SELECT only, inside a READ ONLY transaction, rolled back.
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT * FROM (
  -- PD-01 : the signup trigger -------------------------------------------------
  SELECT 'PD-01' AS check_id, 'handle_new_user function' AS subject,
         'definition' AS item,
         (SELECT pg_get_functiondef(p.oid)
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='handle_new_user') AS value
  UNION ALL
  SELECT 'PD-02', 'storage.objects policy names', 'policies',
         coalesce((SELECT string_agg(policyname || ' cmd=' || cmd
                                       || ' roles=' || array_to_string(roles, ','), ' | ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='storage' AND tablename='objects'),
                   '<none>')
  UNION ALL
  SELECT 'PD-02', 'storage.objects write-path check', 'storage_attachments_insert check',
         coalesce((SELECT with_check FROM pg_policies
                     WHERE schemaname='storage' AND tablename='objects'
                       AND policyname='storage_attachments_insert'),
                   '<none>')
  UNION ALL
  SELECT 'PD-03', 'submit_report_with_notifications', 'definition',
         coalesce((SELECT pg_get_functiondef(p.oid)
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND p.proname='submit_report_with_notifications'),
                   '<function not found>')
  UNION ALL
  SELECT 'PD-04', 'public table privileges', 'grants to anon or authenticated',
         coalesce((SELECT string_agg(table_name || ' -> ' || grantee || ':' || privilege_type, '; '
                                       ORDER BY table_name, grantee, privilege_type)
                     FROM information_schema.role_table_grants
                     WHERE table_schema='public'
                       AND grantee IN ('anon','authenticated')
                       AND table_name NOT IN ('assignments','categories','locations','notifications',
                                              'profiles','report_attachments','report_comments',
                                              'report_status_history','reports','role_change_audit',
                                              'verifications','work_logs')),
                   '<none>')
  UNION ALL
  SELECT 'PD-04', 'anon table grants (all public tables)', 'grants',
         coalesce((SELECT string_agg(table_name || ':' || privilege_type, '; ' ORDER BY table_name)
                     FROM information_schema.role_table_grants
                     WHERE table_schema='public' AND grantee='anon'),
                   '<none>')
  UNION ALL
  SELECT 'PD-05', 'column-level grants on public.reports', 'grants to anon or authenticated',
         coalesce((SELECT string_agg(table_name || '.' || column_name || ' -> ' || grantee
                                       || ':' || privilege_type, '; '
                                       ORDER BY column_name, grantee)
                     FROM information_schema.column_privileges
                     WHERE table_schema='public' AND table_name='reports'
                       AND grantee IN ('anon','authenticated')),
                   '<none>')
) AS probe
ORDER BY check_id, subject, item;

ROLLBACK;
