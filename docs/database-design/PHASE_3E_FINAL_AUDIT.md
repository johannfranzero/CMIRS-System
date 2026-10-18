# CMIRS - Phase 3E Final Database Design Consistency Audit

> **Audit Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Scope:** Final Consistency Audit across all Database Design Documentation  
> **Status:** AUDIT COMPLETE — DOCUMENTATION RECONCILED  

---

## 1. Audit Summary

This document presents the final consistency audit of the CMIRS database design documentation prior to authorizing SQL migration script preparation. The audit inspected all design documentation in `docs/database-design/`, cross-referencing them against Phase 0 foundational requirements (`docs/DATABASE.md`, `docs/ROLES.md`, `docs/WORKFLOW.md`, `docs/SECURITY.md`) and all owner decisions approved across Phases 3B, 3C, and 3D.

### Summary of Audit Results
- **Core Schema Baseline:** All 12 tables, 5 enums, and foreign key cascade rules are 100% reconciled across `SCHEMA_PROPOSAL.md` and `DATA_DICTIONARY.md`.
- **Approved Owner Decisions:** All 16 owner-approved decisions (OD-NEW-1 through OD-NEW-4, PD-D2 through PD-D5, PD-R1, PD-R2, PD-R4, PD-R6, PD-W1 through PD-W4) are consistently reflected in the core schema and RLS proposals.
- **Critical Area A (Attachment Soft Deletion — OD-NEW-2):** Verified that soft deletion is coordinator-restricted via a `SECURITY DEFINER` RPC, metadata is immutable (PD-D2), hard DELETE is denied to all application roles, file paths are preserved for retryable Storage cleanup, active counts enforce the 5-attachment limit, and visibility filters properly separate active from deleted attachments. Clarified that Storage retry tracking is managed at the application/worker tier and that no phantom database column exists.
- **Critical Area B (Assignment Decline — OD-NEW-3):** Verified `decline_reason` exists on `assignments`, decline transition is atomic, restricted to assigned technicians, blocks subsequent work logging, and preserves full history. Clarified the crucial boundary between the database-level `NOT NULL` check constraint and application-level non-empty/non-whitespace validation, recording a proposed database-level `btrim` check constraint for owner approval.
- **Critical Area C (Technician Report Visibility — OD-NEW-4):** Verified `can_view_report()` correctly excludes technicians whose only assignments were declined, preserves historical access for qualifying non-declined statuses, restricts work logs to own assignments, and handles multiple assignment records consistently. Clarified that child table SELECT policies (`report_attachments`, `report_status_history`, `report_comments`, `verifications`) evaluate this qualifying check via `can_view_report()`.
- **Critical Area D (Cross-Document Consistency):** Identified and resolved minor documentation ambiguities across `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, and `OPEN_DECISIONS.md`. Identified security and access gaps (Supabase Storage bucket RLS policies, administrator/management comment read access) as formal recommendations requiring owner review.

---

## 2. Files Inspected

The audit directly inspected the following repository files:

### Primary Database Design Documents
1. `docs/database-design/SCHEMA_PROPOSAL.md` (594 lines) — Table schemas, enum definitions, constraints, triggers, and deviations.
2. `docs/database-design/RLS_POLICY_PROPOSAL.md` (477 lines) — Helper functions, permission matrices, and security specifications.
3. `docs/database-design/DATA_DICTIONARY.md` (331 lines) — Column-level data dictionary, data types, nullability, defaults, and constraints.
4. `docs/database-design/OPEN_DECISIONS.md` (616 lines) — Consolidated decision register, approved decisions, open items, and recommendations.
5. `docs/database-design/PHASE_3B_REVIEW.md` (232 lines) — Phase 3B historical review document.
6. `docs/database-design/PHASE_3C_REVIEW.md` (249 lines) — Phase 3C historical review document.
7. `docs/database-design/PHASE_3D_REVIEW.md` (242 lines) — Phase 3D historical review document.

### Phase 0 Baseline Reference Documents
8. `docs/DATABASE.md` — Original entity relationship definitions and schema rules.
9. `docs/ROLES.md` — Role definitions, permissions, and operational boundaries.
10. `docs/WORKFLOW.md` — Lifecycle status transitions, cancellation rules, and hold flows.
11. `docs/SECURITY.md` — Security requirements, RLS architecture, and audit mandates.

---

## 3. Decision Consistency Matrix

| Decision ID | Summary & Expected Behavior | Documents Checked | Result | Evidence in Documentation |
|---|---|---|---|---|
| **OD-NEW-1** | `role_change_audit` table included; tracks user, changed_by, old_role, new_role, reason, timestamp; append-only. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | Table defined with 7 columns; `chk_role_changed` constraint; INSERT restricted to administrator; UPDATE/DELETE DENY for all roles. |
| **OD-NEW-2** | Soft deletion of `report_attachments` via `deleted_at` and `deleted_by` (FK -> profiles RESTRICT); coordinator-only RPC; metadata immutable; hard DELETE denied. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | Columns added in schema and data dictionary; soft-delete RPC defined; hard DELETE DENY all; active view filters `WHERE deleted_at IS NULL`. |
| **OD-NEW-3** | `decline_reason` TEXT on `assignments`; required when `status = 'declined'`; decline transition atomic; terminal status; work logs blocked. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | Column defined; CHECK constraint `CHECK (status != 'declined' OR decline_reason IS NOT NULL)`; work_logs INSERT guards against declined. |
| **OD-NEW-4** | Technician report visibility predicate excludes `declined` assignments; historical visibility retained for completed/reassigned/cancelled; own work logs only. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `can_view_report()` uses `assignments.status != 'declined'`; `work_logs` SELECT restricted to own assignments; qualifying statuses explicitly tabulated. |
| **PD-D2** | Attachment file metadata immutable after upload; coordinator-controlled soft deletion; no arbitrary metadata modification. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | File metadata UPDATE is DENY for all roles; soft-delete RPC only mutates `deleted_at` and `deleted_by`. |
| **PD-D3** | `report_comments` immutable after creation; `updated_at` column removed; UPDATE and DELETE denied to all roles including admin. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `report_comments` defined without `updated_at`; T1 trigger removed; RLS matrix enforces UPDATE/DELETE DENY for all roles. |
| **PD-D4** | Report number format `RPT-000001` via PostgreSQL SEQUENCE; concurrency-safe; unique. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | T2 trigger uses dedicated PostgreSQL sequence `report_number_seq` and `LPAD`; no race condition during concurrent creation. |
| **PD-D5** | Photo uploads: max 5 attachments per report; max 10 MB per file; JPEG, PNG, WebP only; limit counts active only. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `chk_file_size` (<= 10485760 bytes) and `chk_mime_type` constraints; active attachment count checks `WHERE deleted_at IS NULL <= 5`. |
| **PD-R1** | Technicians access only assigned reports (scoped by qualifying assignment); no broad report browsing. | `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md`, `SCHEMA_PROPOSAL.md` | **CONSISTENT** | `reports` SELECT uses `can_view_report()`; non-assigned reports remain hidden from technicians. |
| **PD-R2** | Technicians may decline assignments before starting; decline is terminal; required reason. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `declined` added to `assignment_status` enum; transition allowed only from `assigned`; `USING status = 'assigned'` blocks further updates. |
| **PD-R4** | Coordinator self-verification prohibited (`verified_by != reports.reporter_id`); coordinator cannot verify own submitted report. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `verifications` INSERT RLS policy enforces condition 4: `verified_by != reports.reporter_id` alongside D2 restriction. |
| **PD-R6** | All five authenticated roles may submit reports (including administrator and management). | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `reports` INSERT policy updated to ALLOW for all five roles; role descriptions and deviations updated. |
| **PD-W1** | Work hold initiation permitted by technician or coordinator; reason required; resumption permitted by technician or coordinator. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `on_hold` status in `report_status` and `assignment_status`; transitions bidirectional with `in_progress`; reason required in history. |
| **PD-W2** | Reporter cancellation authority permitted at `submitted` or `under_review` stages only; cancellation reason required. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `reports` UPDATE policy permits student_personnel to cancel own report only if status is submitted or under_review. |
| **PD-W3** | Coordinator cancellation authority permitted at any non-terminal stage; reason required. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | `reports` UPDATE policy allows coordinator to cancel reports at any status except verified or cancelled. |
| **PD-W4** | On report cancellation, all active assignments (`assigned`, `in_progress`, `on_hold`) are marked `cancelled` atomically. | `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, `RLS_POLICY_PROPOSAL.md`, `OPEN_DECISIONS.md` | **CONSISTENT** | Active assignments defined; transaction boundary documented; non-active (`completed`, `reassigned`, `cancelled`, `declined`) untouched. |

