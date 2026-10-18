# CMIRS Phase 4A — Migration Implementation Plan

> **Document:** `docs/database-design/PHASE_4A_MIGRATION_PLAN.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 4A — Migration SQL Generation (No Execution)  
> **Status:** APPROVED IMPLEMENTATION PLAN  

---

## 1. Migration Directory Specification

- **Existing Migration Directory Status:** None established. The repository does not currently contain a `supabase/` or `migrations/` directory.
- **Proposed Migration Directory:** `supabase/migrations/` (located at `d:\CMIRS-System\my-app\supabase\migrations/`).
- **Rationale:** Standard Supabase CLI architecture expects migration files in `<project-root>/supabase/migrations/` named with chronological UTC timestamp prefixes (`YYYYMMDDHHMMSS_<name>.sql`). This ensures seamless compatibility with `supabase migration up`, Supabase GitHub Actions, and local development CLI workflows.

---

## 2. Ordered Migration Files Catalog

The migration is divided into six logical, dependency-ordered SQL files:

| # | Migration Filename | Primary Responsibility |
|---|---|---|
| 1 | `20261018000001_core_schema.sql` | PostgreSQL extensions, custom enums, sequences, 12 tables, primary keys, foreign keys, and column constraints. |
| 2 | `20261018000002_performance_indexes.sql` | Performance and foreign key indexes, specifically optimizing RLS join predicates and query access paths. |
| 3 | `20261018000003_triggers.sql` | Automated triggers: updated_at (T1), report_number sequence (T2), status history audit (T3), profile creation on auth signup (T4), and parent row-locking concurrency guard on active attachments (T5). |
| 4 | `20261018000004_security_functions_and_rpc.sql` | `SECURITY DEFINER` security helper functions (`get_user_role`, `can_view_report`), attachment soft-delete RPC (`soft_delete_attachment`), and assignment decline RPC (`decline_assignment`). |
| 5 | `20261018000005_table_rls_policies.sql` | Enabling Row Level Security across all 12 tables and applying granular, role-based policies (SELECT, INSERT, UPDATE, DELETE). |
| 6 | `20261018000006_storage_setup.sql` | Creating the private `report-attachments` Supabase Storage bucket and establishing `storage.objects` RLS policies with regex path validation. |

---

## 3. Detailed Object Inventory and Migration Mapping

### Migration 1: `20261018000001_core_schema.sql`
- **Extensions:**
  - `pgcrypto` (or `uuid-ossp`) for `gen_random_uuid()`
- **Enums (5):**
  - `user_role`: `('student_personnel', 'coordinator', 'technician', 'administrator', 'management')`
  - `report_status`: `('submitted', 'under_review', 'assigned', 'in_progress', 'on_hold', 'completed', 'verified', 'reopened', 'cancelled')`
  - `priority_level`: `('low', 'medium', 'high', 'critical')`
  - `assignment_status`: `('assigned', 'in_progress', 'on_hold', 'completed', 'reassigned', 'cancelled', 'declined')`
  - `notification_type`: `('report_submitted', 'report_assigned', 'status_changed', 'priority_changed', 'comment_added', 'verification_required', 'verification_complete', 'verification_failed', 'report_reassigned', 'report_cancelled')`
- **Sequence (1):**
  - `report_number_seq`: Concurrency-safe integer sequence starting at 1 for `RPT-000001` format (PD-D4).
- **Tables (12) with Constraints:**
  1. `profiles`: PK `id` -> `auth.users(id)` ON DELETE CASCADE, default role `student_personnel`.
  2. `role_change_audit`: PK `id`, FKs to `profiles(id)` RESTRICT, `CHECK (old_role <> new_role)` (OD-NEW-1).
  3. `categories`: PK `id`, `name` UNIQUE, `is_active` BOOLEAN default true.
  4. `locations`: PK `id`, `building_name`, `floor`, `room`, `is_active` BOOLEAN default true.
  5. `reports`: PK `id`, `report_number` UNIQUE, FKs to `categories`, `locations`, `profiles(reporter_id)` RESTRICT, status default `submitted`, `is_urgent_hazard` default false, `confirmed_priority` nullable.
  6. `assignments`: PK `id`, FK to `reports` ON DELETE CASCADE, FKs to `profiles` RESTRICT, `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))` (OD-REC-1, OD-NEW-3).
  7. `report_attachments`: PK `id`, FK to `reports` CASCADE, FKs to `profiles` RESTRICT, `CHECK (file_size > 0 AND file_size <= 10485760)`, `CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'))` (PD-D5), soft-delete columns `deleted_at` and `deleted_by` (OD-NEW-2).
  8. `report_status_history`: PK `id`, FK to `reports` CASCADE, FK to `profiles` RESTRICT, append-only history.
  9. `report_comments`: PK `id`, FK to `reports` CASCADE, FK to `profiles` RESTRICT, immutable (no `updated_at`, PD-D3).
  10. `work_logs`: PK `id`, FK to `assignments` CASCADE, FK to `profiles` RESTRICT, `hours_spent DECIMAL(5,2)`.
  11. `verifications`: PK `id`, FK to `reports` CASCADE, FK to `profiles` RESTRICT, per-attempt records (D2, PD-R4).
  12. `notifications`: PK `id`, FK to `profiles` CASCADE, FK to `reports` ON DELETE SET NULL, `is_read` boolean.

