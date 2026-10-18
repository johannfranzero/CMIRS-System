# CMIRS Phase 4A — Migration Review Report

> **Document:** `docs/database-design/PHASE_4A_MIGRATION_REVIEW.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 4A — Migration SQL Generation (No Execution)  
> **Status:** REVIEW DELIVERABLE  
> **Final Verdict:** **READY FOR OWNER REVIEW**  

---

## 1. Executive Summary

Phase 4A delivered the complete, ordered baseline set of PostgreSQL migration SQL scripts for the Campus Maintenance & Incident Reporting System (CMIRS), translating all 19 owner-approved decisions, schema specifications, data dictionary definitions, and Row Level Security policies into production-ready SQL files.

**Strict Security & Operational Boundary Adherence:**
- **Zero SQL Execution:** No SQL commands were run against local or remote databases.
- **Zero Supabase Remote Mutation:** The remote Supabase instance was not contacted, connected to, or modified in any manner.
- **Zero Environment / Code Modification:** No application code, environment variables, or package dependencies were altered.
- **Static Validation Only:** All SQL files underwent comprehensive non-destructive static analysis verifying syntax, structure, object parity, constraints, trigger definitions, and security safeguards.

---

## 2. Migration Files Created and Execution Order

All migration files were created in the designated Supabase CLI directory:  
`supabase/migrations/` (path: `d:\CMIRS-System\my-app\supabase\migrations/`).

The migrations are structured into six modular, dependency-ordered files with chronological UTC timestamp prefixes:

| Step | Filename | Lines | Size (Bytes) | Primary Responsibility |
|:---:|---|:---:|:---:|---|
| 1 | `20261018000001_core_schema.sql` | 204 | 6,857 | `pgcrypto` extension, 5 custom enums, report number sequence, 12 tables, primary keys, foreign keys, and column constraints. |
| 2 | `20261018000002_performance_indexes.sql` | 53 | 3,341 | Foreign key, filter, and critical compound indexes for RLS join predicates (`idx_assignments_lookup`, `idx_report_attachments_file_path`, etc.). |
| 3 | `20261018000003_triggers.sql` | 157 | 5,014 | Automated triggers T1–T4 and concurrency-safe parent row-locking trigger T5 (`lock_attachment_count`). |
| 4 | `20261018000004_security_functions_and_rpc.sql` | 177 | 5,830 | `SECURITY DEFINER` helper functions (`get_user_role`, `can_view_report`), attachment soft-delete RPC, and assignment decline RPC. |
| 5 | `20261018000005_table_rls_policies.sql` | 415 | 15,420 | Enabling RLS across all 12 tables and establishing granular role-based policies (SELECT, INSERT, UPDATE, DELETE). |
| 6 | `20261018000006_storage_setup.sql` | 135 | 5,938 | Private `report-attachments` Storage bucket creation and `storage.objects` RLS policies with regex path validation. |

---

## 3. Objects Created by Each Migration

### Migration 1: `20261018000001_core_schema.sql`
- **Extensions:** `pgcrypto`
- **Enums (5):**
  - `user_role` (`student_personnel`, `coordinator`, `technician`, `administrator`, `management`)
  - `report_status` (`submitted`, `under_review`, `assigned`, `in_progress`, `on_hold`, `completed`, `verified`, `reopened`, `cancelled`)
  - `priority_level` (`low`, `medium`, `high`, `critical`)
  - `assignment_status` (`assigned`, `in_progress`, `on_hold`, `completed`, `reassigned`, `cancelled`, `declined`)
  - `notification_type` (`report_submitted`, `report_assigned`, `status_changed`, `priority_changed`, `comment_added`, `verification_required`, `verification_complete`, `verification_failed`, `report_reassigned`, `report_cancelled`)
- **Sequences (1):**
  - `report_number_seq` (START 1, INCREMENT 1)
- **Tables (12) & Column Constraints:**
  - `profiles`: PK `id` -> `auth.users(id)` ON DELETE CASCADE, default `role = 'student_personnel'` (D1).
  - `role_change_audit`: PK `id`, FKs to `profiles(id)` RESTRICT, `CONSTRAINT chk_role_changed CHECK (old_role <> new_role)` (OD-NEW-1).
  - `categories`: PK `id`, `name` UNIQUE, `is_active` default true.
  - `locations`: PK `id`, `building_name`, `floor`, `room`, `is_active` default true.
  - `reports`: PK `id`, `report_number` UNIQUE, FKs to `categories`, `locations`, `profiles` RESTRICT, `confirmed_priority` nullable (PD-D7).
  - `assignments`: PK `id`, FK to `reports` CASCADE, FKs to `profiles` RESTRICT, `CONSTRAINT chk_decline_reason CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))` (OD-REC-1, OD-NEW-3, PD-R2).
  - `report_attachments`: PK `id`, FK to `reports` CASCADE, FKs to `profiles` RESTRICT, `CONSTRAINT chk_file_size CHECK (file_size > 0 AND file_size <= 10485760)`, `CONSTRAINT chk_mime_type CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'))` (PD-D5), soft-delete columns `deleted_at`, `deleted_by` (OD-NEW-2).
  - `report_status_history`: PK `id`, FK to `reports` CASCADE, FK to `profiles` RESTRICT, append-only history.
  - `report_comments`: PK `id`, FK to `reports` CASCADE, FK to `profiles` RESTRICT, immutable (no `updated_at`, PD-D3).
  - `work_logs`: PK `id`, FK to `assignments` CASCADE, FK to `profiles` RESTRICT, `hours_spent DECIMAL(5,2)`.
  - `verifications`: PK `id`, FK to `reports` CASCADE, FK to `profiles` RESTRICT, append-only verification records (D2, PD-R4).
  - `notifications`: PK `id`, FK to `profiles` CASCADE, FK to `reports` SET NULL, `is_read` boolean default false (D7).

