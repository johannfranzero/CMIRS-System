-- CMIRS Migration 3: Automated Triggers and Concurrency Controls
-- Phase 4A: Migration SQL Generation (No Execution)
-- Source: docs/database-design/SCHEMA_PROPOSAL.md, PHASE_3G_PRE_MIGRATION_GATE.md

-- =============================================================================
-- 1. Trigger T1: Updated-At Timestamp Maintenance
-- Applied to: profiles, reports (NOT report_comments per APPROVED PD-D3)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_reports_updated_at ON public.reports;
CREATE TRIGGER trg_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 2. Trigger T2: Report Number Generation (APPROVED PD-D4, Remediated R4)
-- Formats sequence value as 'RPT-000001' before insert unconditionally
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_report_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Unconditionally assign report number from sequence regardless of client input (Remediated R4)
  NEW.report_number := 'RPT-' || LPAD(nextval('public.report_number_seq')::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_report_number ON public.reports;
CREATE TRIGGER trg_reports_report_number
BEFORE INSERT ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.generate_report_number();

-- Protect report_number and reporter_id from modification on UPDATE (Remediated R4)
CREATE OR REPLACE FUNCTION public.prevent_report_immutable_col_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF OLD.report_number IS DISTINCT FROM NEW.report_number THEN
    RAISE EXCEPTION 'report_number is immutable and cannot be modified.';
  END IF;
  IF OLD.reporter_id IS DISTINCT FROM NEW.reporter_id THEN
    RAISE EXCEPTION 'reporter_id is immutable and cannot be modified.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_immutable_cols ON public.reports;
CREATE TRIGGER trg_reports_immutable_cols
BEFORE UPDATE ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.prevent_report_immutable_col_update();

-- =============================================================================
-- 3. Trigger T3: Report Status History Safety-Net Audit
-- Records status transitions automatically if application layer does not
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_status_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.report_status_history (
      report_id,
      previous_status,
      new_status,
      changed_by,
      reason,
      created_at
    ) VALUES (
      NEW.id,
      OLD.status,
      NEW.status,
      COALESCE(auth.uid(), NEW.reporter_id),
      NULL,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_status_history ON public.reports;
CREATE TRIGGER trg_reports_status_history
AFTER UPDATE OF status ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.record_status_history();

-- =============================================================================
-- 4. Trigger T4: Profile Creation on Supabase Auth Signup (D1)
-- Default role: student_personnel
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email, 'New User'),
    'student_personnel'::user_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- 5. Trigger T5: Concurrency-Safe 5-Active-Attachment Limit (Finding 2)
-- Serializes concurrent uploads per report by locking the parent report row
-- =============================================================================
CREATE OR REPLACE FUNCTION public.lock_attachment_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- Acquire row-level lock on the parent report row to serialize parallel uploads
  PERFORM 1 FROM public.reports WHERE id = NEW.report_id FOR UPDATE;

  SELECT COUNT(*) INTO active_count
  FROM public.report_attachments
  WHERE report_id = NEW.report_id
    AND deleted_at IS NULL;

  IF active_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 active attachments allowed per report.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_attachment_count ON public.report_attachments;
CREATE TRIGGER trg_lock_attachment_count
BEFORE INSERT ON public.report_attachments
FOR EACH ROW
EXECUTE FUNCTION public.lock_attachment_count();