### Migration 2: `20261018000002_performance_indexes.sql`
- **Foreign Key & Lookup Indexes:**
  - `idx_profiles_role` on `profiles(role)`
  - `idx_reports_category_id` on `reports(category_id)`
  - `idx_reports_location_id` on `reports(location_id)`
  - `idx_reports_reporter_id` on `reports(reporter_id)`
  - `idx_reports_status` on `reports(status)`
  - `idx_reports_reporter_status` on `reports(reporter_id, status)` (for reporter RLS policies)
  - `idx_assignments_report_id` on `assignments(report_id)`
  - `idx_assignments_technician_id` on `assignments(technician_id)`
  - `idx_assignments_status` on `assignments(status)`
  - `idx_assignments_lookup` on `assignments(report_id, technician_id, status)` (critical for `can_view_report()` evaluation)
  - `idx_report_attachments_report_id` on `report_attachments(report_id)`
  - `idx_report_attachments_file_path` on `report_attachments(file_path)` (critical for Storage RLS SELECT)
  - `idx_report_attachments_active` on `report_attachments(report_id, deleted_at)` (for active attachment count)
  - `idx_report_status_history_report_id` on `report_status_history(report_id)`
  - `idx_report_comments_report_id` on `report_comments(report_id)`
  - `idx_work_logs_assignment_id` on `work_logs(assignment_id)`
  - `idx_work_logs_technician_id` on `work_logs(technician_id)`
  - `idx_verifications_report_id` on `verifications(report_id)`
  - `idx_notifications_recipient_id` on `notifications(recipient_id)`
  - `idx_notifications_recipient_unread` on `notifications(recipient_id, is_read)`
  - `idx_role_change_audit_user_id` on `role_change_audit(user_id)`

### Migration 3: `20261018000003_triggers.sql`
- **Trigger Functions:**
  - `set_updated_at()`: `SECURITY DEFINER`, pinned search path, updates `updated_at = now()`.
  - `generate_report_number()`: `SECURITY DEFINER`, pinned search path, formats `'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0')`.
  - `record_status_history()`: `SECURITY DEFINER`, pinned search path, safety-net insert into `report_status_history` on status change.
  - `handle_new_user()`: `SECURITY DEFINER`, pinned search path, creates `profiles` record on `auth.users` insert.
  - `lock_attachment_count()`: `SECURITY DEFINER`, pinned search path, locks parent `reports` row (`FOR UPDATE`) and validates active count `< 5` before insert (Finding 2).
- **Triggers:**
  - `trg_profiles_updated_at` on `profiles` (BEFORE UPDATE)
  - `trg_reports_updated_at` on `reports` (BEFORE UPDATE)
  - `trg_reports_report_number` on `reports` (BEFORE INSERT)
  - `trg_reports_status_history` on `reports` (AFTER UPDATE OF status)
  - `trg_on_auth_user_created` on `auth.users` (AFTER INSERT)
  - `trg_lock_attachment_count` on `report_attachments` (BEFORE INSERT)

