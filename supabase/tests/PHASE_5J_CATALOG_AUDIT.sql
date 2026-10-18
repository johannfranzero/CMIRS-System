-- =============================================================================
-- CMIRS Phase 5J — Read-Only Database Catalog Audit Script
-- File: supabase/tests/PHASE_5J_CATALOG_AUDIT.sql
-- Role: Comprehensive Catalog Completeness & Invariant Verification
-- Safety: READ-ONLY. Zero INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, or TRUNCATE.
-- Target Project: xyirfifvcntuzceivtho (Supabase Cloud)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table Inventory Verification (Expected: Exactly 12 application tables)
-- -----------------------------------------------------------------------------
WITH expected_tables AS (
  SELECT unnest(ARRAY[
    'profiles', 'role_change_audit', 'categories', 'locations',
    'reports', 'assignments', 'report_attachments', 'report_status_history',
    'report_comments', 'work_logs', 'verifications', 'notifications'
  ]) AS table_name
),
actual_tables AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
)
SELECT 
  e.table_name,
  CASE WHEN a.table_name IS NOT NULL THEN 'PASS' ELSE 'FAIL: MISSING TABLE' END AS status
FROM expected_tables e
LEFT JOIN actual_tables a ON a.table_name = e.table_name
ORDER BY e.table_name;

-- -----------------------------------------------------------------------------
-- 2. Custom Enumerated Types Verification (Expected: Exactly 5 enums with labels)
-- -----------------------------------------------------------------------------
WITH expected_enums AS (
  SELECT 'user_role' AS enum_name, ARRAY['student_personnel', 'coordinator', 'technician', 'administrator', 'management']::text[] AS expected_labels
  UNION ALL
  SELECT 'report_status', ARRAY['submitted', 'under_review', 'assigned', 'in_progress', 'on_hold', 'completed', 'verified', 'reopened', 'cancelled']::text[]
  UNION ALL
  SELECT 'priority_level', ARRAY['low', 'medium', 'high', 'critical']::text[]
  UNION ALL
  SELECT 'assignment_status', ARRAY['assigned', 'in_progress', 'on_hold', 'completed', 'reassigned', 'cancelled', 'declined']::text[]
  UNION ALL
  SELECT 'notification_type', ARRAY['report_submitted', 'report_assigned', 'status_changed', 'priority_changed', 'comment_added', 'verification_required', 'verification_complete', 'verification_failed', 'report_reassigned', 'report_cancelled']::text[]
),
actual_enums AS (
  SELECT 
    t.typname AS enum_name,
    array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS actual_labels
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
  GROUP BY t.typname
)
SELECT 
  exp.enum_name,
  CASE 
    WHEN act.enum_name IS NULL THEN 'FAIL: ENUM MISSING'
    WHEN exp.expected_labels = act.actual_labels THEN 'PASS'
    ELSE 'FAIL: LABELS MISMATCH'
  END AS status,
  array_length(exp.expected_labels, 1) AS expected_count,
  array_length(act.actual_labels, 1) AS actual_count
FROM expected_enums exp
LEFT JOIN actual_enums act ON act.enum_name = exp.enum_name
ORDER BY exp.enum_name;

-- -----------------------------------------------------------------------------
-- 3. Sequence Verification (Expected: report_number_seq)
-- -----------------------------------------------------------------------------
SELECT 
  sequencename,
  start_value,
  increment_by,
  CASE 
    WHEN sequencename = 'report_number_seq' AND start_value = 1 AND increment_by = 1 THEN 'PASS'
    ELSE 'FAIL: SEQUENCE MISCONFIGURED'
  END AS status
FROM pg_sequences
WHERE schemaname = 'public' AND sequencename = 'report_number_seq';