---

## 4. Critical Findings

### Finding 1: Database Check Constraint vs. Empty/Whitespace Decline Reason (OD-NEW-3)
- **Observation:** The documented database check constraint is:
  ```sql
  CHECK (status != 'declined' OR decline_reason IS NOT NULL)
  ```
- **Analysis:** In PostgreSQL, the condition `decline_reason IS NOT NULL` evaluates to `TRUE` for an empty string `''` and for whitespace strings like `'   '`. Consequently, the database constraint alone acts purely as a null guard; it does **not** prevent a user or client from inserting or updating a decline reason to an empty string or whitespace.
- **Current Safeguard:** The documentation states that "Application enforces non-empty string". This creates a discrepancy between the stated requirement ("required and non-empty") and what the database constraint actually enforces.
- **Audit Action Taken:** Reconciled documentation in `SCHEMA_PROPOSAL.md`, `DATA_DICTIONARY.md`, and `OPEN_DECISIONS.md` to explicitly state that the database constraint is a null guard and that whitespace rejection is application-tier. Recorded formal recommendation **OD-REC-1** for owner approval to strengthen the constraint to:
  ```sql
  CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))
  ```

### Finding 2: Phantom Database Column Reference `storage_cleanup_completed` (OD-NEW-2)
- **Observation:** `OPEN_DECISIONS.md` (OD-NEW-2, Step 5) historically stated:
  `A background retry job queries report_attachments WHERE deleted_at IS NOT NULL AND storage_cleanup_completed IS NULL (or equivalent application-level tracking) and retries the Storage deletion.`