### Migration 4: `20261018000004_security_functions_and_rpc.sql`
- **Functions:**
  - `get_user_role()`: `SECURITY DEFINER`, `STABLE`, pinned search path (`public, auth, pg_temp`). Returns caller's `user_role` from `profiles`. Revoked from `PUBLIC`, granted to `authenticated`.
  - `can_view_report(report_id UUID)`: `SECURITY DEFINER`, `STABLE`, pinned search path. Implements the 3-part visibility predicate (reporter, qualifying technician with `status != 'declined'`, oversight roles). Revoked from `PUBLIC`, granted to `authenticated`.
  - `soft_delete_attachment(attachment_id UUID)`: `SECURITY DEFINER`, pinned search path. Validates caller is coordinator, verifies active status (`deleted_at IS NULL`), sets `deleted_at = now()` and `deleted_by = auth.uid()`. Revoked from `PUBLIC`, granted to `authenticated`.
  - `decline_assignment(target_assignment_id UUID, reason TEXT)`: `SECURITY DEFINER`, pinned search path. Validates caller is technician, ensures `reason` is non-empty (`btrim`), checks current status is `assigned`, updates to `declined`. Revoked from `PUBLIC`, granted to `authenticated`.

### Migration 5: `20261018000005_table_rls_policies.sql`
- **Enable RLS on all 12 tables:** `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;`
- **Policies:**
  - `profiles`: SELECT own / oversight; UPDATE own (restricted cols) / admin (roles); INSERT / DELETE DENY.
  - `role_change_audit`: SELECT admin / management; INSERT admin; UPDATE / DELETE DENY.
  - `categories`: SELECT active (all) / inactive (coordinators, admins); INSERT / UPDATE coordinator / admin; DELETE DENY.
  - `locations`: SELECT active (all) / inactive (coordinators, admins); INSERT / UPDATE coordinator / admin; DELETE DENY.
  - `reports`: SELECT via `can_view_report()`; INSERT all 5 roles (PD-R6); UPDATE coordinator (non-terminal), reporter (cancellation at submitted/under_review, PD-W2), technician (on_hold/in_progress, PD-W1); DELETE DENY.
  - `assignments`: SELECT technician (own) / oversight; INSERT coordinator; UPDATE coordinator / technician (constrained transitions + decline); DELETE DENY.
  - `report_attachments`: SELECT active via `can_view_report()` / soft-deleted (oversight only); INSERT authorized parties (limit 5); UPDATE / DELETE DENY (soft-delete via RPC).
  - `report_status_history`: SELECT via `can_view_report()`; INSERT authorized parties; UPDATE / DELETE DENY.
  - `report_comments`: SELECT via `can_view_report()` (OD-REC-2); INSERT reporter / assigned tech / coordinator; UPDATE / DELETE DENY (PD-D3 immutable).
  - `work_logs`: SELECT technician (own) / oversight; INSERT technician (own active assignments); UPDATE / DELETE DENY.
  - `verifications`: SELECT via `can_view_report()`; INSERT coordinator only (status completed, not self-repair D2, not self-report PD-R4); UPDATE / DELETE DENY.
  - `notifications`: SELECT own; UPDATE own (`is_read`); INSERT (service/trigger); DELETE DENY.

### Migration 6: `20261018000006_storage_setup.sql`
- **Bucket Creation:**
  - Insert private bucket `report-attachments` into `storage.buckets` (`public = false`, `file_size_limit = 10485760`, `allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']`).
- **`storage.objects` Policies:**
  - SELECT: download active attachments for reporters (`deleted_at IS NULL`), qualifying technicians (`can_view_report()`), and all attachments for coordinators/administrators/management.
  - INSERT: upload with regex path validation `name ~ '^reports/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]+$'` (Finding 1), authorized role/status check, and active count check `< 5`.
  - UPDATE: DENY for all roles (PD-D2 immutable).
  - DELETE: DENY for all authenticated roles (service_role cleanup only).

---

## 4. Dependencies Graph Between Objects

