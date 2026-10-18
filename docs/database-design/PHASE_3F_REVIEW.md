# CMIRS Phase 3F — Documentation Review

> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 3F — Owner Decisions and Documentation Reconciliation  
> **Scope:** Documentation-Only Reconciliation of Phase 3E Audit Recommendations  
> **Status:** COMPLETE — READY FOR MIGRATION PREPARATION  

---

## 1. Summary

In Phase 3E, a comprehensive consistency audit across all database design documentation identified three critical areas for improvement:
1. The database check constraint for `assignments.decline_reason` only enforced `IS NOT NULL`, allowing empty or whitespace strings without application intervention.
2. An asymmetry in `report_comments` permissions denied `SELECT` to `administrator` and `management`, despite these oversight roles possessing global read access to all other report records.
3. While PostgreSQL metadata RLS for `report_attachments` was defined, the underlying Supabase Storage bucket and `storage.objects` RLS policies were not yet documented.

In Phase 3F, the project owner explicitly approved all three recommendations:
- **OD-REC-1 (APPROVED):** Strengthen the `assignments.decline_reason` check constraint using `btrim()` directly in the database.
- **OD-REC-2 (APPROVED):** Grant `SELECT` on `report_comments` to `administrator` and `management` under existing report oversight boundaries.
- **OD-REC-3 (APPROVED FOR DOCUMENTATION ONLY):** Formally draft and document the Supabase Storage bucket configuration and `storage.objects` RLS policy design.

All documentation in `docs/database-design/` has been updated and reconciled. No SQL or migration files were created, no SQL was executed, no application code was touched, and no connection or modification to Supabase was made.

---

## 2. Phase 3F Owner-Approved Decisions

### OD-REC-1 — Strengthen `assignments.decline_reason` Constraint
- **Owner Decision:** APPROVED (2026-10-18).
- **Approved Constraint:**
  ```sql
  CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))
  ```
- **Technical Effect:** Enforces at the database engine level that whenever an assignment transition sets `status = 'declined'`, the `decline_reason` cannot be `NULL`, cannot be an empty string (`''`), and cannot consist solely of whitespace characters (`'   '`).
- **Documents Updated:** `OPEN_DECISIONS.md`, `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`.

### OD-REC-2 — Administrator and Management Comment Read Access
- **Owner Decision:** APPROVED (2026-10-18).
- **Policy Effect:** `report_comments` `SELECT` operation is updated to `ALLOW` for `administrator` and `management`.
- **Technical Rationale:** Aligns comment visibility with the general oversight permissions already granted to administrator and management on `reports`, `report_attachments`, `report_status_history`, `assignments`, `work_logs`, and `verifications`. Evaluated consistently through `can_view_report(report_id)`.
- **Documents Updated:** `OPEN_DECISIONS.md`, `SCHEMA_PROPOSAL.md`, `RLS_POLICY_PROPOSAL.md`.