- **Analysis:** Neither `SCHEMA_PROPOSAL.md` nor `DATA_DICTIONARY.md` includes a `storage_cleanup_completed` column on `report_attachments`. Introducing an undocumented column would create a schema contradiction; conversely, omitting tracking details leaves the retry mechanism ambiguous.
- **Audit Action Taken:** Reconciled `OPEN_DECISIONS.md`, `SCHEMA_PROPOSAL.md`, and `DATA_DICTIONARY.md` to clarify that `storage_cleanup_completed` is **not** a database column. Retry state must be tracked at the application/worker queue tier (e.g., job payload or queue table), preserving schema purity.

### Finding 3: Missing Supabase Storage Bucket Access Controls (OD-NEW-2 / PD-D2)
- **Observation:** `RLS_POLICY_PROPOSAL.md` exclusively specifies policies for public schema tables (`report_attachments` metadata only). It does not define policies for `storage.objects`.
- **Analysis:** In Supabase, database RLS protects metadata rows, but actual file binaries reside in Supabase Storage. If Storage bucket policies are unconfigured or public:
  1. Soft-deleted attachments (whose database records are hidden from students and technicians) might still be accessible via direct storage URL.
  2. Users might download files for reports they are not authorized to view.
- **Audit Action Taken:** Added a dedicated security section and unresolved item in `RLS_POLICY_PROPOSAL.md`. Recorded formal recommendation **OD-REC-3** requiring Supabase Storage bucket RLS policies to be designed and applied prior to Phase 4 storage integration.

### Finding 4: Asymmetric Read Permissions on `report_comments` for Oversight Roles
- **Observation:** In `RLS_POLICY_PROPOSAL.md` (line 312), the permission matrix specifies `SELECT` on `report_comments` as `DENY` for `administrator` and `management`. In contrast, on all other report-related tables (`reports`, `report_attachments`, `report_status_history`, `assignments`, `work_logs`, `verifications`), administrator and management have `ALLOW`.
- **Analysis:** In `ROLES.md`, School Management is granted "Read-only access to reports and data" and School Administrator has "View all reports for administrative purposes". Completely denying comment read access to these oversight roles contradicts their general visibility mandate, unless comments were deliberately intended to be a private channel between reporter, coordinator, and technician.
- **Audit Action Taken:** Clarified the note under `report_comments` in `RLS_POLICY_PROPOSAL.md` and recorded formal recommendation **OD-REC-2** for owner confirmation.

### Finding 5: Explicit Specification of Child Table SELECT Predicates for Technicians
- **Observation:** In `RLS_POLICY_PROPOSAL.md`, `reports` SELECT explicitly names `can_view_report()`, whereas child tables (`report_attachments`, `report_status_history`, `report_comments`, `verifications`) used shorthand notation (`ASSIGNED REPORTS`).
- **Analysis:** If a child table policy were naively written as `assignments.technician_id = auth.uid()` without checking `status != 'declined'`, a technician with only a declined assignment would be blocked from viewing the report but could inadvertently read attachments, status history, or comments.
- **Audit Action Taken:** Clarified in the `RLS_POLICY_PROPOSAL.md` legend that `ASSIGNED` on child tables evaluates `can_view_report(report_id)`, ensuring the `status != 'declined'` exclusion is applied uniformly across the entire report hierarchy.

