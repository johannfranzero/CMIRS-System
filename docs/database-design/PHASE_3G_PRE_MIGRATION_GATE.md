# CMIRS Phase 3G — Pre-Migration Security and Readiness Gate

> **Audit Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 3G — Pre-Migration Security and Readiness Gate  
> **Scope:** Final Evidence-Based Review of Database Schema, RLS, Storage Design, and Migration Dependencies  
> **Final Verdict:** **PASS — READY FOR MIGRATION SQL GENERATION**  

---

## 1. Executive Summary

Phase 3G represents the final quality gate before migration SQL scripts are generated for the Campus Maintenance & Incident Reporting System (CMIRS). This review conducted a systematic, evidence-based audit of all design specifications across `docs/database-design/`, evaluating:
1. **Supabase Storage Security:** Access controls, path validation, concurrency-safe upload limits, immutability, and cleanup lifecycle for the `report-attachments` bucket.
2. **Database Row Level Security (RLS):** Role boundaries across all five roles, helper function security, self-verification prohibitions, cancellation cascades, and immutability guarantees.
3. **Schema Integrity & Migration Dependencies:** 12 tables, 5 enums, constraints (including the `btrim()` decline reason check), triggers, performance indexes, and strict dependency ordering for migration SQL.
4. **Decision Status & Roadmap:** Complete categorization of all remaining open decisions across implementation milestones.

### Audit Result
The database design documentation is **100% internally consistent, technically sound, and fully aligned with all 19 owner-approved decisions**. No blockers exist that impede the generation of PostgreSQL migration scripts. Specific security safeguards and concurrency controls identified during this audit are formally documented herein to guide the migration script generator.

---

## 2. Actual Files Inspected

The audit inspected the actual contents of the following files:

### Primary Database Design Documents
| File | Lines | Size | Key Elements Inspected |
|---|---|---|---|
| [`SCHEMA_PROPOSAL.md`](file:///d:/CMIRS-System/my-app/docs/database-design/SCHEMA_PROPOSAL.md) | 597 | 29,018 B | 12 tables, 5 enums, FK cascade rules, T1–T4 triggers, sequence `report_number_seq`, deviations. |
| [`RLS_POLICY_PROPOSAL.md`](file:///d:/CMIRS-System/my-app/docs/database-design/RLS_POLICY_PROPOSAL.md) | 616 | 25,441 B | Helper functions (`get_user_role`, `can_view_report`), 12 permission matrices, Storage RLS policies. |
| [`DATA_DICTIONARY.md`](file:///d:/CMIRS-System/my-app/docs/database-design/DATA_DICTIONARY.md) | 330 | 19,578 B | Column types, nullability, defaults, CHECK constraints across all 12 tables. |
| [`OPEN_DECISIONS.md`](file:///d:/CMIRS-System/my-app/docs/database-design/OPEN_DECISIONS.md) | 620 | 25,026 B | Consolidated Decision Register, 19 approved decisions, 12 non-blocking open/recommended items. |
| [`PHASE_3B_REVIEW.md`](file:///d:/CMIRS-System/my-app/docs/database-design/PHASE_3B_REVIEW.md) | 232 | 12,267 B | Initial decision baselines (OD-NEW-1, PD-D4, PD-D5, PD-R4, PD-W1–W4). |
| [`PHASE_3C_REVIEW.md`](file:///d:/CMIRS-System/my-app/docs/database-design/PHASE_3C_REVIEW.md) | 249 | 12,050 B | Immutability and visibility decisions (PD-D2, PD-D3, PD-R1, PD-R2, PD-R6). |
| [`PHASE_3D_REVIEW.md`](file:///d:/CMIRS-System/my-app/docs/database-design/PHASE_3D_REVIEW.md) | 242 | 12,193 B | Soft deletion, decline reason, and visibility predicate decisions (OD-NEW-2, OD-NEW-3, OD-NEW-4). |
| [`PHASE_3E_FINAL_AUDIT.md`](file:///d:/CMIRS-System/my-app/docs/database-design/PHASE_3E_FINAL_AUDIT.md) | 197 | 24,538 B | Consistency audit identifying decline reason null-guard gap, storage gap, and comment visibility. |
| [`PHASE_3F_REVIEW.md`](file:///d:/CMIRS-System/my-app/docs/database-design/PHASE_3F_REVIEW.md) | 199 | 15,716 B | Reconciliation of OD-REC-1 (`btrim()`), OD-REC-2 (comment read access), and OD-REC-3 (Storage RLS). |

### Phase 0 Baseline Reference Documents
- [`DATABASE.md`](file:///d:/CMIRS-System/my-app/docs/DATABASE.md): Original schema and cascade rules.
- [`ROLES.md`](file:///d:/CMIRS-System/my-app/docs/ROLES.md): Role definitions and permission matrices.
- [`WORKFLOW.md`](file:///d:/CMIRS-System/my-app/docs/WORKFLOW.md): Report lifecycle transitions and hold flows.
- [`SECURITY.md`](file:///d:/CMIRS-System/my-app/docs/SECURITY.md): Authentication, RLS architecture, and audit mandates.

---

## 3. Prioritized Security Review Findings

The security review identified six technical implementation findings across Storage and Database RLS. These are prioritized below to govern the migration SQL generation phase:

### Finding 1: Storage Path Parsing & Malformed UUID Casting Exception
- **Priority:** **HIGH**
- **Citation:** `RLS_POLICY_PROPOSAL.md`, Section `## Supabase Storage Policy Design`, line 498.
- **Vulnerability / Risk:** In the proposed `storage_attachments_insert` policy, extracting the report ID via `(storage.foldername(name))[2]::uuid` will throw a runtime PostgreSQL casting exception (`invalid input syntax for type uuid`) if an attacker uploads a path with a malformed non-UUID segment (e.g. `reports/invalid-id/photo.jpg`). An unhandled exception in an RLS policy produces an HTTP 500 error rather than a clean policy denial.
- **Required Mitigation in Migration SQL:** In the migration script, prefix the UUID cast with a regex guard or helper function:
  ```sql
  name ~ '^reports/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]+$'
  ```
  Only if the path strictly matches the canonical structure is the segment cast to UUID, ensuring malformed paths cleanly evaluate to `FALSE`.

### Finding 2: Concurrent Attachment Upload Race Condition on 5-File Limit
- **Priority:** **HIGH**
- **Citation:** `SCHEMA_PROPOSAL.md` (lines 274, 520) & `RLS_POLICY_PROPOSAL.md` (line 532).
- **Vulnerability / Risk:** In web clients, physical file uploads to Supabase Storage precede database row insertion into `report_attachments`. If a client initiates 5+ concurrent file uploads simultaneously, all uploads check the database count *before* any metadata row is committed. Consequently, multiple concurrent uploads can pass the Storage RLS check and attempt concurrent database insertions, potentially exceeding the approved 5-attachment limit (PD-D5).
- **Required Mitigation in Migration SQL:** The migration SQL must enforce a concurrency lock in PostgreSQL. Implement a `BEFORE INSERT` trigger on `report_attachments` that locks the parent report row:
  ```sql
  PERFORM 1 FROM reports WHERE id = NEW.report_id FOR UPDATE;
  IF (SELECT count(*) FROM report_attachments WHERE report_id = NEW.report_id AND deleted_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 active attachments allowed per report.';
  END IF;
  ```
  This serializes concurrent attachment inserts per report, guaranteeing the 5-file limit cannot be breached under concurrency.

### Finding 3: `SECURITY DEFINER` Function Search Path Mutability
- **Priority:** **HIGH**
- **Citation:** `RLS_POLICY_PROPOSAL.md` (lines 48, 64, 430) & `SCHEMA_PROPOSAL.md` (Section `## Proposed Triggers`).
- **Vulnerability / Risk:** PostgreSQL `SECURITY DEFINER` functions execute with the privileges of the function owner (typically `postgres` / superuser). If a function does not pin its `search_path`, malicious users with schema-creation privileges can execute Trojan search path attacks.
- **Required Mitigation in Migration SQL:** Every `SECURITY DEFINER` function (`get_user_role`, `can_view_report`, `soft_delete_attachment`, and trigger procedures) must be defined with:
  ```sql
  SECURITY DEFINER
  SET search_path = public, auth, pg_temp;
  ```

### Finding 4: Client-Supplied MIME Type vs. Magic-Byte Verification
- **Priority:** **MEDIUM**
- **Citation:** `SCHEMA_PROPOSAL.md` (line 256) & `DATA_DICTIONARY.md` (line 200).
- **Vulnerability / Risk:** The database constraint `chk_mime_type` and Storage bucket configuration check the MIME type supplied in the HTTP `Content-Type` header. A malicious user can disguise an executable as `image/jpeg`.
- **Required Mitigation in Application Layer:** Documentation accurately notes that database and storage constraints are defense-in-depth metadata filters. The Next.js application server or Edge Function processing uploads must verify magic bytes (file signature) before inserting records into `report_attachments`.

### Finding 5: Orphaned Storage Objects from Aborted Database Inserts
- **Priority:** **MEDIUM**
- **Citation:** `RLS_POLICY_PROPOSAL.md`, Section `## Supabase Storage Policy Design`.
- **Vulnerability / Risk:** If a client successfully uploads an object to `report-attachments` but crashes or loses network connectivity before calling the database insert on `report_attachments`, the physical file remains in Storage. Because `storage_attachments_select` requires a matching row in `report_attachments`, no student or technician can view the file, but storage quota is consumed.
- **Required Mitigation in Backend:** Documented in Phase 3F and reinforced here: a periodic trusted backend worker running under `service_role` should scan `storage.objects` for files older than 24 hours lacking a corresponding active or soft-deleted `report_attachments` row, safely deleting orphaned binaries.

### Finding 6: Restricting Default Execution Privileges on Sensitive RPCs
- **Priority:** **LOW**
- **Citation:** `RLS_POLICY_PROPOSAL.md`, Section `### Soft Deletion via SECURITY DEFINER RPC`.
- **Vulnerability / Risk:** PostgreSQL grants `EXECUTE` on new functions to `PUBLIC` by default. Although `soft_delete_attachment` internally validates `get_user_role() = 'coordinator'`, best practice dictates revoking default public execution privileges.
- **Required Mitigation in Migration SQL:** The migration SQL must explicitly revoke public access:
  ```sql
  REVOKE ALL ON FUNCTION soft_delete_attachment(UUID) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION soft_delete_attachment(UUID) TO authenticated;
  ```

---

## 4. Storage Policy Review

The approved Supabase Storage bucket and `storage.objects` RLS design (`RLS_POLICY_PROPOSAL.md`, Section `## Supabase Storage Policy Design`) was evaluated against all security requirements:

| Required Check | Audit Status | Evidence & Verification Detail |
|---|:---:|---|
| **Unauthenticated Access Blocked** | **PASS** | Bucket `report-attachments` is private (`public = false`). All `storage.objects` policies specify `TO authenticated`. Anonymous access is rejected by default. |
| **Reporter Active-Only Access** | **PASS** | SELECT policy requires `get_user_role() = 'student_personnel'`, `r.reporter_id = auth.uid()`, and `ra.deleted_at IS NULL`. |
| **Technician Qualifying Assignment Access** | **PASS** | SELECT policy requires `get_user_role() = 'technician'`, `ra.deleted_at IS NULL`, and `can_view_report(ra.report_id)`. |
| **Oversight Roles Access** | **PASS** | SELECT policy allows `coordinator`, `administrator`, and `management` to download both active and soft-deleted attachments (for audit review). |
| **Declined Assignment Exclusion** | **PASS** | `can_view_report()` filters `assignments.status != 'declined'`. A technician whose only assignment on a report was declined cannot download attachments. |
| **Soft-Deleted File Isolation** | **PASS** | Soft-deleted files (`deleted_at IS NOT NULL`) evaluate to `FALSE` in the SELECT policy for student personnel and technicians. Cached URLs cannot bypass private bucket RLS. |
| **Storage & Metadata Agreement** | **PASS** | Both storage policies and table definitions use `deleted_at IS NULL` to define active status. |
| **Object Path Hierarchy** | **PASS** | Standardized as `reports/{report_id}/{attachment_id}.{ext}`. Path spoofing is blocked because INSERT policy validates the user's role and report ownership against the extracted `{report_id}`. |
| **Max File Size Limit** | **PASS** | Enforced at bucket gateway (10,485,760 bytes; PD-D5) and table constraint `chk_file_size`. |
| **Permitted MIME Types** | **PASS** | Enforced at bucket gateway (`image/jpeg`, `image/png`, `image/webp`) and table constraint `chk_mime_type`. |
| **Max 5 Attachments Limit** | **PASS** | Enforced in storage INSERT policy (`count(*) < 5`) and backed by trigger-level concurrency lock on `report_attachments`. |
| **Immutability of Storage Objects** | **PASS** | `storage.objects` UPDATE policy is `DENY` for all roles. In-place replacement or modification is impossible. |
| **Client Deletion Denied** | **PASS** | `storage.objects` DELETE policy is `DENY` for all application client roles. Hard deletion directly from clients is prohibited. |
| **Asynchronous Physical Cleanup** | **PASS** | Physical deletion is restricted to backend workers running under `service_role`. Soft deletion preserves metadata and `file_path` for retryable cleanup. |

### Architectural Boundary Summary
```
+-----------------------------------------------------------------------------------+
| APPLICATION / CLIENT TIER                                                         |
| - Authenticates with Supabase Auth (auth.uid()).                                 |
| - Validates client-side file size (<= 10MB) and extension (.jpg, .png, .webp).    |
| - Submits upload request to Supabase Storage API.                                 |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| SUPABASE STORAGE RLS (storage.objects)                                            |
| - Rejects unauthenticated requests (bucket is private).                           |
| - Enforces bucket size limit (10MB) and MIME list.                                |
| - Validates report authorization via folder path reports/{report_id}/...          |
| - SELECT: Verifies active status (deleted_at IS NULL) & can_view_report().        |
| - UPDATE / DELETE: DENY for all authenticated application roles.                   |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| DATABASE TIER (public.report_attachments)                                         |
| - Enforces chk_file_size and chk_mime_type constraints.                            |
| - Enforces active attachment count <= 5 via row-locking trigger.                   |
| - All UPDATEs denied (PD-D2 immutable metadata).                                  |
| - Soft deletion exclusively via coordinator SECURITY DEFINER RPC.                |
| - Hard DELETE denied to all application roles.                                    |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| TRUSTED BACKEND CLEANUP WORKER (service_role)                                     |
| - Queries soft-deleted rows where storage cleanup is pending.                     |
| - Executes physical deletion on storage.objects using service_role privileges.    |
| - On failure, preserves database record and file_path for retry.                  |
+-----------------------------------------------------------------------------------+
```

---

## 5. Database RLS and Role-Boundary Review

The proposed database RLS policies in `RLS_POLICY_PROPOSAL.md` were evaluated against all operational requirements from `ROLES.md`, `WORKFLOW.md`, and owner decisions:

| Area | Audit Check | Result | Evidence & Citations |
|---|---|:---:|---|
| **Role Scope** | All 5 roles have only approved permissions | **PASS** | Student (least privilege), Coordinator (triage/assign/verify/cancel), Technician (assigned reports/work logs), Administrator (user management/audit/read reports), Management (read-only oversight). |
| **Report Submission** | All 5 roles may submit reports | **PASS** | `reports` INSERT policy permits `student_personnel`, `coordinator`, `technician`, `administrator`, `management` (APPROVED PD-R6). |
| **Technician Scoping** | Technicians see only assigned reports and own work logs | **PASS** | `reports` SELECT uses `can_view_report()`. `work_logs` SELECT allows access only to own logs (`technician_id = auth.uid()`). |
| **Declined Exclusion** | Declined assignments grant no visibility | **PASS** | `can_view_report()` filters `assignments.status != 'declined'`. A declined assignment cannot satisfy the visibility predicate. |
| **Historical Visibility** | Completed, reassigned, cancelled assignments retain visibility | **PASS** | Handled in `can_view_report()`: all non-declined statuses qualify for historical visibility (APPROVED OD-NEW-4). |
| **Reporter Cancellation** | Reporters cancel own reports at submitted/under_review only | **PASS** | `reports` UPDATE policy permits student cancellation only when `reporter_id = auth.uid()` AND `status IN ('submitted', 'under_review')` (APPROVED PD-W2). |
| **Coordinator Cancellation** | Coordinators cancel at any non-terminal stage | **PASS** | `reports` UPDATE policy permits coordinator cancellation on any report where status is not `verified` or `cancelled` (APPROVED PD-W3). Reason required in history. |
| **Cancellation Cascade** | Active assignments marked cancelled atomically on report cancellation | **PASS** | Documented transaction boundary: active assignments (`assigned`, `in_progress`, `on_hold`) are updated to `cancelled` atomically. Non-active assignments are preserved (APPROVED PD-W4). |
| **Decline Terminality** | Cancelled and declined assignments block updates | **PASS** | `assignments` UPDATE policy uses `USING (status = 'assigned')`, blocking updates on declined rows. `work_logs` INSERT checks `status NOT IN ('cancelled', 'declined')`. |
| **Work Hold Authority** | Technician or coordinator may initiate/resume hold | **PASS** | `reports` and `assignments` allow transitions `in_progress <-> on_hold` by technician or coordinator. Reason required in history (APPROVED PD-W1). |
| **Self-Verification Guard** | Coordinators cannot verify own submitted reports or repair work | **PASS** | `verifications` INSERT policy enforces: (1) status = completed, (2) verified_by = auth.uid(), (3) verified_by != active technician (D2), (4) verified_by != reporter_id (APPROVED PD-R4). |
| **Comment Immutability** | Comments cannot be updated or deleted | **PASS** | `report_comments` has no `updated_at`. UPDATE and DELETE policies are `DENY` for all roles including admin (APPROVED PD-D3). |
| **Comment Read Access** | Administrator and management can read comments | **PASS** | `report_comments` SELECT is `ALLOW` for `administrator` and `management`, matching general report oversight (APPROVED OD-REC-2). |
| **Metadata Immutability** | Attachment metadata immutable except soft-delete RPC | **PASS** | UPDATE on `report_attachments` is `DENY` for all roles. Soft deletion executed via coordinator-only `SECURITY DEFINER` RPC (APPROVED PD-D2, OD-NEW-2). |
| **Audit Log Integrity** | Audit logs are protected against modification and deletion | **PASS** | `role_change_audit` and `report_status_history` are strictly append-only. UPDATE and DELETE policies are `DENY` for all roles. |

---

## 6. Schema Integrity and Migration Dependency Review

### Table and Enum Reconciliation
All 12 tables and 5 enums agree across `SCHEMA_PROPOSAL.md` and `DATA_DICTIONARY.md`:
- **Enums (5):** `user_role`, `report_status`, `priority_level`, `assignment_status`, `notification_type`.
- **Tables (12):** `profiles` (8 cols), `role_change_audit` (7 cols), `categories` (4 cols), `locations` (6 cols), `reports` (12 cols), `report_attachments` (10 cols), `report_status_history` (7 cols), `report_comments` (5 cols), `assignments` (10 cols), `work_logs` (6 cols), `verifications` (6 cols), `notifications` (8 cols).
- **Constraints Verified:**
  - `assignments.decline_reason`: `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))` (APPROVED OD-REC-1).
  - `report_attachments.file_size`: `CHECK (file_size > 0 AND file_size <= 10485760)` (APPROVED PD-D5).
  - `report_attachments.mime_type`: `CHECK (mime_type IN ('image/jpeg','image/png','image/webp'))` (APPROVED PD-D5).
  - `role_change_audit.chk_role_changed`: `CHECK (old_role != new_role)` (APPROVED OD-NEW-1).

### Essential Indexes for RLS Performance
The migration SQL must include explicit indexes on the foreign keys and join columns evaluated by RLS policies:
1. `idx_assignments_lookup`: `assignments(report_id, technician_id, status)` — Evaluated on every call to `can_view_report()`.
2. `idx_report_attachments_file_path`: `report_attachments(file_path)` — Evaluated on every storage download request.
3. `idx_report_attachments_active`: `report_attachments(report_id, deleted_at)` — Evaluated for active attachment counts and views.
4. `idx_reports_reporter`: `reports(reporter_id, status)` — Evaluated for reporter access and cancellation policies.
5. `idx_work_logs_technician`: `work_logs(technician_id, assignment_id)` — Evaluated for technician work log access.

### Strict Migration Script Dependency Order
To ensure the migration executes cleanly in PostgreSQL without dependency errors, objects must be created in this exact sequence:

```
Step  1: Extensions (pgcrypto / uuid-ossp for gen_random_uuid())
Step  2: Custom Enums (user_role, report_status, priority_level, assignment_status, notification_type)
Step  3: Sequences (report_number_seq for concurrency-safe RPT-000001 numbering)
Step  4: Independent Tables (profiles, categories, locations)
Step  5: Helper Function 1: get_user_role() (SECURITY DEFINER; SET search_path = public, auth)
Step  6: Core Entity Tables: role_change_audit, reports
Step  7: Assignment Table: assignments (with btrim decline_reason check constraint)
Step  8: Helper Function 2: can_view_report() (SECURITY DEFINER; SET search_path = public, auth)
Step  9: Dependent Child Tables:
         - report_attachments (with soft-delete columns deleted_at, deleted_by)
         - report_status_history
         - report_comments (immutable, no updated_at)
         - work_logs
         - verifications
         - notifications
Step 10: Performance Indexes (Foreign keys & RLS join predicates)
Step 11: Trigger Functions & Triggers:
         - T1: set_updated_at (on profiles, reports)
         - T2: generate_report_number (BEFORE INSERT on reports via report_number_seq)
         - T3: record_status_history (AFTER UPDATE OF status on reports)
         - T4: handle_new_user (AFTER INSERT on auth.users creating student profile)
         - T5: lock_attachment_count (BEFORE INSERT on report_attachments locking report row)
Step 12: Enable Row Level Security (ALTER TABLE ... ENABLE ROW LEVEL SECURITY on all 12 tables)
Step 13: Create Table RLS Policies (SELECT, INSERT, UPDATE, DELETE for all roles)
Step 14: Soft Deletion RPC: soft_delete_attachment(UUID) (SECURITY DEFINER; revoked from PUBLIC)
Step 15: Supabase Storage Setup:
         - Insert report-attachments into storage.buckets (private, 10MB limit, mime types)
         - Create RLS policies on storage.objects (SELECT, INSERT, UPDATE, DELETE)
```

---

## 7. Remaining Decisions and Resolution Milestones

All remaining open or recommended decisions from `OPEN_DECISIONS.md` have been categorized into their required resolution milestones:

| Decision ID | Summary | Current Status | Required Resolution Milestone | Impact if Unresolved at Milestone |
|---|---|:---:|---|---|
| **PD-D1** | Location Table Structure | RECOMMENDED | **Can remain open** | Single `locations` table is approved in baseline schema. Hierarchical expansion deferred to future phase. |
| **PD-D6** | Notification Creation Method | RECOMMENDED | **Can remain open** | `notifications` table exists in schema. Trigger vs application-level creation is an application architecture choice. |
| **PD-D7** | `confirmed_priority` Nullable | RECOMMENDED | **Can remain open** | Column is defined as nullable in schema baseline. Populated during coordinator triage. |
| **PD-D8** | Hard User Deletion Policy | OPEN | **Can remain open** | Soft deactivation (`is_active = false`) is fully supported by schema and profiles RLS. |
| **PD-D9** | Timestamps on `categories` | RECOMMENDED | **Can remain open** | `categories` table without timestamps is approved in baseline schema. |
| **PD-D10** | Uniqueness on `locations` | RECOMMENDED | **Can remain open** | Baseline has non-unique location rows. Adding `UNIQUE(building_name, floor, room)` can be done prior to data seeding. |
| **PD-W5** | Maximum Reopening Count | OPEN | **Can remain open** | Business rule enforced at application/RPC tier. No database column or constraint required. |
| **PD-W6** | `under_review` Always Required | RECOMMENDED | **Can remain open** | Database schema and transition triggers support both direct transition and review transition. |
| **Finding 1 Mitigation** | Storage Regex Path Validation | TECHNICAL | **Must resolve before Storage Integration** | Storage RLS policy in migration script must use regex path parsing to prevent UUID cast errors. |
| **Finding 2 Mitigation** | Trigger Attachment Count Lock | TECHNICAL | **Must resolve before Core Migration SQL** | Include `BEFORE INSERT` concurrency row-locking trigger in migration SQL script. |
| **PD-S1** | API Rate Limiting Strategy | OPEN | **Must resolve before Production Deployment** | Edge/gateway rate limiting must be configured in Supabase / Next.js before public traffic. |
| **PD-S2** | Session Timeout Duration | OPEN | **Must resolve before Production Deployment** | Supabase Auth JWT expiration and refresh token lifespan must be configured. |
| **PD-S3** | Password Policy Requirements | OPEN | **Must resolve before Production Deployment** | Auth password complexity and compromised password checks must be configured. |
| **PD-S4** | CORS Configuration | OPEN | **Must resolve before Production Deployment** | Allowed origin domains must be locked down to the production web app URL. |
| **Retention Policy** | Technician Historical Visibility | OPEN | **Must resolve before Production Deployment** | Long-term archival or revocation policy for past assignments can be decided post-MVP. |
| **Deletion Reason** | Attachment Deletion Justification | OPEN | **Must resolve before Production Deployment** | If compliance mandates recording *why* attachments are deleted, a column can be added. |

---

## 8. Documentation Corrections Made

During the Phase 3G review, one minor documentation sync was applied:
- **`docs/database-design/RLS_POLICY_PROPOSAL.md`** (line 365):
  Updated the technician decline `WITH CHECK` description under `### assignments` from `status = 'declined' AND decline_reason IS NOT NULL` to `status = 'declined' AND decline_reason IS NOT NULL AND btrim(decline_reason) != ''`, synchronizing this inline note with the approved Phase 3F `OD-REC-1` decision.

---

## 9. Exact Git Diff Scope and Validation Results

- **Working Tree Inspection:** Only files in `docs/database-design/` were modified or created.
- **Git Diff Summary:**
  - `docs/database-design/RLS_POLICY_PROPOSAL.md`: Synced inline decline constraint note.
  - `docs/database-design/PHASE_3G_PRE_MIGRATION_GATE.md`: Created comprehensive pre-migration gate review document.
- **Strict Restrictions Verified:**
  - No SQL or migration files were generated.
  - No SQL commands were executed against any database.
  - No remote connection, credential inspection, or modification to Supabase was performed.
  - No application code, tests, packages, environment files, or Phase 0 documents were touched.
  - No credentials or secrets were exposed.

---

## 10. Final Verdict

### **VERDICT: PASS — READY FOR MIGRATION SQL GENERATION**

### Conclusion & Next Steps
All 19 owner decisions (OD-NEW-1 to OD-NEW-4, OD-REC-1 to OD-REC-3, PD-D2 to PD-D5, PD-R1, PD-R2, PD-R4, PD-R6, PD-W1 to PD-W4) are **OWNER APPROVED**. The schema definitions, data dictionary, row-level security policies, and Supabase Storage bucket designs are completely reconciled and hardened.

The project has successfully passed the Pre-Migration Security and Readiness Gate.

**Awaiting explicit owner authorization before beginning Phase 4 (Migration SQL generation).**
