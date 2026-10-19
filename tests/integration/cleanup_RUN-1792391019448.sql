-- =============================================================================
-- CMIRS Gate E.4C Deterministic Targeted Cleanup Script for RUN-UNIT-TEST
-- Generated at: 2026-10-19T06:23:39.471Z
-- Target Reference: xyirfifvcntuzceivtho
-- Safety: Targets strictly validated UUIDs and canonical paths created by this run
-- =============================================================================
BEGIN;

-- 1. Purge exact storage objects created during run
DELETE FROM storage.objects
WHERE bucket_id = 'report-attachments'
  AND name IN ('reports/b2c91834-58a1-42ec-a0f1-e3db78901234/a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d.png');

-- 2. Purge exact reports (PostgreSQL cascades to all 6 child tables)
DELETE FROM public.reports
WHERE id IN ('b2c91834-58a1-42ec-a0f1-e3db78901234');

COMMIT;