-- =============================================================================
-- CMIRS Phase 5A — Local Database Verification Test Harness
-- File: supabase/tests/database_test_suite.sql
-- Role: Automated Integration Test Runner (Transaction-Rollback Scaffolding)
-- Note: Executable on local PostgreSQL / Supabase CLI instances.
-- Safety: Enclosed in BEGIN ... ROLLBACK to guarantee ZERO persistent state changes.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_table_count INTEGER;
  v_enum_count INTEGER;
  v_seq_count INTEGER;
  v_test_student_id UUID := gen_random_uuid();
  v_test_coord_id UUID := gen_random_uuid();
  v_test_tech_id UUID := gen_random_uuid();
  v_test_cat_id UUID;
  v_test_loc_id UUID;
  v_report_id UUID;
  v_report_number TEXT;
  v_assignment_id UUID;
  v_att_count INTEGER;
BEGIN
  RAISE NOTICE '===================================================================';
  RAISE NOTICE 'STARTING CMIRS DATABASE INTEGRATION TEST SUITE (ROLLBACK MODE)';
  RAISE NOTICE '===================================================================';

  -- ---------------------------------------------------------------------------
  -- TEST 1: Schema Catalog Verification
  -- ---------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'profiles', 'role_change_audit', 'categories', 'locations',
      'reports', 'assignments', 'report_attachments', 'report_status_history',
      'report_comments', 'work_logs', 'verifications', 'notifications'
    );

  IF v_table_count != 12 THEN
    RAISE EXCEPTION 'TEST-MIG-01 FAILED: Expected 12 tables, found %', v_table_count;
  END IF;
  RAISE NOTICE '[PASS] TEST-MIG-01: All 12 core tables exist in schema public.';

  SELECT COUNT(*) INTO v_enum_count
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
    AND t.typname IN ('user_role', 'report_status', 'priority_level', 'assignment_status', 'notification_type');

  IF v_enum_count != 5 THEN
    RAISE EXCEPTION 'TEST-MIG-02 FAILED: Expected 5 custom enums, found %', v_enum_count;
  END IF;
  RAISE NOTICE '[PASS] TEST-MIG-02: All 5 custom enums exist.';

  -- ---------------------------------------------------------------------------
  -- TEST FIXTURES: Set up baseline categories and locations
  -- ---------------------------------------------------------------------------
  INSERT INTO public.categories (name, description)
  VALUES ('Plumbing Test', 'Plumbing category test')
  RETURNING id INTO v_test_cat_id;

  INSERT INTO public.locations (building_name, floor, room)
  VALUES ('Science Hall', '2', '204')
  RETURNING id INTO v_test_loc_id;

  -- Create test profiles
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (v_test_student_id, 'student.test@university.edu', 'Test Student', 'student_personnel');

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (v_test_coord_id, 'coordinator.test@university.edu', 'Test Coordinator', 'coordinator');

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (v_test_tech_id, 'tech.test@university.edu', 'Test Technician', 'technician');

  RAISE NOTICE '[PASS] TEST-AUTH: Test profile fixtures initialized.';

  -- ---------------------------------------------------------------------------
  -- TEST 2: Trigger T2 Report Numbering and Immutability
  -- ---------------------------------------------------------------------------
  -- Insert report with custom number, trigger T2 should overwrite from sequence
  INSERT INTO public.reports (
    report_number, title, description, category_id, location_id, reporter_id, status
  ) VALUES (
    'RPT-CUSTOM999', 'Leaking pipe', 'Severe leak under sink', v_test_cat_id, v_test_loc_id, v_test_student_id, 'submitted'
  ) RETURNING id, report_number INTO v_report_id, v_report_number;

  IF v_report_number = 'RPT-CUSTOM999' OR v_report_number NOT LIKE 'RPT-%' THEN
    RAISE EXCEPTION 'TEST-RPT-03 FAILED: Report number was not assigned from sequence: %', v_report_number;
  END IF;
  RAISE NOTICE '[PASS] TEST-RPT-03: Trigger T2 unconditionally assigned sequence number: %', v_report_number;

  -- Test immutability of report_number on UPDATE
  BEGIN
    UPDATE public.reports
    SET report_number = 'RPT-ALTERED'
    WHERE id = v_report_id;
    RAISE EXCEPTION 'TEST-RPT-04 FAILED: Mutation of report_number was unexpectedly permitted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%report_number is immutable%' THEN
      RAISE NOTICE '[PASS] TEST-RPT-04: Trigger trg_reports_immutable_cols prevented report_number update.';
    ELSE
      RAISE EXCEPTION 'TEST-RPT-04 FAILED with unexpected error: %', SQLERRM;
    END IF;
  END;

  -- ---------------------------------------------------------------------------
  -- TEST 3: Assignments & Decline Reason Constraint (chk_decline_reason)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.assignments (
    report_id, technician_id, assigned_by, status
  ) VALUES (
    v_report_id, v_test_tech_id, v_test_coord_id, 'assigned'
  ) RETURNING id INTO v_assignment_id;

  -- Attempt to decline without reason (must fail)
  BEGIN
    UPDATE public.assignments
    SET status = 'declined', decline_reason = '   '
    WHERE id = v_assignment_id;
    RAISE EXCEPTION 'TEST-ASG-05 FAILED: Empty whitespace decline reason was unexpectedly permitted.';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '[PASS] TEST-ASG-05: Check constraint chk_decline_reason blocked whitespace decline.';
  END;

  -- Decline with valid reason (must succeed)
  UPDATE public.assignments
  SET status = 'declined', decline_reason = 'Specialized electrical certification required'
  WHERE id = v_assignment_id;
  RAISE NOTICE '[PASS] TEST-ASG-03: Valid decline reason succeeded.';

  -- ---------------------------------------------------------------------------
  -- TEST 4: Attachment Row-Locking Concurrency Guard (Trigger T5)
  -- ---------------------------------------------------------------------------
  -- Re-activate assignment for attachment tests
  UPDATE public.assignments
  SET status = 'in_progress', decline_reason = NULL
  WHERE id = v_assignment_id;

  -- Insert 5 attachments (allowed limit)
  FOR i IN 1..5 LOOP
    INSERT INTO public.report_attachments (
      report_id, file_path, file_name, file_size, mime_type, uploaded_by
    ) VALUES (
      v_report_id,
      'reports/' || v_report_id::text || '/' || gen_random_uuid()::text || '.png',
      'photo_' || i || '.png',
      1024 * 500,
      'image/png',
      v_test_student_id
    );
  END LOOP;
  RAISE NOTICE '[PASS] TEST-ATT-05: Exactly 5 active attachments inserted successfully.';

  -- Attempt to insert 6th active attachment (must fail)
  BEGIN
    INSERT INTO public.report_attachments (
      report_id, file_path, file_name, file_size, mime_type, uploaded_by
    ) VALUES (
      v_report_id,
      'reports/' || v_report_id::text || '/' || gen_random_uuid()::text || '.png',
      'photo_6_overflow.png',
      1024 * 500,
      'image/png',
      v_test_student_id
    );
    RAISE EXCEPTION 'TEST-ATT-06 FAILED: Sixth active attachment was unexpectedly permitted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Maximum 5 active attachments allowed%' THEN
      RAISE NOTICE '[PASS] TEST-ATT-06: Trigger T5 lock_attachment_count blocked 6th attachment.';
    ELSE
      RAISE EXCEPTION 'TEST-ATT-06 FAILED with unexpected error: %', SQLERRM;
    END IF;
  END;

  -- Soft delete one attachment, then 5th active slot opens
  UPDATE public.report_attachments
  SET deleted_at = now(), deleted_by = v_test_coord_id
  WHERE id = (SELECT id FROM public.report_attachments WHERE report_id = v_report_id LIMIT 1);

  -- Now inserting a new attachment must succeed
  INSERT INTO public.report_attachments (
    report_id, file_path, file_name, file_size, mime_type, uploaded_by
  ) VALUES (
    v_report_id,
    'reports/' || v_report_id::text || '/' || gen_random_uuid()::text || '.png',
    'photo_replacement.png',
    1024 * 500,
    'image/png',
    v_test_student_id
  );
  RAISE NOTICE '[PASS] TEST-ATT-08: Soft-deleted attachment did not count against active limit.';

  -- ---------------------------------------------------------------------------
  -- TEST 5: Status History Automatic Trigger T3
  -- ---------------------------------------------------------------------------
  UPDATE public.reports
  SET status = 'under_review'
  WHERE id = v_report_id;

  SELECT COUNT(*) INTO v_att_count
  FROM public.report_status_history
  WHERE report_id = v_report_id AND new_status = 'under_review';

  IF v_att_count < 1 THEN
    RAISE EXCEPTION 'TEST-AUD-06 FAILED: Trigger T3 did not insert status history audit row.';
  END IF;
  RAISE NOTICE '[PASS] TEST-AUD-06: Trigger T3 automatically generated status history audit row.';

  RAISE NOTICE '===================================================================';
  RAISE NOTICE 'ALL LOCAL VERIFICATION ASSERTIONS PASSED SUCCESSFULLY.';
  RAISE NOTICE '===================================================================';
END $$;

-- Guarantee ZERO persistent state changes:
ROLLBACK;
