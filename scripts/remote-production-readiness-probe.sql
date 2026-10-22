-- =============================================================================
-- CMIRS — Remote Production-Readiness Probe (STRICTLY READ-ONLY)
-- =============================================================================
-- Purpose
--   Produce the live evidence needed for a deployment-readiness assessment
--   without changing a single row, policy, function or role on the remote
--   project.
--
-- Safety contract
--   * Contains ONLY `SELECT` statements.
--   * Creates no table, temp table, function, policy or trigger.
--   * Performs no INSERT / UPDATE / DELETE / TRUNCATE / DROP / ALTER.
--   * Runs inside `BEGIN TRANSACTION READ ONLY; ... ROLLBACK;`, so the database
--     itself refuses any write for the duration of the script.
--
-- Usage
--   npx supabase db query --linked --file scripts/remote-production-readiness-probe.sql
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

-- -----------------------------------------------------------------------------
-- Every finding is a scalar, so the whole probe returns a single result set.
-- -----------------------------------------------------------------------------
SELECT * FROM (
  -- PR-01 : the remote migration ledger -------------------------------------
  SELECT 'PR-01' AS check_id, 'remote migration ledger' AS subject,
         'applied migration count' AS item,
         (SELECT count(*)::text FROM supabase_migrations.schema_migrations) AS value
  UNION ALL
  SELECT 'PR-01', 'remote migration ledger', 'expected migrations present',
         (SELECT count(*)::text FROM supabase_migrations.schema_migrations
           WHERE version IN ('20261018000001','20261018000002','20261018000003','20261018000004',
                             '20261018000005','20261018000006','20261020000007','20261021000008',
                             '20261021000009','20261021000010','20261021000011','20261021000012',
                             '20261021000013','20261021000014'))
  UNION ALL
  SELECT 'PR-01', 'remote migration ledger', 'migration 014 (report submission roles) applied',
         (SELECT count(*)::text FROM supabase_migrations.schema_migrations
           WHERE version = '20261021000014')

  -- PR-02 : the report-insert RLS policy ------------------------------------
  UNION ALL
  SELECT 'PR-02', 'reports_insert policy', 'role restriction present',
         (SELECT (p.qual LIKE '%get_user_role%')::text FROM pg_policies p
           WHERE p.schemaname='public' AND p.tablename='reports' AND p.policyname='reports_insert')
  UNION ALL
  SELECT 'PR-02', 'reports_insert policy', 'reporter roles listed',
         (SELECT (p.qual LIKE '%student_personnel%' AND p.qual LIKE '%coordinator%')::text
           FROM pg_policies p
           WHERE p.schemaname='public' AND p.tablename='reports' AND p.policyname='reports_insert')
  UNION ALL
  SELECT 'PR-02', 'reports_insert policy', 'predicate',
         coalesce((SELECT p.qual FROM pg_policies p
           WHERE p.schemaname='public' AND p.tablename='reports' AND p.policyname='reports_insert'),
           '<policy not found>')

  -- PR-03 : RLS enablement ----------------------------------------------------
  UNION ALL
  SELECT 'PR-03', 'public tables with RLS DISABLED', 'list',
         coalesce((SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
                   '<none>')
  UNION ALL
  SELECT 'PR-03', 'public tables with RLS DISABLED', 'count',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity)
  UNION ALL
  SELECT 'PR-03', 'public tables with RLS enabled', 'count',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity)
  UNION ALL
  SELECT 'PR-03', 'public table inventory', 'all tables',
         coalesce((SELECT string_agg(c.relname || '(rls=' || c.relrowsecurity::text
                                   || ',forced=' || c.relforcerowsecurity::text || ')', '; ' ORDER BY c.relname)
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname='public' AND c.relkind='r'),
                   '<none>')

  -- PR-04 : policies permissive to anon / public ------------------------------
  UNION ALL
  SELECT 'PR-04', 'policies granting access to anon or public', 'list',
         coalesce((SELECT string_agg(tablename || '.' || policyname
                                       || ' [' || array_to_string(roles, ',') || ']', '; ')
                     FROM pg_policies
                     WHERE schemaname='public'
                       AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['public']::name[])),
                   '<none>')
  UNION ALL
  SELECT 'PR-04', 'policies granting access to anon or public', 'count',
         (SELECT count(*)::text FROM pg_policies
           WHERE schemaname='public'
             AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['public']::name[]))

  -- PR-05 : function privileges ------------------------------------------------
  UNION ALL
  SELECT 'PR-05', 'functions executable by anon', 'list',
         coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE')),
                   '<none>')
  UNION ALL
  SELECT 'PR-05', 'functions executable by anon', 'count',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE'))

  -- PR-06 : search_path pinning ------------------------------------------------
  UNION ALL
  SELECT 'PR-06', 'SECURITY DEFINER functions without a pinned search_path', 'list',
         coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND p.prosecdef
                       AND (p.proconfig IS NULL
                            OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg
                                            WHERE cfg LIKE 'search_path=%'))),
                   '<none>')
  UNION ALL
  SELECT 'PR-06', 'SECURITY DEFINER functions without a pinned search_path', 'count',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname='public' AND p.prosecdef
             AND (p.proconfig IS NULL
                  OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg
                                  WHERE cfg LIKE 'search_path=%')))

  -- PR-07 : storage buckets ------------------------------------------------------
  UNION ALL
  SELECT 'PR-07', 'storage buckets', 'inventory',
         coalesce((SELECT string_agg(b.name || ' [public=' || b.public::text
                                      || ', size_limit=' || coalesce(b.file_size_limit::text,'<none>')
                                      || ', mime=' || coalesce(array_to_string(b.allowed_mime_types, ','),'<any>')
                                      || ']', '; ' ORDER BY b.name)
                     FROM storage.buckets b),
                   '<none>')
  UNION ALL
  SELECT 'PR-07', 'storage buckets', 'count', (SELECT count(*)::text FROM storage.buckets)

  -- PR-08 : storage object policies ------------------------------------------------
  UNION ALL
  SELECT 'PR-08', 'storage.objects policies', 'inventory',
         coalesce((SELECT string_agg(policyname || ' [' || array_to_string(roles, ',') || ']'
                                       || ' cmd=' || cmd
                                       || ' using=' || coalesce(qual, '<none>'), '; ' ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='storage' AND tablename='objects'),
                   '<none>')

  -- PR-09 : triggers -------------------------------------------------------------------
  UNION ALL
  SELECT 'PR-09', 'user triggers on public tables', 'inventory',
         coalesce((SELECT string_agg(tgname, '; ' ORDER BY tgname)
                     FROM pg_trigger t
                     JOIN pg_class c ON c.oid = t.tgrelid
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname='public' AND NOT t.tgisinternal),
                   '<none>')
  UNION ALL
  SELECT 'PR-09', 'signup trigger default role', 'handle_new_user definition',
         coalesce((SELECT replace(replace(pg_get_triggerdef(t.oid), chr(10), ' '), '  ', ' ')
                     FROM pg_trigger t
                     JOIN pg_class c ON c.oid = t.tgrelid
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname='public' AND NOT t.tgisinternal AND tgname ILIKE '%new_user%'),
                   '<trigger not found>')

  -- PR-10 : account population ----------------------------------------------------------
  UNION ALL
  SELECT 'PR-10', 'account population', 'auth users', (SELECT count(*)::text FROM auth.users)
  UNION ALL
  SELECT 'PR-10', 'account population', 'profiles', (SELECT count(*)::text FROM public.profiles)
  UNION ALL
  SELECT 'PR-10', 'account population', 'active profiles',
         (SELECT count(*)::text FROM public.profiles WHERE is_active)
  UNION ALL
  SELECT 'PR-10', 'account population', 'roles',
         (SELECT string_agg(x, ' / ' ORDER BY x) FROM (VALUES
            ('student_personnel=' || (SELECT count(*)::text FROM public.profiles WHERE role='student_personnel')),
            ('coordinator='    || (SELECT count(*)::text FROM public.profiles WHERE role='coordinator')),
            ('technician='     || (SELECT count(*)::text FROM public.profiles WHERE role='technician')),
            ('administrator='  || (SELECT count(*)::text FROM public.profiles WHERE role='administrator')),
            ('management='     || (SELECT count(*)::text FROM public.profiles WHERE role='management'))
          ) AS t(x))
  UNION ALL
  SELECT 'PR-10', 'account population', 'non-canonical roles',
         (SELECT count(*)::text FROM public.profiles
           WHERE role NOT IN ('student_personnel','coordinator','technician','administrator','management'))
  UNION ALL
  SELECT 'PR-10', 'account population', 'profiles without a confirmed auth account',
         (SELECT count(*)::text FROM public.profiles p
           WHERE NOT EXISTS (SELECT 1 FROM auth.users u
                              WHERE u.id = p.id AND u.email_confirmed_at IS NOT NULL))

  -- PR-11 : data volume -------------------------------------------------------------------
  UNION ALL
  SELECT 'PR-11', 'data volume', 'reports', (SELECT count(*)::text FROM public.reports)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'assignments', (SELECT count(*)::text FROM public.assignments)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'work_logs', (SELECT count(*)::text FROM public.work_logs)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'verifications', (SELECT count(*)::text FROM public.verifications)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'notifications', (SELECT count(*)::text FROM public.notifications)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'report_attachments', (SELECT count(*)::text FROM public.report_attachments)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'report_status_history', (SELECT count(*)::text FROM public.report_status_history)
  UNION ALL
  SELECT 'PR-11', 'data volume', 'role_change_audit', (SELECT count(*)::text FROM public.role_change_audit)

  -- PR-12 : report status distribution -------------------------------------------------------
  UNION ALL
  SELECT 'PR-12', 'report status distribution', status::text, count(*)::text
  FROM public.reports GROUP BY status

  -- PR-13 : the full policy inventory of the reports table -------------------------------------
  UNION ALL
  SELECT 'PR-13', 'public.reports policies', 'inventory',
         coalesce((SELECT string_agg(policyname || ' [' || array_to_string(roles, ',') || ']'
                                       || ' cmd=' || cmd
                                       || ' using=' || coalesce(qual, '<none>')
                                       || ' check=' || coalesce(with_check, '<none>'), chr(10)
                                     ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='public' AND tablename='reports'),
                   '<none>')

  -- PR-14 : the full storage.objects policy inventory -------------------------------------------
  UNION ALL
  SELECT 'PR-14', 'storage.objects policies', 'inventory',
         coalesce((SELECT string_agg(policyname || ' [' || array_to_string(roles, ',') || ']'
                                       || ' cmd=' || cmd
                                       || ' using=' || coalesce(qual, '<none>')
                                       || ' check=' || coalesce(with_check, '<none>'), chr(10)
                                     ORDER BY policyname)
                     FROM pg_policies WHERE schemaname='storage' AND tablename='objects'),
                   '<none>')

  -- PR-15 : the signup trigger and the role it grants --------------------------------------------
  UNION ALL
  SELECT 'PR-15', 'signup handling', 'handle_new_user definition',
         coalesce((SELECT pg_get_functiondef(p.oid)
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname='public' AND p.proname='handle_new_user'),
                   '<function not found>')
  UNION ALL
  SELECT 'PR-15', 'signup handling', 'auth.users triggers',
         coalesce((SELECT string_agg(t.tgname, '; ' ORDER BY t.tgname)
                     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname='auth' AND NOT t.tgisinternal),
                   '<none>')

  -- PR-16 : privileges on the command-receipt table (the one table without RLS) ---------------------
  UNION ALL
  SELECT 'PR-16', 'notification_command_receipts', 'table privileges',
         coalesce((SELECT string_agg(grantee || ':' || privilege_type, '; ' ORDER BY grantee, privilege_type)
                     FROM information_schema.role_table_grants
                     WHERE table_schema='public' AND table_name='notification_command_receipts'),
                   '<none>')
  UNION ALL
  SELECT 'PR-16', 'notification_command_receipts', 'row count',
         (SELECT count(*)::text FROM public.notification_command_receipts)
) AS probe
ORDER BY check_id, subject, item;

ROLLBACK;