### Finding 6: Attachment Soft Deletion Precondition Scope
- **Observation:** The soft-delete RPC validates `get_user_role() = 'coordinator'` and `deleted_at IS NULL`. It does not evaluate whether the parent report is in a terminal state (`verified` or `cancelled`).
- **Analysis:** If an attachment was uploaded to a report that is later closed or cancelled, allowing a coordinator to delete attachments might alter closed audit records.
- **Audit Action Taken:** Documented this boundary condition. Coordinators possess administrative oversight to remove inappropriate attachments at any time, but report-status validation in the RPC is noted for implementation consideration.

---

## 5. Recommended Changes

The recommended changes are strictly categorized into **documentation-only corrections** (applied in Phase 3E) and **recommendations requiring owner approval** (awaiting decision).

### A. Documentation-Only Corrections Applied in Phase 3E
1. **`SCHEMA_PROPOSAL.md`**:
   - Clarified that Storage cleanup retry tracking is managed at the application/worker tier; no database column exists.
   - Clarified that the SQL check constraint on `decline_reason` enforces `IS NOT NULL` at the database level, while empty/whitespace rejection is handled by application validation.
   - Updated open implementation items and footer audit metadata.
2. **`DATA_DICTIONARY.md`**:
   - Updated `report_attachments` Key Notes to confirm application-managed Storage cleanup retry.
   - Updated `assignments.decline_reason` description to clarify the database null guard vs. application non-empty enforcement.
3. **`RLS_POLICY_PROPOSAL.md`**:
   - Clarified the `ASSIGNED` legend entry: child table SELECT policies evaluate `can_view_report(report_id)`.
   - Added explanatory note under `report_comments` regarding administrator and management `DENY` status.
   - Added `Administrator/Management comment visibility` and `Supabase Storage bucket RLS` to Unresolved RLS Questions.
   - Added security note section: `### Supabase Storage Bucket Access Control Gap`.
   - Updated footer audit metadata.
4. **`OPEN_DECISIONS.md`**:
   - Reconciled OD-NEW-2 Storage retry description (removed phantom column reference).
   - Reconciled OD-NEW-3 constraint description (clarified DB null guard vs. application non-empty validation).
   - Added `OD-REC-1`, `OD-REC-2`, and `OD-REC-3` to the Consolidated Decision Register and detailed recommendations section.
   - Updated migration-blocking status and footer audit metadata.

### B. Recommendations Requiring Owner Approval (Not Applied to Baseline)
1. **OD-REC-1 — Strengthen `decline_reason` Check Constraint at Database Level:**
   - *Proposal:* Amend the check constraint to `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))`.
   - *Rationale:* Enforces rejection of empty strings and whitespace-only reasons directly in PostgreSQL for defense-in-depth.
2. **OD-REC-2 — Clarify School Administrator and Management Comment Read Access:**
   - *Proposal:* Decide whether administrator and management roles should be granted `SELECT` permission on `report_comments` (aligning with general report oversight) or remain `DENY` (restricting comments to active operational participants).
3. **OD-REC-3 — Supabase Storage Bucket Access Control Specification:**
   - *Proposal:* Formally authorize the creation of Supabase Storage bucket RLS policies (`storage.objects`) before Phase 4 storage integration.

---

## 6. Remaining Open Decisions

All remaining open or recommended items are preserved with their exact prior status. None of these items block core database schema or RLS migration preparation:

