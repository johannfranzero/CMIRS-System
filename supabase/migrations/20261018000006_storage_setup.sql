-- CMIRS Migration 6: Supabase Storage Bucket and storage.objects RLS Policies
-- Phase 4A: Migration SQL Generation (No Execution)
-- Source: docs/database-design/RLS_POLICY_PROPOSAL.md, PHASE_3G_PRE_MIGRATION_GATE.md

-- =============================================================================
-- 1. Create Private Storage Bucket: report-attachments (APPROVED OD-REC-3)
-- Size limit: 10 MB (10,485,760 bytes; APPROVED PD-D5)
-- Permitted MIME types: image/jpeg, image/png, image/webp (APPROVED PD-D5)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-attachments',
  'report-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

-- =============================================================================
-- 2. storage.objects SELECT Policy (Download / Read)
-- Enforces:
-- 1. Private bucket access for authenticated users only
-- 2. Oversight roles (coordinator, admin, management) see all files (including soft-deleted for audit)
-- 3. Student reporters download active attachments on own reports only
-- 4. Technicians download active attachments on qualifying assigned reports only
-- 5. Soft-deleted files are completely hidden from student reporters and technicians
-- =============================================================================
DROP POLICY IF EXISTS "storage_attachments_select" ON storage.objects;
CREATE POLICY "storage_attachments_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'report-attachments'
  AND (
    -- Oversight roles may download active and soft-deleted attachments for audit
    public.get_user_role() IN ('coordinator', 'administrator', 'management')
    OR
    -- Student reporters download active attachments on their own reports
    (
      public.get_user_role() = 'student_personnel'
      AND EXISTS (
        SELECT 1 FROM public.report_attachments ra
        JOIN public.reports r ON r.id = ra.report_id
        WHERE ra.file_path = storage.objects.name
          AND r.reporter_id = auth.uid()
          AND ra.deleted_at IS NULL
      )
    )
    OR
    -- Technicians download active attachments on qualifying assigned reports (APPROVED OD-NEW-4)
    (
      public.get_user_role() = 'technician'
      AND EXISTS (
        SELECT 1 FROM public.report_attachments ra
        WHERE ra.file_path = storage.objects.name
          AND ra.deleted_at IS NULL
          AND public.can_view_report(ra.report_id)
      )
    )
  )
);

-- =============================================================================
-- 3. storage.objects INSERT Policy (Upload)
-- Enforces:
-- 1. Canonical object path format: reports/{report_id}/{attachment_id}.{ext}
-- 2. Regex path validation guard preventing invalid UUID casting exceptions (Finding 1 mitigation)
-- 3. Role-based upload permissions (coordinator non-terminal, reporter submitted/under_review, tech active)
-- 4. Maximum 5 active attachments limit check (APPROVED PD-D5)
-- =============================================================================
DROP POLICY IF EXISTS "storage_attachments_insert" ON storage.objects;
CREATE POLICY "storage_attachments_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'report-attachments'
  -- R1 Remediation: Strict canonical UUID regex validation for both report_id and attachment_id
  AND name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$'
  AND (
    -- Coordinators may upload to any non-terminal report
    (
      public.get_user_role() = 'coordinator'
      AND EXISTS (
        SELECT 1 FROM public.reports r
        WHERE r.id = (
          CASE 
            WHEN name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$'
            THEN (storage.foldername(name))[2]::uuid
            ELSE NULL
          END
        )
        AND r.status NOT IN ('verified', 'cancelled')
      )
    )
    OR
    -- Student reporters may upload to their own submitted or under_review report
    (
      public.get_user_role() = 'student_personnel'
      AND EXISTS (
        SELECT 1 FROM public.reports r
        WHERE r.id = (
          CASE 
            WHEN name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$'
            THEN (storage.foldername(name))[2]::uuid
            ELSE NULL
          END
        )
        AND r.reporter_id = auth.uid()
        AND r.status IN ('submitted', 'under_review')
      )
    )
    OR
    -- Technicians may upload to reports where they currently have an active assignment
    (
      public.get_user_role() = 'technician'
      AND EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.report_id = (
          CASE 
            WHEN name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$'
            THEN (storage.foldername(name))[2]::uuid
            ELSE NULL
          END
        )
        AND a.technician_id = auth.uid()
        AND a.status IN ('assigned', 'in_progress', 'on_hold')
      )
    )
  )
  -- Enforce active attachment count limit (max 5 active per report, APPROVED PD-D5)
  AND (
    SELECT COUNT(*)
    FROM public.report_attachments ra
    WHERE ra.report_id = (
      CASE 
        WHEN name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$'
        THEN (storage.foldername(name))[2]::uuid
        ELSE NULL
      END
    )
    AND ra.deleted_at IS NULL
  ) < 5
);

-- =============================================================================
-- 4. storage.objects UPDATE Policy (Immutability)
-- DENIED for ALL roles. Storage objects cannot be updated, renamed, or replaced in-place.
-- No UPDATE policy is created (PostgreSQL default deny).
-- =============================================================================

-- =============================================================================
-- 5. storage.objects DELETE Policy (Hard Deletion)
-- DENIED for ALL application client roles. Hard deletion directly from clients is prohibited.
-- Physical deletion of soft-deleted binaries is executed exclusively by the trusted
-- background cleanup worker operating under the service_role (which bypasses RLS).
-- No DELETE policy is created for authenticated (PostgreSQL default deny).
-- =============================================================================