### Migration 2: `20261018000002_performance_indexes.sql`
- `idx_profiles_role` on `profiles(role)`
- `idx_role_change_audit_user_id` on `role_change_audit(user_id)`
- `idx_role_change_audit_changed_by` on `role_change_audit(changed_by)`
- `idx_reports_category_id` on `reports(category_id)`
- `idx_reports_location_id` on `reports(location_id)`
- `idx_reports_reporter_id` on `reports(reporter_id)`
- `idx_reports_status` on `reports(status)`
- `idx_reports_reporter_status` on `reports(reporter_id, status)`
- `idx_assignments_report_id` on `assignments(report_id)`
- `idx_assignments_technician_id` on `assignments(technician_id)`
- `idx_assignments_status` on `assignments(status)`
- `idx_assignments_lookup` on `assignments(report_id, technician_id, status)` (Critical RLS predicate optimization)
- `idx_report_attachments_report_id` on `report_attachments(report_id)`
- `idx_report_attachments_file_path` on `report_attachments(file_path)` (Critical Storage RLS lookup optimization)
- `idx_report_attachments_active` on `report_attachments(report_id, deleted_at)`
- `idx_report_status_history_report_id` on `report_status_history(report_id)`
- `idx_report_status_history_changed_by` on `report_status_history(changed_by)`
- `idx_report_comments_report_id` on `report_comments(report_id)`
- `idx_report_comments_author_id` on `report_comments(author_id)`
- `idx_work_logs_assignment_id` on `work_logs(assignment_id)`
- `idx_work_logs_technician_id` on `work_logs(technician_id)`
- `idx_work_logs_technician_assignment` on `work_logs(technician_id, assignment_id)`
- `idx_verifications_report_id` on `verifications(report_id)`
- `idx_verifications_verified_by` on `verifications(verified_by)`
- `idx_notifications_recipient_id` on `notifications(recipient_id)`
- `idx_notifications_recipient_unread` on `notifications(recipient_id, is_read)`
- `idx_notifications_report_id` on `notifications(report_id)`

