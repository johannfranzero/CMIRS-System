# CMIRS Phase 5A — Post-Migration Test Plan and Verification Harness

> **Document:** `docs/database-design/PHASE_5A_TEST_PLAN.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 5A — Migration Execution Planning & Test Harness Preparation  
> **Role:** Lead QA & Database Security Engineer  
> **Status:** TEST PLAN DELIVERABLE (PLANNING ONLY)  
> **Execution Status:** **ALL TESTS NOT RUN — NO DATABASE EXECUTION AUTHORIZED**  

---

## 1. Executive Summary & Testing Framework

This test plan defines the complete verification test harness for validating the CMIRS PostgreSQL database schema, automated triggers, security functions, Row-Level Security (RLS) policies, and Supabase Storage rules following migration execution.

### Verification Principles
1. **Adversarial Security Validation:** Every positive workflow test is paired with negative boundary tests attempting unauthorized privilege escalation, cross-tenant data access, and parameter tampering.
2. **Zero-Execution Planning Constraint:** In compliance with Phase 5A boundaries, **all tests documented below are marked `NOT RUN`**. No test cases have been executed against any database or Supabase instance.
3. **Execution Environment Classification:** Each test explicitly states whether it can be run in a local disposable PostgreSQL container (via transaction-rollback scripts) or requires a fully provisioned Supabase environment (with GoTrue Auth and Storage services).

---

## 2. Test Suite 1: Schema & Migration Integrity

Validates that all tables, columns, constraints, sequences, custom enums, and indexes exist in exact compliance with `SCHEMA_PROPOSAL.md` and `DATA_DICTIONARY.md`.

| Test ID | Category / Target | Role / Runner | Preconditions | Action | Expected Outcome | Decision / Requirement | Environment Required | Status |
|---|---|---|---|---|---|---|---|:---:|
| **TEST-MIG-01** | Core Tables Catalog | `postgres` | Migrations 1–6 applied | Query `information_schema.tables` for schema `public` | Exactly 12 tables returned: `profiles`, `role_change_audit`, `categories`, `locations`, `reports`, `assignments`, `report_attachments`, `report_status_history`, `report_comments`, `work_logs`, `verifications`, `notifications`. | All approved tables created | Local or Supabase | `NOT RUN` |
| **TEST-MIG-02** | Custom Enums Integrity | `postgres` | Migrations 1–6 applied | Query `pg_enum` for all 5 custom types | Exactly 5 enums exist with exact approved labels and ordering: `user_role` (5 labels), `report_status` (9 labels), `priority_level` (4 labels), `assignment_status` (7 labels), `notification_type` (10 labels). | Data Dictionary enum specs | Local or Supabase | `NOT RUN` |
| **TEST-MIG-03** | Sequences & Formatting | `postgres` | Migrations 1–6 applied | Inspect `pg_sequences` | Sequence `public.report_number_seq` exists, start = 1, increment = 1, cycle = false. | Approved PD-D4 | Local or Supabase | `NOT RUN` |
| **TEST-MIG-04** | Performance Indexes | `postgres` | Migrations 1–6 applied | Query `pg_indexes` on schema `public` | All 24 dedicated performance, foreign key, and compound RLS join indexes exist. | Migration 2 spec | Local or Supabase | `NOT RUN` |
| **TEST-MIG-05** | Storage Bucket Setup | `postgres` | Migrations 1–6 applied | Query `storage.buckets` | Bucket `report-attachments` exists with `public = false`, `file_size_limit = 10485760`, and allowed MIME types `('image/jpeg', 'image/png', 'image/webp')`. | Approved OD-REC-3, PD-D5 | Supabase instance | `NOT RUN` |
| **TEST-MIG-06** | Migration Idempotency | `postgres` | Migrations 1–6 applied | Re-execute Migration 1 `DO $$` enum blocks and DDL statements | Scripts execute without throwing `type already exists` or `relation already exists` errors. | Remediation R6 | Local or Supabase | `NOT RUN` |

---

## 3. Test Suite 2: Authentication & Role Authorization

Validates GoTrue integration, automatic profile creation, role lookup freshness, and isolation across the 5 authenticated roles (`student_personnel`, `coordinator`, `technician`, `administrator`, `management`).

| Test ID | Category / Target | Role / Runner | Preconditions | Action | Expected Outcome | Decision / Requirement | Environment Required | Status |
|---|---|---|---|---|---|---|---|:---:|
| **TEST-AUTH-01** | Auth Trigger T4 | GoTrue / Service | Migrations 1–6 applied | Insert new record into `auth.users` with email and metadata | Trigger `trg_on_auth_user_created` fires and inserts into `public.profiles` with `role = 'student_personnel'`, `is_active = true`, matching email. | Approved D1 | Supabase instance | `NOT RUN` |
| **TEST-AUTH-02** | Role Freshness Lookup | `authenticated` | User profile exists | Update user's role from `student_personnel` to `coordinator` in `public.profiles`. Call `get_user_role()`. | Function returns `coordinator` immediately within subsequent transaction; no stale role caching occurs. | Remediation R8 | Local or Supabase | `NOT RUN` |
| **TEST-AUTH-03** | Role Change Audit Log | `administrator` | Admin profile authenticated | Update role on another user's profile | Admin logs entry in `public.role_change_audit`. Constraint `chk_role_changed` enforces `old_role <> new_role`. Direct non-admin insert denied by RLS. | Approved OD-NEW-1 | Local or Supabase | `NOT RUN` |
| **TEST-AUTH-04** | Unauthenticated Access | `anon` | No JWT provided | Attempt SELECT on `public.reports`, `public.profiles`, and `storage.objects` | Zero rows returned / Access Denied. Public access completely blocked. | Core RLS policy | Local or Supabase | `NOT RUN` |
| **TEST-AUTH-05** | Identity Spoofing Protection | `student_personnel` | Authenticated as User A | Attempt to insert a report with `reporter_id = User_B_UUID` | RLS check `reporter_id = auth.uid()` fails; insertion denied. | Remediation R2 | Local or Supabase | `NOT RUN` |
| **TEST-AUTH-06** | Profile Email Immutability | `student_personnel` | Authenticated as User A | Attempt to update `email` or `id` on own profile in `public.profiles` | RLS denies update or column guard prevents modification. | Approved RLS policy | Local or Supabase | `NOT RUN` |

---

## 4. Test Suite 3: Reports & Lifecycle Workflow

Validates report numbering, initial status constraints, self-verification barring, reporter and coordinator cancellation boundaries, and atomic assignment cancellation.

| Test ID | Category / Target | Role / Runner | Preconditions | Action | Expected Outcome | Decision / Requirement | Environment Required | Status |
|---|---|---|---|---|---|---|---|:---:|
| **TEST-RPT-01** | Initial Status Constraint | `student_personnel` | Authenticated user | Attempt to INSERT report with `status = 'verified'` or `status = 'in_progress'` | RLS policy `reports_insert` fails; error: row violates row-level security policy. | Remediation R2 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-02** | Initial Priority Constraint | `student_personnel` | Authenticated user | Attempt to INSERT report with `confirmed_priority = 'critical'` | RLS policy `reports_insert` fails; only `confirmed_priority IS NULL` permitted. | Remediation R2 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-03** | Unconditional Report Number | `student_personnel` | Authenticated user | INSERT report providing custom `report_number = 'RPT-999999'` | Trigger T2 unconditionally overwrites custom input with sequence value: `NEW.report_number := 'RPT-000001'`. | Remediation R4, PD-D4 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-04** | Report Number Immutability | `coordinator` | Existing report | Attempt UPDATE on `public.reports` modifying `report_number` | Trigger `trg_reports_immutable_cols` raises exception: `report_number is immutable and cannot be modified`. | Remediation R4 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-05** | Reporter ID Immutability | `administrator` | Existing report | Attempt UPDATE on `public.reports` modifying `reporter_id` | Trigger `trg_reports_immutable_cols` raises exception: `reporter_id is immutable and cannot be modified`. | Remediation R4 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-06** | Reporter Cancellation Boundary | `student_personnel` | Own report in `submitted` | UPDATE `reports` setting `status = 'cancelled'` | Update succeeds. | Approved PD-W2 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-07** | Reporter Cancellation Prohibited | `student_personnel` | Own report in `assigned` | UPDATE `reports` setting `status = 'cancelled'` | RLS policy `reports_update_reporter_cancel` denies update (allowed only in `submitted` or `under_review`). | Approved PD-W2 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-08** | Self-Verification Barring | `coordinator` | Coordinator authored report or performed repair work | Attempt to INSERT record into `public.verifications` for that report | Policy `verifications_insert_coordinator` fails check `r.reporter_id != auth.uid()` and technician check. | Approved D2, PD-R4 | Local or Supabase | `NOT RUN` |
| **TEST-RPT-09** | Coordinator Cancellation & Atomic Assignments | `coordinator` | Active report with 2 active assignments | Execute cancellation transaction: update report to `cancelled` and update active assignments to `cancelled` | Both report and active assignments transition to `cancelled` atomically. Assignment history preserved. | Approved PD-W3, PD-W4 | Local or Supabase | `NOT RUN` |

---

## 5. Test Suite 4: Assignments & Work Logs

Validates technician visibility boundaries, decline rules, protected assignment metadata, and work log authorization.

| Test ID | Category / Target | Role / Runner | Preconditions | Action | Expected Outcome | Decision / Requirement | Environment Required | Status |
|---|---|---|---|---|---|---|---|:---:|
| **TEST-ASG-01** | Technician Visibility | `technician` | Report with active assignment for Technician A | Authenticate as Technician A; execute `SELECT * FROM public.reports WHERE id = ...` | Report returned. `can_view_report()` evaluates to TRUE. | Approved PD-R1 | Local or Supabase | `NOT RUN` |
| **TEST-ASG-02** | Declined-Only Visibility Exclusion | `technician` | Report where Technician A's only assignment is `declined` | Authenticate as Technician A; query report | Zero rows returned. `can_view_report()` filters out `status = 'declined'`. Report invisible. | Approved OD-NEW-4 | Local or Supabase | `NOT RUN` |
| **TEST-ASG-03** | Decline from Assigned Status | `technician` | Assignment in `assigned` status | Call RPC `decline_assignment(id, 'Conflict with emergency task')` | Assignment status updated to `declined`, `decline_reason` recorded. | Approved PD-R2, OD-NEW-3 | Local or Supabase | `NOT RUN` |
| **TEST-ASG-04** | Decline from In-Progress Prohibited | `technician` | Assignment in `in_progress` status | Attempt direct UPDATE or call `decline_assignment()` to decline | Operation fails. Policy `assignments_update_technician_decline` requires `USING (status = 'assigned')`. RPC checks status. | Remediation R3, PD-R2 | Local or Supabase | `NOT RUN` |
| **TEST-ASG-05** | Empty Decline Reason Rejected | `technician` | Assignment in `assigned` status | Attempt UPDATE setting `status = 'declined'`, `decline_reason = '   '` (whitespace) | Database check constraint `chk_decline_reason` using `btrim()` fails; update rejected. | Approved OD-REC-1 | Local or Supabase | `NOT RUN` |
| **TEST-ASG-06** | Assignment Metadata Immutability | `technician` | Assigned task | Attempt UPDATE modifying `assigned_by`, `assigned_at`, or `notes` | Policy `assignments_update_technician_*` equality subqueries reject change. | Remediation R3 | Local or Supabase | `NOT RUN` |
| **TEST-ASG-07** | Work Log Creation Boundary | `technician` | Assignment in `declined` or `cancelled` status | Attempt to INSERT into `public.work_logs` | Policy `work_logs_insert_technician` fails; work logs allowed only on active assignments (`assigned`, `in_progress`, `on_hold`). | Approved RLS policy | Local or Supabase | `NOT RUN` |
| **TEST-ASG-08** | Work Hold State Transitions | `technician` | Assignment in `in_progress` status | UPDATE assignment to `on_hold`; UPDATE report to `on_hold` | Policies `assignments_update_technician_work` and `reports_update_technician_hold` permit transition. | Approved PD-W1 | Local or Supabase | `NOT RUN` |

---

## 6. Test Suite 5: Comments, Notifications & Audit History

Validates comment immutability, notification column privilege boundaries, and status-history trigger behavior.

| Test ID | Category / Target | Role / Runner | Preconditions | Action | Expected Outcome | Decision / Requirement | Environment Required | Status |
|---|---|---|---|---|---|---|---|:---:|
| **TEST-AUD-01** | Comment Immutability (UPDATE) | `student_personnel` | Authored comment | Attempt to UPDATE `content` in `public.report_comments` | RLS denies update; no UPDATE policy exists (PostgreSQL default deny). | Approved PD-D3 | Local or Supabase | `NOT RUN` |
| **TEST-AUD-02** | Comment Immutability (DELETE) | `coordinator` | Existing comment | Attempt to DELETE comment from `public.report_comments` | RLS denies deletion; no DELETE policy exists (default deny). | Approved PD-D3 | Local or Supabase | `NOT RUN` |
| **TEST-AUD-03** | Oversight Comment Read | `administrator` | Existing report comments | Execute SELECT on `public.report_comments` | Comments returned. Policy `report_comments_select` grants read access via `can_view_report()`. | Approved OD-REC-2 | Local or Supabase | `NOT RUN` |
| **TEST-AUD-04** | Notification Read-Only Update | `student_personnel` | Notification for User A | Execute UPDATE setting `is_read = true` | Update succeeds. | Remediation R5 | Local or Supabase | `NOT RUN` |
| **TEST-AUD-05** | Notification Tampering Prohibited | `student_personnel` | Notification for User A | Execute UPDATE setting `title = 'Spoofed'`, `is_read = true` | Database error: permission denied for column `title` (enforced by `GRANT UPDATE (is_read)`). | Remediation R5 | Local or Supabase | `NOT RUN` |
| **TEST-AUD-06** | Status History Automatic Audit | Automated trigger | Existing report | UPDATE report `status` from `submitted` to `under_review` | Trigger T3 automatically inserts row into `public.report_status_history` with `previous_status = 'submitted'`, `new_status = 'under_review'`. | Trigger T3 spec | Local or Supabase | `NOT RUN` |

---

## 7. Test Suite 6: Attachments & Storage Security

Validates canonical UUID regex guards, `CASE` short-circuit evaluation, parent row-locking concurrency control (Trigger T5), soft-delete RPC, and download visibility boundaries.

| Test ID | Category / Target | Role / Runner | Preconditions | Action | Expected Outcome | Decision / Requirement | Environment Required | Status |
|---|---|---|---|---|---|---|---|:---:|
| **TEST-ATT-01** | Valid Canonical Path Upload | `student_personnel` | Own report in `submitted` | Upload image to `reports/{report_id}/{att_id}.png` | Storage policy `storage_attachments_insert` validates path and permissions; upload succeeds. | Approved OD-REC-3 | Supabase instance | `NOT RUN` |
| **TEST-ATT-02** | Malformed UUID Path (Hyphens) | `student_personnel` | Own report in `submitted` | Attempt upload to `reports/------------------------------------/{att_id}.png` | Policy regex fails; `CASE` evaluates to `NULL`; upload cleanly rejected with HTTP 403 (no unhandled 500 crash). | Remediation R1 | Supabase instance | `NOT RUN` |
| **TEST-ATT-03** | Non-UUID Report Path | `student_personnel` | Own report | Attempt upload to `reports/not-a-uuid/{att_id}.jpg` | Policy regex fails; `CASE` evaluates to `NULL`; HTTP 403 access denied without casting exception. | Remediation R1 | Supabase instance | `NOT RUN` |
| **TEST-ATT-04** | Disallowed File Extension | `student_personnel` | Own report | Attempt upload to `reports/{report_id}/{att_id}.exe` | Policy regex rejects `.exe`; bucket MIME list rejects content type; upload denied. | Approved PD-D5 | Supabase instance | `NOT RUN` |
| **TEST-ATT-05** | File Size Limit (> 10MB) | `student_personnel` | Own report | Attempt upload of 15 MB file | Bucket `file_size_limit = 10485760` and table `chk_file_size` reject file. | Approved PD-D5 | Supabase instance | `NOT RUN` |
| **TEST-ATT-06** | Concurrency Row-Locking (Trigger T5) | Automated Harness | Report with 4 active attachments | Spawn 10 concurrent transactions inserting a 5th attachment record | Trigger T5 acquires `FOR UPDATE` lock on report; exactly 1 transaction succeeds (reaching 5); 9 transactions fail with max active attachments error. | Concurrency T5 | Local or Supabase | `NOT RUN` |
| **TEST-ATT-07** | Soft-Delete RPC Operation | `coordinator` | Report with active attachment | Execute `public.soft_delete_attachment(attachment_id)` | Row updated: `deleted_at = now()`, `deleted_by = auth.uid()`. Row remains in database. | Approved PD-D2, OD-NEW-2 | Local or Supabase | `NOT RUN` |
| **TEST-ATT-08** | Soft-Deleted Download Barring | `student_personnel` | Own report with soft-deleted attachment | Attempt to download file from Storage | Policy `storage_attachments_select` checks `ra.deleted_at IS NULL`; download denied. | Approved OD-REC-3 | Supabase instance | `NOT RUN` |
| **TEST-ATT-09** | Oversight Soft-Deleted Access | `coordinator` | Soft-deleted attachment | Attempt download from Storage | Policy `storage_attachments_select` permits oversight roles to download soft-deleted files for audit. | Approved OD-REC-3 | Supabase instance | `NOT RUN` |
| **TEST-ATT-10** | Unlinked Storage Object Isolation | `student_personnel` | Binary in Storage without DB row | Attempt to download orphaned object | Download denied. Policy requires matching row in `public.report_attachments`. | Storage Security | Supabase instance | `NOT RUN` |

---

## 8. Local-Only Scaffolding Architecture

To enable offline, non-destructive validation on local PostgreSQL databases without connecting to Supabase cloud services, a transaction-rollback test runner is prepared under `supabase/tests/database_test_suite.sql`.

### Scaffolding Execution Model
```sql
-- Execution Pattern for Local Test Runner
BEGIN;

-- 1. Create mock auth.uid() and role test fixtures
-- 2. Execute test assertions using DO $$ blocks with RAISE EXCEPTION on failure
-- 3. Verify all 12 test suites sequentially

-- ALWAYS ROLL BACK: Zero persistent mutations to database
ROLLBACK;
```

This guarantees that:
- Tests can run repeatedly without data contamination.
- No network connections, API keys, or cloud resources are accessed.
- Static schema assertions run in milliseconds.
