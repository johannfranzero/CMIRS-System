-- =============================================================================
-- CMIRS — Schema Facts Probe (STRICTLY READ-ONLY)
-- =============================================================================
-- Establishes the structural facts the role-matrix harness depends on:
-- foreign keys on public.profiles / public.report_attachments, the check
-- constraints of the lifecycle commands, and the eligible-technician rule.
--
-- Nothing is written; the transaction is rolled back.
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

SELECT 'FK' AS kind,
       con.conname AS name,
       con.conrelid::regclass::text AS table_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.contype = 'f'
  AND con.connamespace = 'public'::regnamespace
  AND con.conrelid::regclass::text IN ('public.profiles','public.report_attachments','public.assignments','public.work_logs','public.verifications','public.notifications')
ORDER BY con.conrelid::regclass::text, con.conname;

SELECT 'COLUMNS' AS kind,
       table_name,
       column_name,
       data_type,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profiles','report_attachments','assignments','work_logs','verifications')
ORDER BY table_name, ordinal_position;

SELECT 'ENUM' AS kind,
       t.typname AS name,
       string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname = 'public'
GROUP BY t.typname
ORDER BY t.typname;

SELECT 'FN' AS kind,
       p.proname AS name,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS result
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

ROLLBACK;
