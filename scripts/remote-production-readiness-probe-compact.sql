-- =============================================================================
-- CMIRS — Remote Production-Readiness Probe, Compact Pass (STRICTLY READ-ONLY)
-- =============================================================================
-- Companion to `scripts/remote-production-readiness-probe.sql`. Answers the
-- yes/no questions that the wide detail pass makes hard to read, with short
-- scalar values only.
--
-- Safety contract: SELECT only, inside a READ ONLY transaction, rolled back.
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT * FROM (
  -- PC-01 : the role the signup trigger grants ---------------------------------
  SELECT 'PC-01' AS check_id, 'handle_new_user' AS subject,
         'grants student_personnel' AS item,
         (SELECT (pg_get_functiondef(p.oid) LIKE '%student_personnel%')::text
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='handle_new_user') AS value
  UNION ALL
  SELECT 'PC-01', 'handle_new_user', 'role literal found in the body',
         coalesce((SELECT substring(pg_get_functiondef(p.oid)
                                   from position('student_personnel' in pg_get_functiondef(p.oid)) - 60
                                   for 140)
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND p.proname='handle_new_user'),
                   '<not found>')

  -- PC-02 : the storage policy set ------------------------------------------------
  UNION ALL
  SELECT 'PC-02', 'storage.objects', 'policy names and commands',
         coalesce((SELECT string_agg(policyname || '=' || cmd, ' | ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='storage' AND tablename='objects'),
                   '<none>')

  -- PC-03 : the server-side role check in the submission command --------------------
  UNION ALL
  SELECT 'PC-03', 'submit_report_with_notifications', 'checks the reporter roles',
         coalesce((SELECT (pg_get_functiondef(p.oid)
                           LIKE '%student_personnel%' AND pg_get_functiondef(p.oid)
                           LIKE '%coordinator%')::text
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND p.proname='submit_report_with_notifications'),
                   '<function not found>')
  UNION ALL
  SELECT 'PC-03', 'submit_report_with_notifications', 'role-check excerpt',
         coalesce((SELECT substring(pg_get_functiondef(p.oid)
                                   from greatest(1, position('student_personnel' in pg_get_functiondef(p.oid)) - 260)
                                   for 420)
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND p.proname='submit_report_with_notifications'),
                   '<not found>')

  -- PC-04 : grants to anon / authenticated on public tables ---------------------------
  UNION ALL
  SELECT 'PC-04', 'anon grants on public tables', 'grants',
         coalesce((SELECT string_agg(table_name || ':' || privilege_type, ' | ' ORDER BY table_name)
                     FROM information_schema.role_table_grants
                     WHERE table_schema='public' AND grantee='anon'),
                   '<none>')
  UNION ALL
  SELECT 'PC-04', 'authenticated grants on public tables', 'grants',
         coalesce((SELECT string_agg(table_name || ':' || privilege_type, ' | ' ORDER BY table_name)
                     FROM information_schema.role_table_grants
                     WHERE table_schema='public' AND grantee='authenticated'),
                   '<none>')

  -- PC-05 : the report-status enum and the report status of every live report ------------
  UNION ALL
  SELECT 'PC-05', 'report_status enum values', 'values',
         coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                     FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                     JOIN pg_namespace n ON n.oid = t.typnamespace
                     WHERE n.nspname='public' AND t.typname='report_status'),
                   '<none>')
  UNION ALL
  SELECT 'PC-05', 'live report inventory', 'counts by status and priority',
         coalesce((SELECT string_agg(report_number || ' status=' || status::text
                                       || ' priority=' || coalesce(confirmed_priority::text, 'null')
                                       || ' reporter_is_test_student='
                                       || (reporter_id = (SELECT id FROM public.profiles
                                                           WHERE role='student_personnel' LIMIT 1))::text,
                                     ' | ' ORDER BY report_number)
                     FROM public.reports),
                   '<none>')
) AS probe
ORDER BY check_id, subject, item;

ROLLBACK;