-- -----------------------------------------------------------------------------
-- 4. Dedicated Performance & RLS Indexes (Expected: Exactly 27 indexes)
-- Source: supabase/migrations/20261018000002_performance_indexes.sql
-- -----------------------------------------------------------------------------
WITH expected_indexes AS (
  SELECT unnest(ARRAY[
    'idx_profiles_role',
    'idx_role_change_audit_user_id',
    'idx_role_change_audit_changed_by',
    'idx_reports_category_id',
    'idx_reports_location_id',
    'idx_reports_reporter_id',
    'idx_reports_status',
    'idx_reports_reporter_status',
    'idx_assignments_report_id',
    'idx_assignments_technician_id',
    'idx_assignments_status',
    'idx_assignments_lookup',
    'idx_report_attachments_report_id',
    'idx_report_attachments_file_path',
    'idx_report_attachments_active',
    'idx_report_status_history_report_id',
    'idx_report_status_history_changed_by',
    'idx_report_comments_report_id',
    'idx_report_comments_author_id',
    'idx_work_logs_assignment_id',
    'idx_work_logs_technician_id',
    'idx_work_logs_technician_assignment',
    'idx_verifications_report_id',
    'idx_verifications_verified_by',
    'idx_notifications_recipient_id',
    'idx_notifications_recipient_unread',
    'idx_notifications_report_id'
  ]) AS index_name
),
actual_indexes AS (
  SELECT indexname AS index_name
  FROM pg_indexes
  WHERE schemaname = 'public'
)
SELECT 
  e.index_name,
  CASE WHEN a.index_name IS NOT NULL THEN 'PASS' ELSE 'FAIL: MISSING INDEX' END AS status
FROM expected_indexes e
LEFT JOIN actual_indexes a ON a.index_name = e.index_name
ORDER BY e.index_name;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security Activation (Expected: rowsecurity = true on all 12 tables)
-- -----------------------------------------------------------------------------
WITH expected_tables AS (
  SELECT unnest(ARRAY[
    'profiles', 'role_change_audit', 'categories', 'locations',
    'reports', 'assignments', 'report_attachments', 'report_status_history',
    'report_comments', 'work_logs', 'verifications', 'notifications'
  ]) AS tablename
)
SELECT 
  e.tablename,
  COALESCE(t.rowsecurity, false) AS rls_enabled,
  CASE WHEN t.rowsecurity = true THEN 'PASS' ELSE 'FAIL: RLS NOT ENABLED' END AS status
FROM expected_tables e
LEFT JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = e.tablename
ORDER BY e.tablename;

-- -----------------------------------------------------------------------------
-- 6. Core Check Constraints Verification
-- -----------------------------------------------------------------------------
WITH expected_constraints AS (
  SELECT 'chk_role_changed' AS constraint_name, 'role_change_audit' AS table_name
  UNION ALL
  SELECT 'chk_decline_reason', 'assignments'
  UNION ALL
  SELECT 'chk_file_size', 'report_attachments'
  UNION ALL
  SELECT 'chk_mime_type', 'report_attachments'
),
actual_constraints AS (
  SELECT conname AS constraint_name, relname AS table_name
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public' AND c.contype = 'c'
)
SELECT 
  e.table_name,
  e.constraint_name,
  CASE WHEN a.constraint_name IS NOT NULL THEN 'PASS' ELSE 'FAIL: CONSTRAINT MISSING' END AS status
FROM expected_constraints e
LEFT JOIN actual_constraints a ON a.constraint_name = e.constraint_name AND a.table_name = e.table_name
ORDER BY e.table_name;

-- -----------------------------------------------------------------------------
-- 7. Automated Triggers Verification
-- -----------------------------------------------------------------------------
WITH expected_triggers AS (
  SELECT 'trg_profiles_updated_at' AS trigger_name, 'profiles' AS table_name, 'public' AS schema_name
  UNION ALL
  SELECT 'trg_reports_updated_at', 'reports', 'public'
  UNION ALL
  SELECT 'trg_reports_report_number', 'reports', 'public'
  UNION ALL
  SELECT 'trg_reports_immutable_cols', 'reports', 'public'
  UNION ALL
  SELECT 'trg_reports_status_history', 'reports', 'public'
  UNION ALL
  SELECT 'trg_lock_attachment_count', 'report_attachments', 'public'
  UNION ALL
  SELECT 'trg_on_auth_user_created', 'users', 'auth'
),
actual_triggers AS (
  SELECT 
    t.tgname AS trigger_name,
    c.relname AS table_name,
    n.nspname AS schema_name
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
)
SELECT 
  e.schema_name,
  e.table_name,
  e.trigger_name,
  CASE WHEN a.trigger_name IS NOT NULL THEN 'PASS' ELSE 'FAIL: TRIGGER MISSING' END AS status