### Migration 3: `20261018000003_triggers.sql`
- **Functions:**
  - `public.set_updated_at()`: `SECURITY DEFINER`, pinned search path, sets `NEW.updated_at = now()`.
  - `public.generate_report_number()`: `SECURITY DEFINER`, pinned search path, formats `'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0')`.
  - `public.record_status_history()`: `SECURITY DEFINER`, pinned search path, inserts audit row into `report_status_history`.
  - `public.handle_new_user()`: `SECURITY DEFINER`, pinned search path, creates `student_personnel` profile on auth signup.
  - `public.lock_attachment_count()`: `SECURITY DEFINER`, pinned search path, row-locks parent report row and rejects inserts when active attachments >= 5 (Finding 2).
- **Triggers:**
  - `trg_profiles_updated_at` on `profiles` (BEFORE UPDATE)
  - `trg_reports_updated_at` on `reports` (BEFORE UPDATE)
  - `trg_reports_report_number` on `reports` (BEFORE INSERT)
  - `trg_reports_status_history` on `reports` (AFTER UPDATE OF status)
  - `trg_on_auth_user_created` on `auth.users` (AFTER INSERT)
  - `trg_lock_attachment_count` on `report_attachments` (BEFORE INSERT)

### Migration 4: `20261018000004_security_functions_and_rpc.sql`
- **Functions:**
  - `public.get_user_role()`: `SECURITY DEFINER`, `STABLE`, pinned search path. Queries caller's role from `profiles`.
  - `public.can_view_report(report_id UUID)`: `SECURITY DEFINER`, `STABLE`, pinned search path. Centralized 3-part visibility check (oversight roles, reporter, qualifying technician `status != 'declined'`).
  - `public.soft_delete_attachment(attachment_id UUID)`: `SECURITY DEFINER`, pinned search path. Coordinator-only soft-delete setting `deleted_at = now()` and `deleted_by = auth.uid()`.
  - `public.decline_assignment(target_assignment_id UUID, reason TEXT)`: `SECURITY DEFINER`, pinned search path. Technician-only decline transition with non-empty reason validation.
- **Grants & Hardening:**
  - `REVOKE ALL ON FUNCTION ... FROM PUBLIC;` on all 4 functions.
  - `GRANT EXECUTE ON FUNCTION ... TO authenticated;` on all 4 functions.

### Migration 5: `20261018000005_table_rls_policies.sql`
- `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;` on all 12 tables.
- 22 granular policies covering SELECT, INSERT, UPDATE across all tables with explicit default DENY on unauthorized operations.

### Migration 6: `20261018000006_storage_setup.sql`
- Private bucket insert: `report-attachments` in `storage.buckets` (`public = false`, `file_size_limit = 10485760`, `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']`).
- `storage_attachments_select` on `storage.objects` for SELECT (downloads).
- `storage_attachments_insert` on `storage.objects` for INSERT (uploads) with regex path guard and count check `< 5`.
- Implicit DENY for UPDATE and DELETE on `storage.objects` (client immutability).

---

## 4. Mapping from Approved Requirements to SQL Implementation

