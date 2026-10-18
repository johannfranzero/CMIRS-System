-- CMIRS Migration 1: Core Schema (Extensions, Enums, Sequences, Tables, Constraints)
-- Phase 4A: Migration SQL Generation (No Execution)
-- Source: docs/database-design/SCHEMA_PROPOSAL.md, DATA_DICTIONARY.md

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Custom Enums (Remediated R6: Idempotent and compatibility-verified)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'student_personnel',
      'coordinator',
      'technician',
      'administrator',
      'management'
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'user_role' AND e.enumlabel = 'student_personnel'
    ) THEN
      RAISE EXCEPTION 'Pre-existing type user_role is incompatible with approved CMIRS schema.';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
    CREATE TYPE report_status AS ENUM (
      'submitted',
      'under_review',
      'assigned',
      'in_progress',
      'on_hold',
      'completed',
      'verified',
      'reopened',
      'cancelled'
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'report_status' AND e.enumlabel = 'submitted'
    ) THEN
      RAISE EXCEPTION 'Pre-existing type report_status is incompatible with approved CMIRS schema.';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_level') THEN
    CREATE TYPE priority_level AS ENUM (
      'low',
      'medium',
      'high',
      'critical'
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'priority_level' AND e.enumlabel = 'critical'
    ) THEN
      RAISE EXCEPTION 'Pre-existing type priority_level is incompatible with approved CMIRS schema.';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_status') THEN
    CREATE TYPE assignment_status AS ENUM (
      'assigned',
      'in_progress',
      'on_hold',
      'completed',
      'reassigned',
      'cancelled',
      'declined'
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'assignment_status' AND e.enumlabel = 'declined'
    ) THEN
      RAISE EXCEPTION 'Pre-existing type assignment_status is incompatible with approved CMIRS schema.';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM (
      'report_submitted',
      'report_assigned',
      'status_changed',
      'priority_changed',
      'comment_added',
      'verification_required',
      'verification_complete',
      'verification_failed',
      'report_reassigned',
      'report_cancelled'
    );
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = 'notification_type' AND e.enumlabel = 'report_submitted'
    ) THEN
      RAISE EXCEPTION 'Pre-existing type notification_type is incompatible with approved CMIRS schema.';
    END IF;
  END IF;
END $$;

-- 3. Sequences
-- Concurrency-safe report number sequence for RPT-000001 format (APPROVED PD-D4)
CREATE SEQUENCE IF NOT EXISTS report_number_seq START WITH 1 INCREMENT BY 1;

-- 4. Tables

-- Table 1: profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'student_personnel',
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 2: role_change_audit (APPROVED OD-NEW-1)
CREATE TABLE IF NOT EXISTS public.role_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  changed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  old_role user_role NOT NULL,
  new_role user_role NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_role_changed CHECK (old_role <> new_role)
);

-- Table 3: categories
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Table 4: locations
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_name TEXT NOT NULL,
  floor TEXT,
  room TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Table 5: reports
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status report_status NOT NULL DEFAULT 'submitted',
  is_urgent_hazard BOOLEAN NOT NULL DEFAULT false,
  confirmed_priority priority_level,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 6: assignments (APPROVED OD-REC-1, OD-NEW-3, PD-R2)
CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status assignment_status NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  decline_reason TEXT,
  CONSTRAINT chk_decline_reason CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))
);

-- Table 7: report_attachments (APPROVED PD-D2, PD-D5, OD-NEW-2)
CREATE TABLE IF NOT EXISTS public.report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT chk_file_size CHECK (file_size > 0 AND file_size <= 10485760),
  CONSTRAINT chk_mime_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
);

-- Table 8: report_status_history
CREATE TABLE IF NOT EXISTS public.report_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  previous_status report_status,
  new_status report_status NOT NULL,
  changed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 9: report_comments (APPROVED PD-D3: immutable, no updated_at)
CREATE TABLE IF NOT EXISTS public.report_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 10: work_logs
CREATE TABLE IF NOT EXISTS public.work_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  hours_spent DECIMAL(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 11: verifications (APPROVED D2, PD-R4)
CREATE TABLE IF NOT EXISTS public.verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  verified_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_satisfactory BOOLEAN NOT NULL,
  notes TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 12: notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