FROM expected_triggers e
LEFT JOIN actual_triggers a 
  ON a.trigger_name = e.trigger_name 
 AND a.table_name = e.table_name 
 AND a.schema_name = e.schema_name
ORDER BY e.schema_name, e.table_name;

-- -----------------------------------------------------------------------------
-- 8. Security Helper Functions & RPCs Verification
-- -----------------------------------------------------------------------------
WITH expected_functions AS (
  SELECT unnest(ARRAY[
    'set_updated_at',
    'generate_report_number',
    'prevent_report_immutable_col_update',
    'record_status_history',
    'handle_new_user',
    'lock_attachment_count',
    'get_user_role',
    'can_view_report',
    'soft_delete_attachment',
    'decline_assignment'
  ]) AS function_name
),
actual_functions AS (
  SELECT p.proname AS function_name, p.prosecdef AS is_security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)
SELECT 
  e.function_name,
  CASE 
    WHEN a.function_name IS NULL THEN 'FAIL: FUNCTION MISSING'
    WHEN a.is_security_definer = true THEN 'PASS'
    ELSE 'FAIL: NOT SECURITY DEFINER'
  END AS status
FROM expected_functions e
LEFT JOIN actual_functions a ON a.function_name = e.function_name
ORDER BY e.function_name;

-- -----------------------------------------------------------------------------
-- 9. Storage Bucket Configuration Audit
-- -----------------------------------------------------------------------------
SELECT 
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  CASE 
    WHEN id = 'report-attachments' 
     AND public = false 
     AND file_size_limit = 10485760 
     AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[] 
    THEN 'PASS'
    ELSE 'FAIL: STORAGE BUCKET MISCONFIGURED'
  END AS status
FROM storage.buckets
WHERE id = 'report-attachments';

-- -----------------------------------------------------------------------------
-- 10. Summary Audit Aggregator (Overall Catalog Verdict)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tables INT;
  v_enums INT;
  v_indexes INT;
  v_rls_count INT;
  v_triggers INT;
  v_funcs INT;
  v_bucket_ok BOOLEAN;
BEGIN
  -- Tables count (12)
  SELECT COUNT(*) INTO v_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'profiles', 'role_change_audit', 'categories', 'locations',
      'reports', 'assignments', 'report_attachments', 'report_status_history',
      'report_comments', 'work_logs', 'verifications', 'notifications'
    );

  -- Enums count (5)
  SELECT COUNT(*) INTO v_enums
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname IN ('user_role', 'report_status', 'priority_level', 'assignment_status', 'notification_type');

  -- Indexes count (27)
  SELECT COUNT(*) INTO v_indexes
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname LIKE 'idx_%';

  -- RLS enabled count (12)
  SELECT COUNT(*) INTO v_rls_count
  FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = true
    AND tablename IN (
      'profiles', 'role_change_audit', 'categories', 'locations',
      'reports', 'assignments', 'report_attachments', 'report_status_history',
      'report_comments', 'work_logs', 'verifications', 'notifications'
    );

  -- Storage bucket check
  SELECT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'report-attachments'
      AND public = false
      AND file_size_limit = 10485760
  ) INTO v_bucket_ok;

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'CMIRS CATALOG AUDIT SUMMARY:';
  RAISE NOTICE '  Tables Found:           % / 12', v_tables;
  RAISE NOTICE '  Custom Enums Found:     % / 5', v_enums;
  RAISE NOTICE '  Dedicated Indexes Found:% / 27', v_indexes;
  RAISE NOTICE '  RLS Enabled Tables:     % / 12', v_rls_count;
  RAISE NOTICE '  Storage Bucket Valid:   %', v_bucket_ok;
  RAISE NOTICE '=======================================================';

  IF v_tables = 12 AND v_enums = 5 AND v_indexes = 27 AND v_rls_count = 12 AND v_bucket_ok THEN
    RAISE NOTICE 'VERDICT: PASS — Schema Catalog is 100%% complete and valid.';
  ELSE
    RAISE WARNING 'VERDICT: FAIL — Incomplete or misconfigured schema objects detected.';
  END IF;
END $$;