```
Extensions (pgcrypto)
    │
    ▼
Custom Enums (user_role, report_status, priority_level, assignment_status, notification_type)
    │
    ▼
Sequences (report_number_seq)
    │
    ▼
Base Tables (profiles, categories, locations)
    │
    ├──► Trigger Functions (set_updated_at, handle_new_user)
    │
    ▼
Helper Function (get_user_role)
    │
    ▼
Core Tables (role_change_audit, reports)
    │
    ├──► Trigger Function (generate_report_number via report_number_seq)
    │
    ▼
Assignment Table (assignments with btrim decline_reason constraint)
    │
    ▼
Helper Function (can_view_report using get_user_role, reports, assignments)
    │
    ▼
Child Tables:
    ├── report_attachments (with chk_file_size, chk_mime_type, deleted_at, deleted_by)
    ├── report_status_history
    ├── report_comments (immutable, no updated_at)
    ├── work_logs
    ├── verifications
    └── notifications
    │
    ├──► Trigger Function (record_status_history)
    ├──► Trigger Function (lock_attachment_count via reports FOR UPDATE)
    │
    ▼
Performance Indexes (idx_assignments_lookup, idx_report_attachments_file_path, etc.)
    │
    ▼
RPC Functions (soft_delete_attachment, decline_assignment)
    │
    ▼
Enable Table RLS & Create Table Policies (using get_user_role, can_view_report)
    │
    ▼
Supabase Storage Bucket & storage.objects RLS Policies (using path regex, can_view_report)
```

---

## 5. Security Requirements Implementation Matrix

| Security Requirement | Implementation Location | Technical Mechanism |
|---|---|---|
| **Search Path Hijacking Protection** | Migration 3, 4 | All `SECURITY DEFINER` functions specify `SET search_path = public, auth, pg_temp;`. |
| **Least Privilege RPC Access** | Migration 4 | Default `PUBLIC` execution privileges revoked via `REVOKE ALL ON FUNCTION ... FROM PUBLIC;`. Granted strictly to `authenticated`. Internal role checks prevent privilege escalation. |
| **Self-Verification Prohibition** | Migration 5 (`verifications`) | INSERT policy enforces `r.reporter_id != auth.uid()` (PD-R4) and `a.technician_id != auth.uid()` (D2). |
| **Comment Immutability** | Migration 1, 5 (`report_comments`) | `updated_at` column excluded. T1 trigger omitted. UPDATE and DELETE policies DENY all roles (PD-D3). |
| **Attachment Metadata Immutability** | Migration 1, 4, 5 (`report_attachments`) | Direct UPDATE is DENY for all roles. Soft deletion executed exclusively via coordinator `SECURITY DEFINER` RPC setting only `deleted_at` and `deleted_by` (PD-D2, OD-NEW-2). |
| **Attachment Concurrency Protection** | Migration 3 (T5 trigger) | `BEFORE INSERT` trigger on `report_attachments` executes `PERFORM 1 FROM reports WHERE id = NEW.report_id FOR UPDATE;` and enforces active count `< 5` (Finding 2). |
| **Storage Path Traversal & UUID Malformation** | Migration 6 (`storage.objects`) | INSERT policy requires `name ~ '^reports/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]+$'` prior to casting segments to UUID (Finding 1). |
| **Storage Hard Deletion Denied** | Migration 6 (`storage.objects`) | Direct client DELETE on `storage.objects` is DENY. Physical deletion restricted to backend worker under `service_role`. |
| **Declined Assignment Exclusion** | Migration 4, 5, 6 | `can_view_report()` filters `status != 'declined'`. Declined technicians cannot view reports or download attachments (OD-NEW-4). |
| **Decline Reason Non-Empty Guard** | Migration 1 (`assignments`) | Database CHECK constraint `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))` (OD-REC-1). |
| **All Roles Report Submission** | Migration 5 (`reports`) | Reports INSERT policy allows any authenticated user setting `reporter_id = auth.uid()` (PD-R6). |

---

## 6. Requirements Requiring Further Decisions

No requirement blocks the generation of this migration SQL baseline. As audited in Phase 3G:
- **PD-D1** (Single `locations` table): Approved in baseline schema.
- **PD-D6** (Notification creation method): Supported by schema.
- **PD-D7** (`confirmed_priority` nullable): Supported by schema.
- **PD-D8** (Soft-deactivation of users): Fully supported by `is_active` on `profiles`.
- **PD-D9** (Timestamps on categories): Omitted per approved baseline.
- **PD-D10** (Location uniqueness): Deferrable to data seeding.
- **PD-W5** (Reopening limit): Enforced at application layer.
- **PD-W6** (`under_review` workflow): Fully supported by status transitions.

All 19 approved owner decisions are fully integrated into the migration SQL specifications.