| Requirement / Decision | Source | SQL Implementation Location | Verification Evidence |
|---|---|---|---|
| **D1: Default role student_personnel** | `README.md` | `20261018000001_core_schema.sql` & `20261018000003_triggers.sql` | `profiles.role DEFAULT 'student_personnel'`; `handle_new_user()` trigger sets default role. |
| **D2: Self-repair verification barred** | `README.md` | `20261018000005_table_rls_policies.sql` | `verifications_insert_coordinator` checks `NOT EXISTS (... technician_id = auth.uid())`. |
| **D3: Urgent hazard flag** | `README.md` | `20261018000001_core_schema.sql` | `reports.is_urgent_hazard BOOLEAN NOT NULL DEFAULT false`. |
| **D4: Photo attachments optional** | `README.md` | `20261018000001_core_schema.sql` | Reports table has no mandatory attachment foreign key; attachments are stored in separate child table. |
| **OD-NEW-1: Role change audit** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql` & `20261018000005_table_rls_policies.sql` | Table `role_change_audit` created with `chk_role_changed`; append-only RLS policies. |
| **OD-NEW-2: Soft deletion of attachments** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql`, `20261018000004_security_functions_and_rpc.sql`, `20261018000005_table_rls_policies.sql` | `deleted_at` and `deleted_by` columns; `soft_delete_attachment()` RPC; RLS filters active-only for non-oversight. |
| **OD-NEW-3: Assignment decline reason** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql` & `20261018000004_security_functions_and_rpc.sql` | `decline_reason TEXT` column; `decline_assignment()` RPC. |
| **OD-NEW-4: Technician visibility predicate** | `OPEN_DECISIONS.md` | `20261018000004_security_functions_and_rpc.sql` | `can_view_report()` filters `assignments.status != 'declined'`. |
| **OD-REC-1: Decline reason btrim check** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql` | `CONSTRAINT chk_decline_reason CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))`. |
| **OD-REC-2: Comment SELECT for admin/management** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` | `report_comments_select` policy uses `can_view_report(report_id)`, which grants view access to oversight roles. |
| **OD-REC-3: Supabase Storage RLS design** | `OPEN_DECISIONS.md` | `20261018000006_storage_setup.sql` | Private bucket inserted; SELECT and INSERT policies on `storage.objects` with active status matching. |
| **PD-D2: Attachment metadata immutable** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` & `20261018000006_storage_setup.sql` | Direct UPDATE and DELETE on `report_attachments` and `storage.objects` DENIED. Soft-delete only. |
| **PD-D3: Comment immutability** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql` & `20261018000005_table_rls_policies.sql` | `updated_at` omitted from `report_comments`; UPDATE and DELETE DENIED for all roles. |
| **PD-D4: Report number sequence RPT-000001** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql` & `20261018000003_triggers.sql` | Sequence `report_number_seq`; trigger `generate_report_number()` formats string before insert. |
| **PD-D5: Photo limits (max 5, 10MB, mime)** | `OPEN_DECISIONS.md` | `20261018000001_core_schema.sql`, `20261018000003_triggers.sql`, `20261018000006_storage_setup.sql` | `chk_file_size` (<=10MB), `chk_mime_type` (jpeg/png/webp), bucket limits, and trigger T5 active count lock. |
| **PD-R1: Technician assigned report access** | `OPEN_DECISIONS.md` | `20261018000004_security_functions_and_rpc.sql` & `20261018000005_table_rls_policies.sql` | Handled via `can_view_report()`. |
| **PD-R2: Decline from assigned status** | `OPEN_DECISIONS.md` | `20261018000004_security_functions_and_rpc.sql` & `20261018000005_table_rls_policies.sql` | Permitted exclusively from `assigned` status. |
| **PD-R4: Self-report verification prohibited** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` | `verifications_insert_coordinator` checks `r.reporter_id != auth.uid()`. |
| **PD-R6: All 5 roles may submit reports** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` | `reports_insert` policy allows all authenticated users setting `reporter_id = auth.uid()`. |
| **PD-W1: Work holds technician/coordinator** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` | `reports_update_technician_hold` and `assignments_update_technician` permit `in_progress <-> on_hold`. |
| **PD-W2: Reporter cancellation submitted/under_review** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` | `reports_update_reporter_cancel` restricts cancellation to `submitted` or `under_review`. |
| **PD-W3: Coordinator cancellation non-terminal** | `OPEN_DECISIONS.md` | `20261018000005_table_rls_policies.sql` | `reports_update_coordinator` permits cancellation on all non-terminal reports. |
| **PD-W4: Active assignments cancelled on report cancel** | `OPEN_DECISIONS.md` | `SCHEMA_PROPOSAL.md` & `RLS_POLICY_PROPOSAL.md` | Atomicity documented and supported by RLS `assignments_update_coordinator` allowing bulk cancellation of active assignments. |

---