### OD-REC-3 — Supabase Storage Bucket and `storage.objects` RLS Policy Design
- **Owner Decision:** APPROVED FOR DOCUMENTATION ONLY (2026-10-18).
- **Specification Overview:**
  - Private bucket `report-attachments` with public access disabled.
  - Maximum file size: 10 MB (10,485,760 bytes).
  - Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`.
  - Canonical path hierarchy: `reports/{report_id}/{attachment_id}.{ext}`.
  - RLS policies on `storage.objects` for SELECT, INSERT, UPDATE, and DELETE.
- **Documents Updated:** `OPEN_DECISIONS.md`, `SCHEMA_PROPOSAL.md`, `RLS_POLICY_PROPOSAL.md`.

---

## 3. Previously Approved Decisions (Remain in Full Force)

All 16 previously approved decisions from Phases 3B, 3C, and 3D remain active, untouched, and fully incorporated:

| Decision ID | Summary | Approval Date |
|---|---|---|
| **OD-NEW-1** | `role_change_audit` table included in schema | 2026-10-18 (Phase 3B) |
| **OD-NEW-2** | Soft deletion of `report_attachments` via `deleted_at` and `deleted_by` | 2026-10-18 (Phase 3D) |
| **OD-NEW-3** | `decline_reason` TEXT on `assignments`; required on decline | 2026-10-18 (Phase 3D) |
| **OD-NEW-4** | Technician report visibility predicate excludes `declined` assignments | 2026-10-18 (Phase 3D) |
| **PD-D2** | Attachment file metadata immutable after upload; coordinator-controlled soft deletion | 2026-10-18 (Phase 3C) |
| **PD-D3** | `report_comments` immutable after creation (`updated_at` removed; UPDATE/DELETE DENY) | 2026-10-18 (Phase 3C) |
| **PD-D4** | Report number format `RPT-000001` via PostgreSQL SEQUENCE; concurrency-safe | 2026-10-18 (Phase 3B) |
| **PD-D5** | Photo uploads: max 5 attachments per report; max 10 MB; JPEG, PNG, WebP | 2026-10-18 (Phase 3B) |
| **PD-R1** | Technicians access only assigned reports (scoped by qualifying assignment) | 2026-10-18 (Phase 3C) |
| **PD-R2** | Technicians may decline assignments before starting; decline is terminal | 2026-10-18 (Phase 3C) |
| **PD-R4** | Coordinator self-verification prohibited (`verified_by != reports.reporter_id`) | 2026-10-18 (Phase 3B) |
| **PD-R6** | All five authenticated roles may submit reports | 2026-10-18 (Phase 3C) |
| **PD-W1** | Work hold initiation permitted by technician or coordinator; reason required | 2026-10-18 (Phase 3B) |
| **PD-W2** | Reporter cancellation authority permitted at `submitted` or `under_review` stages only | 2026-10-18 (Phase 3B) |
| **PD-W3** | Coordinator cancellation authority permitted at any non-terminal stage | 2026-10-18 (Phase 3B) |
| **PD-W4** | On report cancellation, all active assignments marked `cancelled` atomically | 2026-10-18 (Phase 3B) |

---

## 4. Files Changed in Phase 3F

### 1. `docs/database-design/OPEN_DECISIONS.md`
- **Consolidated Decision Register:** Updated `OD-REC-1`, `OD-REC-2`, and `OD-REC-3` status to `**OWNER APPROVED**`. Updated migration status summary.
- **Section OD-NEW-3:** Updated check constraint definition to include `btrim()` and note OD-REC-1 approval.
- **Section Phase 3F Owner-Approved Decisions:** Formally documented approved details for `OD-REC-1`, `OD-REC-2`, and `OD-REC-3`.

### 2. `docs/database-design/SCHEMA_PROPOSAL.md`
- **Decisions Applied Table:** Added rows for `OD-REC-1`, `OD-REC-2`, and `OD-REC-3` under updated heading `Phase 3B, 3C, 3D, and 3F Decisions Applied`.
- **`assignments` Table Definition:** Updated constraint on `decline_reason` column to `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))` and updated description to reflect database-level enforcement of non-empty and non-whitespace strings.
- **Decline Process Steps:** Updated steps 3 and 4 to reflect database-level `btrim` enforcement.
- **Deviations from DATABASE.md:** Updated item 14 with `btrim()`; added items 15 (`report_comments` SELECT for admin/management) and 16 (Supabase Storage bucket RLS design).
- **Open Items:** Removed OD-REC-1 from open questions; updated footer metadata to Phase 3F.

### 3. `docs/database-design/DATA_DICTIONARY.md`
- **`assignments.decline_reason`:** Updated Constraints column to `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))`.
- **Description:** Updated to state that the database constraint rejects `NULL`, empty string, or whitespace-only reasons directly via `btrim()`.

### 4. `docs/database-design/RLS_POLICY_PROPOSAL.md`
- **Status & Table of Contents:** Updated status header and added `[Phase 3F Changes to Policies]` and `[Supabase Storage Policy Design]` to TOC.
- **Phase 3F Changes Section:** Documented `assignments` constraint hardening, `report_comments` SELECT permission update, and Supabase Storage design.
- **`report_comments` Permission Matrix:** Updated SELECT operation to `ALLOW` for `administrator` and `management`. Updated table notes to document OD-REC-2 approval.
- **Supabase Storage Policy Design Section:** Added full, dedicated section specifying private bucket `report-attachments`, object path naming convention, and RLS policies for `storage.objects` (SELECT, INSERT, UPDATE, DELETE).
- **Unresolved RLS Questions:** Removed comment visibility and storage bucket RLS from unresolved questions; updated resolved list to include Phase 3F approvals; updated footer metadata.

---

## 5. Summary of Supabase Storage Policy Design (OD-REC-3)

The documented storage design secures physical files in `storage.objects` in lockstep with database metadata RLS:

```
Bucket: report-attachments (Private, max 10MB, JPEG/PNG/WebP)
Path: reports/{report_id}/{attachment_id}.{ext}
```

### Storage Access Matrix

| Role | Download (SELECT) | Upload (INSERT) | Replace (UPDATE) | Hard Delete (DELETE) |
|---|---|---|---|---|
| **student_personnel** | Active attachments on own reports | Own reports at submitted/under_review (<= 5 active) | DENY | DENY |
| **coordinator** | All attachments (active + soft-deleted) | Any non-terminal report (<= 5 active) | DENY | DENY |
| **technician** | Active attachments on qualifying assigned reports | Assigned reports with active assignment (<= 5 active) | DENY | DENY |
| **administrator** | All attachments (audit oversight) | DENY | DENY | DENY |
| **management** | All attachments (audit oversight) | DENY | DENY | DENY |
| **service_role** | ALLOW | ALLOW | DENY | ALLOW (Background cleanup only) |

### Key Storage Guarantees
1. **Unauthenticated Access Blocked:** Private bucket prevents direct anonymous downloads.
2. **Soft-Deleted Files Protected:** Student personnel and technicians cannot download soft-deleted attachments (`ra.deleted_at IS NULL` required in SELECT policy).
3. **No Overwriting:** File metadata and storage objects are immutable (UPDATE DENY all; PD-D2).
4. **Client-Side Delete Denied:** Only the background worker running as `service_role` can physically delete objects from storage following coordinator soft deletion.

---

## 6. Remaining Open Decisions (Preserved in Full)

None of the remaining open or recommended items block core database schema or RLS migration preparation:

| ID | Title | Status | Category | Impact on Migration Preparation |
|---|---|---|---|---|
| **PD-D1** | Location Table Structure | RECOMMENDED | Schema | Single `locations` table approved; hierarchical expansion deferred. Does not block migration. |
| **PD-D6** | Notification Creation Method | RECOMMENDED | Schema / App | Application-level notification creation recommended. Does not block migration. |
| **PD-D7** | `confirmed_priority` Nullable | RECOMMENDED | Schema | Nullable column in schema; populated during coordinator review. Does not block migration. |
| **PD-D8** | Hard User Deletion Policy | OPEN | Roles / Schema | Soft deactivation (`is_active = false`) adopted for MVP. Does not block migration. |
| **PD-D9** | Timestamps on `categories` | RECOMMENDED | Schema | `categories` table without timestamps approved. Does not block migration. |
| **PD-D10** | Uniqueness Constraint on `locations` | RECOMMENDED | Schema | Uniqueness across (building, floor, room) recommended. Does not block migration. |
| **PD-S1** | API Rate Limiting Strategy | OPEN | Security | Application/gateway layer concern. Does not block migration. |
| **PD-S2** | Session Timeout Duration | OPEN | Security | Supabase Auth configuration. Does not block migration. |
| **PD-S3** | Password Policy Requirements | OPEN | Security | Supabase Auth configuration. Does not block migration. |
| **PD-S4** | CORS Configuration | OPEN | Security | Supabase project configuration. Does not block migration. |
| **PD-W5** | Maximum Reopening Count | OPEN | Workflow | Business rule; column is unconstrained in database. Does not block migration. |
| **PD-W6** | `under_review` Always Required | RECOMMENDED | Workflow | Workflow allows direct triage or review. Both paths supported by schema. Does not block migration. |

### Feature-Level Open Questions (Deferred to Implementation)
1. **Attachment Deletion Justification:** Soft deletion records `deleted_at` and `deleted_by`. If an audit justification is required in the future, an additional column (`deletion_reason TEXT`) can be introduced in a future migration.
2. **Historical Visibility Retention Period:** Technicians currently retain read access to qualifying past assignments indefinitely. A formal revocation/archival policy may be established in a future release.
3. **`assignment_declined` Notification Type:** If a dedicated notification type is required when a technician declines an assignment, it can be added to `notification_type` enum via `ALTER TYPE ... ADD VALUE` before notifications are wired up.

---

## 7. Remaining Risks and Mitigations

| Risk | Context | Mitigation Strategy |
|---|---|---|
| **Storage Object & Metadata Consistency** | Storage uploads occur over HTTP and DB inserts occur over SQL; partial network failures may leave an orphaned storage object or a metadata row without a file. | In Phase 4, implement a two-step client flow: (1) upload file to Storage, (2) insert metadata row in DB. If step 2 fails, application cleans up storage object. A periodic reconciliation job deletes unreferenced storage objects. |
| **`storage.objects` RLS Evaluation Performance** | Evaluating complex joins (`EXISTS SELECT FROM report_attachments JOIN reports ...`) inside `storage.objects` policies on high-volume downloads can add latency. | The index on `report_attachments(file_path)` and `report_attachments(report_id, deleted_at)` ensures index-only or fast index scans. For high download traffic, authorized backend endpoints can generate signed URLs with short TTLs. |
| **Decline Reason Trimming Overhead** | `btrim(decline_reason) != ''` is evaluated during assignment decline updates. | Negligible CPU cost; evaluates on single row during decline transition. Prevents whitespace pollution in audit history. |
| **Client Bypass of Upload Limits** | A malicious client could attempt concurrent file uploads to bypass the 5-attachment count check. | The storage INSERT RLS policy enforces the count check server-side. Additionally, the application API layer validates active count in a serialized transaction before generating upload targets. |

---

## 8. Migration Readiness Verdict

### **VERDICT: READY FOR MIGRATION PREPARATION**

### Justification:
1. **All 19 Decisions Approved:** Every core schema, enum, constraint, RLS, and storage design decision is now **OWNER APPROVED**.
2. **100% Documentation Consistency:** Table definitions, columns, data types, constraints, and cascade behaviors match exactly across `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, and `OPEN_DECISIONS.md`.
3. **Defense-in-Depth Enforced:** The decline reason constraint enforces non-null, non-empty, and non-whitespace validation directly in PostgreSQL.
4. **Storage Architecture Fully Documented:** Private bucket rules and storage RLS policies are fully detailed and ready to be transcribed into migration SQL.
5. **No Migration Blockers:** All open items are non-blocking application/configuration decisions.

---

## 9. Validation

- **Git Status:** All modified and created files reside strictly within `docs/database-design/`.
- **Restrictions Honored:**
  - No SQL files or migration files were created.
  - No SQL was executed.
  - No Supabase connection or modification was attempted.
  - No application code, environment files, package files, or Phase 0 documents were altered.
  - No credentials or secrets were exposed.

---

*Phase 3F review complete on 2026-10-18.*  
*All documentation reconciled. Awaiting explicit owner authorization before creating migration SQL scripts.*