| ID | Title | Current Status | Impact on Migration Preparation |
|---|---|---|---|
| **PD-D1** | Location Table Structure | RECOMMENDED | Single `locations` table approved; hierarchical expansion deferred. Does not block migration. |
| **PD-D6** | Notification Creation Method | RECOMMENDED | Application-level notification creation recommended. Does not block migration. |
| **PD-D7** | `confirmed_priority` Nullable | RECOMMENDED | Nullable column in schema; populated during coordinator review. Does not block migration. |
| **PD-D8** | Hard User Deletion Policy | OPEN | Soft deactivation (`is_active = false`) adopted for MVP. Does not block migration. |
| **PD-D9** | Timestamps on `categories` | RECOMMENDED | `categories` table without timestamps approved. Does not block migration. |
| **PD-D10** | Uniqueness Constraint on `locations` | RECOMMENDED | Uniqueness across (building, floor, room) recommended. Does not block migration. |
| **PD-S1** | API Rate Limiting Strategy | OPEN | Application/gateway layer concern. Does not block migration. |
| **PD-S2** | Session Timeout Duration | OPEN | Supabase Auth configuration. Does not block migration. |
| **PD-S3** | Password Policy Requirements | OPEN | Supabase Auth configuration. Does not block migration. |
| **PD-S4** | CORS Configuration | OPEN | Supabase project configuration. Does not block migration. |
| **PD-W5** | Maximum Reopening Count | OPEN | Business rule; column is unconstrained in database. Does not block migration. |
| **PD-W6** | `under_review` Always Required | RECOMMENDED | Workflow allows direct triage or review. Both paths supported by schema. Does not block migration. |
| **OD-REC-1**| Strengthen `decline_reason` Constraint | RECOMMENDATION | Proposed constraint hardening. Awaiting owner decision. |
| **OD-REC-2**| Oversight Comment Read Access | RECOMMENDATION | Clarification of comment SELECT for admin/management. Awaiting owner decision. |
| **OD-REC-3**| Storage Bucket RLS Specification | RECOMMENDATION | Storage bucket access control design. Awaiting owner decision. |

---

## 7. Migration Readiness Verdict

### **VERDICT: READY AFTER DOCUMENTATION FIXES**

### Justification:
1. **Core Database Schema is 100% Finalized:** All 12 tables, 5 enums, 16 foreign keys, cascade rules, and trigger specifications are completely defined and reconciled across `SCHEMA_PROPOSAL.md` and `DATA_DICTIONARY.md`.
2. **All Core Decisions are Owner-Approved:** Every owner decision required to define tables, enums, constraints, and RLS policies (Phases 3B, 3C, and 3D) has been approved and properly incorporated.
3. **Documentation Discrepancies Resolved:** The inconsistencies identified during the audit (the distinction between DB null guard and application non-empty validation, the storage cleanup column reference, and child table predicate specificity) have been corrected and reconciled across all four primary design documents.
4. **No Unresolved Migration Blockers:** The remaining open items (PD-D1 through PD-W6) and audit recommendations (OD-REC-1 through OD-REC-3) pertain to application-tier logic, auth configuration, or future defense-in-depth hardening. None prevent the accurate generation of PostgreSQL migration scripts.
5. **Next Step:** Await explicit owner authorization before creating migration SQL scripts.

---

## 8. Change Log

| File Modified | Nature of Change | Lines/Sections Affected |
|---|---|---|
| `docs/database-design/SCHEMA_PROPOSAL.md` | Documentation clarification | `### report_attachments`: Clarified Storage retry tracking is application-level (no DB column).<br>`### assignments`: Clarified `decline_reason` CHECK constraint is null-guard with application non-empty enforcement.<br>`## Open Items`: Added recommendation on `decline_reason` constraint; updated footer audit metadata. |
| `docs/database-design/DATA_DICTIONARY.md` | Documentation clarification | `## Table: report_attachments`: Clarified application-managed Storage cleanup retry in Key Notes.<br>`## Table: assignments`: Clarified `decline_reason` database constraint vs. application non-empty validation. |
| `docs/database-design/RLS_POLICY_PROPOSAL.md` | Documentation clarification | `## Permission Matrices`: Clarified `ASSIGNED` evaluates `can_view_report()` on child tables.<br>`### report_comments`: Noted administrator/management `DENY` status.<br>`## Unresolved RLS Questions`: Added comment visibility and Storage bucket RLS.<br>`## Security Notes`: Added `### Supabase Storage Bucket Access Control Gap`; updated footer audit metadata. |
| `docs/database-design/OPEN_DECISIONS.md` | Documentation clarification | `OD-NEW-2`: Removed phantom `storage_cleanup_completed` column reference from retry procedure.<br>`OD-NEW-3`: Clarified `decline_reason` database null guard vs. application validation.<br>`Decision Register`: Added `OD-REC-1`, `OD-REC-2`, `OD-REC-3`.<br>`End of Document`: Added detailed Phase 3E recommendations section; updated footer audit metadata. |
| `docs/database-design/PHASE_3E_FINAL_AUDIT.md` | New document created | Created complete Phase 3E consistency audit document covering all 8 required audit sections. |

---

*Phase 3E consistency audit completed on 2026-10-18.*  
*Awaiting explicit owner authorization before creating migration SQL.*