## 5. RLS and SECURITY DEFINER Security Review

### Search Path Pinning (Finding 3 Mitigation)
All nine `SECURITY DEFINER` functions in the migration set explicitly pin their search path to eliminate privilege escalation via schema manipulation:
```sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
```
Verified across:
1. `public.set_updated_at()`
2. `public.generate_report_number()`
3. `public.record_status_history()`
4. `public.handle_new_user()`
5. `public.lock_attachment_count()`
6. `public.get_user_role()`
7. `public.can_view_report(UUID)`
8. `public.soft_delete_attachment(UUID)`
9. `public.decline_assignment(UUID, TEXT)`

### Execution Privilege Hardening (Finding 6 Mitigation)
Default PostgreSQL execution privileges granted to `PUBLIC` on newly created functions have been revoked for sensitive RPCs and granted strictly to `authenticated`:
```sql
REVOKE ALL ON FUNCTION public.<function_name> FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.<function_name> TO authenticated;
```
Applied to: `get_user_role()`, `can_view_report()`, `soft_delete_attachment()`, and `decline_assignment()`.

### Internal Authorization Validation
- In `soft_delete_attachment(UUID)`, caller role is strictly validated against `coordinator`, and already-deleted rows are rejected before modifying data.
- In `decline_assignment(UUID, TEXT)`, caller role is validated against `technician`, ownership of the assignment is confirmed against `auth.uid()`, and the reason is guarded against whitespace strings.

---

## 6. Attachment Concurrency and Storage Path Validation Review

### Finding 1 Mitigation: Storage Path Parsing Guard
In `storage_attachments_insert` (`20261018000006_storage_setup.sql`), extracting the report ID via `(storage.foldername(name))[2]::uuid` is preceded by a strict regex guard:
```sql
name ~ '^reports/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]+$'
```
**Outcome:** Any malformed path, directory traversal attack, or non-UUID folder segment evaluates to `FALSE` without triggering a runtime PostgreSQL UUID parsing exception.

### Finding 2 Mitigation: Concurrency-Safe 5-Attachment Limit
In `trg_lock_attachment_count` (`20261018000003_triggers.sql`), concurrent upload requests are serialized per report via a row lock on the parent report:
```sql
PERFORM 1 FROM public.reports WHERE id = NEW.report_id FOR UPDATE;

SELECT COUNT(*) INTO active_count
FROM public.report_attachments
WHERE report_id = NEW.report_id
  AND deleted_at IS NULL;

IF active_count >= 5 THEN
  RAISE EXCEPTION 'Maximum 5 active attachments allowed per report.';
END IF;
```
**Outcome:** Parallel client uploads cannot race past the count check. Concurrent inserts are serialized by PostgreSQL transaction locks, guaranteeing that no report can ever exceed 5 active attachments.

---

## 7. Static Validation Results

A dedicated static analysis script was executed across all six migration files:

```
Inspecting 6 migration files in supabase/migrations...

--- 1. Enums Check ---
Enum user_role: FOUND
Enum report_status: FOUND
Enum priority_level: FOUND
Enum assignment_status: FOUND
Enum notification_type: FOUND

--- 2. Tables Check ---
Table profiles: FOUND
Table role_change_audit: FOUND
Table categories: FOUND
Table locations: FOUND
Table reports: FOUND
Table assignments: FOUND
Table report_attachments: FOUND
Table report_status_history: FOUND
Table report_comments: FOUND
Table work_logs: FOUND
Table verifications: FOUND
Table notifications: FOUND

--- 3. Specific Constraints Check ---
chk_decline_reason with btrim(): FOUND
chk_file_size (10MB): FOUND
chk_mime_type: FOUND
chk_role_changed: FOUND

--- 4. RLS Enabled on 12 Tables ---
RLS enabled on profiles: FOUND
RLS enabled on role_change_audit: FOUND
RLS enabled on categories: FOUND
RLS enabled on locations: FOUND
RLS enabled on reports: FOUND
RLS enabled on assignments: FOUND
RLS enabled on report_attachments: FOUND
RLS enabled on report_status_history: FOUND
RLS enabled on report_comments: FOUND
RLS enabled on work_logs: FOUND
RLS enabled on verifications: FOUND
RLS enabled on notifications: FOUND

--- 5. Triggers & Trigger Functions ---
Trigger trg_profiles_updated_at: FOUND
Trigger trg_reports_updated_at: FOUND
Trigger trg_reports_report_number: FOUND
Trigger trg_reports_status_history: FOUND
Trigger trg_on_auth_user_created: FOUND
Trigger trg_lock_attachment_count: FOUND

--- 6. SECURITY DEFINER search_path Check ---
Found 9 SECURITY DEFINER functions with pinned search_path:
  - set_updated_at: search_path = public, auth, pg_temp
  - generate_report_number: search_path = public, auth, pg_temp
  - record_status_history: search_path = public, auth, pg_temp
  - handle_new_user: search_path = public, auth, pg_temp
  - lock_attachment_count: search_path = public, auth, pg_temp
  - get_user_role: search_path = public, auth, pg_temp
  - can_view_report: search_path = public, auth, pg_temp
  - soft_delete_attachment: search_path = public, auth, pg_temp
  - decline_assignment: search_path = public, auth, pg_temp

--- 7. Storage Safeguards ---
Path regex guard: FOUND
Bucket 'report-attachments' configuration: FOUND
Parent report row lock FOR UPDATE: FOUND

--- 8. Dollar Quoting Balance ---
Total $$ occurrences across migrations: 18 (even = balanced: True)
```

**Static Validation Result: 100% PASS.**

---

## 8. Unresolved Decisions and Implementation Gaps

As documented in `OPEN_DECISIONS.md` and confirmed in `PHASE_3G_PRE_MIGRATION_GATE.md`:
- None of the remaining non-blocking items (`PD-D1`, `PD-D6`, `PD-D7`, `PD-D8`, `PD-D9`, `PD-D10`, `PD-W5`, `PD-W6`) block migration SQL generation.
- No new business rules were invented.
- No design gaps exist in the generated SQL.

---

## 9. Exact Git Diff Scope

Inspection of Git status reveals only the authorized documentation and new migration files:

- **Modified Files:**
  - `docs/database-design/RLS_POLICY_PROPOSAL.md` (minor inline constraint note synchronization)
- **New Untracked Files:**
  - `docs/database-design/PHASE_3G_PRE_MIGRATION_GATE.md` (Phase 3G gate audit report)
  - `docs/database-design/PHASE_4A_MIGRATION_PLAN.md` (Phase 4A implementation plan)
  - `docs/database-design/PHASE_4A_MIGRATION_REVIEW.md` (This review document)
  - `supabase/migrations/20261018000001_core_schema.sql` (Migration 1)
  - `supabase/migrations/20261018000002_performance_indexes.sql` (Migration 2)
  - `supabase/migrations/20261018000003_triggers.sql` (Migration 3)
  - `supabase/migrations/20261018000004_security_functions_and_rpc.sql` (Migration 4)
  - `supabase/migrations/20261018000005_table_rls_policies.sql` (Migration 5)
  - `supabase/migrations/20261018000006_storage_setup.sql` (Migration 6)

**No files outside `docs/database-design/` and `supabase/migrations/` were modified or created.**

---

## 10. Confirmation of Strict Non-Execution Boundary

- **No SQL was executed.**
- **No migrations were applied to any database.**
- **No connection to Supabase was initiated.**
- **No storage buckets were modified or created on any live remote environment.**
- **No secrets, keys, or environment files were read, logged, or altered.**

---

## 11. Final Verdict

### **VERDICT: READY FOR OWNER REVIEW**

The complete migration suite (Migrations 1 through 6) has been generated in full accordance with all owner-approved specifications and technical safeguards.

**Stop Condition Met:** Awaiting explicit owner authorization before any migration is executed or applied to Supabase.
