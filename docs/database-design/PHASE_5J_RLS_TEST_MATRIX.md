# CMIRS Phase 5J — Role-Based RLS Integration Test Matrix

> **Document:** `docs/database-design/PHASE_5J_RLS_TEST_MATRIX.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 5J — Seed Data Planning, Catalog Audit & RLS Test Design  
> **Role:** Lead Security & Database QA Engineer  
> **Status:** TEST SPECIFICATION DELIVERABLE (PLANNING ONLY)  
> **Execution Status:** **ALL TESTS NOT RUN — ZERO RUNTIME EXECUTION**  
> **Target Project Reference:** `xyirfifvcntuzceivtho`  

---

## 1. Executive Summary & Verification Framework

This document defines the definitive role-based Row Level Security (RLS) and API authorization test matrix for CMIRS. The test cases cover all five authenticated roles and public anonymous access:
1. `student_personnel` (Default Reporter Role)
2. `coordinator` (Triage & Dispatch Role)
3. `technician` (Field Repair Role)
4. `administrator` (System Management Role)
5. `management` (Oversight & Reporting Role)
6. `anon` (Unauthenticated Public Role)

### Crucial Security & Testing Principles
- **No Mock DML on `auth.users`:** In compliance with Phase 5I findings, synthetic mock rows must never be inserted directly into `auth.users`. All tests requiring authenticated sessions must use official test accounts provisioned via the Supabase Auth Admin API (`supabase.auth.admin.createUser`) or client signup.
- **Superuser Testing Disclaimer:** Superuser sessions (`postgres` role in Dashboard SQL Editor) bypass RLS (`BYPASSRLS`). Consequently, **RLS policies cannot be tested via superuser SQL queries**. Every test in this matrix specifies an authenticated client session using role-scoped JWT tokens.
- **Status Classification:** In strict adherence to safety rules, every test in this document is designated **`NOT RUN`**.

---

## 2. Test Execution Method Categories

Each test in the matrix is classified into one of five distinct execution categories:

| Category ID | Execution Method | Tooling / Harness Required | Scope & Purpose |
|---|---|---|---|
| **M1** | **Read-Only Catalog Audit** | SQL Editor / `psql` (superuser) | Validates table structures, enum labels, sequence definitions, constraints, triggers, and RLS enabled flags. |
| **M2** | **Authenticated SDK / PostgREST API** | Next.js Integration Test Runner / `@supabase/supabase-js` | Evaluates multi-role RLS query filtering and mutations using dedicated role test accounts and JWT tokens. |
| **M3** | **Supabase Storage API** | `@supabase/storage-js` API Client | Evaluates file upload, MIME type rejection, size boundary enforcement, and download visibility via signed URLs. |
| **M4** | **Concurrency Benchmark** | Node.js Parallel HTTP Runner (k6 / custom script) | Evaluates multi-stream row-locking concurrency (e.g. Trigger T5 parent row locks under parallel uploads). |
| **M5** | **Application-Level Server Action** | Next.js 16 Server Components / Vitest | Evaluates end-to-end application contracts, payload whitelisting, and transition services. |

---

## 3. Comprehensive Role-Based Integration Test Matrix

### Domain 1: Authentication, Role Boundaries & Profiles

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-AUTH-01** | `anon` | No JWT provided | Attempt `SELECT * FROM public.profiles` | Returns 0 rows. Public access denied. | Data scraping / PII leakage | M2 | `NOT RUN` |
| **RLS-AUTH-02** | `student_personnel` | Authenticated as Student A | Query own profile `SELECT * FROM public.profiles WHERE id = auth.uid()` | Returns own profile record. | User profile access | M2 | `NOT RUN` |
| **RLS-AUTH-03** | `student_personnel` | Authenticated as Student A | Attempt `SELECT * FROM public.profiles WHERE id = User_B_UUID` | Returns 0 rows. Access denied by `profiles_select`. | Horizontal privilege escalation | M2 | `NOT RUN` |
| **RLS-AUTH-04** | `coordinator` | Authenticated as Coordinator | Query profiles across all users | Returns all profile records (oversight access). | Operational oversight | M2 | `NOT RUN` |
| **RLS-AUTH-05** | `student_personnel` | Authenticated as Student A | Attempt `UPDATE profiles SET role = 'administrator' WHERE id = auth.uid()` | Fails with RLS `WITH CHECK` violation (`role` immutable). | Vertical privilege escalation | M2 | `NOT RUN` |
| **RLS-AUTH-06** | `student_personnel` | Authenticated as Student A | Attempt `UPDATE profiles SET is_active = false WHERE id = auth.uid()` | Fails with RLS `WITH CHECK` violation (`is_active` immutable). | Self-sabotage / audit bypass | M2 | `NOT RUN` |
| **RLS-AUTH-07** | `administrator` | Authenticated as Admin A | Attempt `UPDATE profiles SET role = 'coordinator' WHERE id = auth.uid()` | Fails with RLS policy check `id != auth.uid()`. | Admin self-demotion lockout | M2 | `NOT RUN` |
| **RLS-AUTH-08** | `administrator` | Authenticated as Admin A | Update role on Student B profile to `technician` | Update succeeds. Admin creates audit row in `role_change_audit`. | Authorized role administration | M2 | `NOT RUN` |
| **RLS-AUTH-09** | `student_personnel` | Authenticated as Student A | Attempt direct `INSERT INTO public.role_change_audit` | Fails with RLS `WITH CHECK` violation (Admin only). | Audit log forgery | M2 | `NOT RUN` |

---

### Domain 2: Report Creation, Numbering & Visibility

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-RPT-01** | `student_personnel` | Authenticated as Student A | `INSERT INTO public.reports` with valid title, category, location, and `reporter_id = auth.uid()` | Insert succeeds. Status defaults to `submitted`, `confirmed_priority` is `NULL`. | Authorized report creation | M2 | `NOT RUN` |
| **RLS-RPT-02** | `student_personnel` | Authenticated as Student A | Attempt `INSERT INTO public.reports` with `reporter_id = User_B_UUID` | Fails with RLS `WITH CHECK` violation (`reporter_id = auth.uid()`). | Identity spoofing | M2 | `NOT RUN` |
| **RLS-RPT-03** | `student_personnel` | Authenticated as Student A | Attempt `INSERT INTO public.reports` with `status = 'verified'` | Fails with RLS `WITH CHECK` violation (status must be `submitted`). | Workflow bypass | M2 | `NOT RUN` |
| **RLS-RPT-04** | `student_personnel` | Authenticated as Student A | Attempt `INSERT INTO public.reports` with `confirmed_priority = 'critical'` | Fails with RLS `WITH CHECK` violation (`confirmed_priority` must be `NULL`). | Priority escalation bypass | M2 | `NOT RUN` |
| **RLS-RPT-05** | `student_personnel` | Authenticated as Student A | Insert report with custom `report_number = 'RPT-999999'` | Insert succeeds, but Trigger T2 **overwrites** custom number with next sequence value (`RPT-000001`). | Report number spoofing | M2 | `NOT RUN` |
| **RLS-RPT-06** | `student_personnel` | Authenticated as Student A | Attempt `UPDATE public.reports SET report_number = 'RPT-ALTERED'` | Trigger `trg_reports_immutable_cols` raises exception: `report_number is immutable`. | Sequence tampering | M2 | `NOT RUN` |
| **RLS-RPT-07** | `student_personnel` | Authenticated as Student A | Attempt `UPDATE public.reports SET reporter_id = User_B_UUID` | Trigger `trg_reports_immutable_cols` raises exception: `reporter_id is immutable`. | Attribution tampering | M2 | `NOT RUN` |
| **RLS-RPT-08** | `student_personnel` | Authenticated as Student A | `SELECT * FROM public.reports WHERE id = Report_A` (own report) | Report returned (`can_view_report()` = TRUE). | Reporter visibility | M2 | `NOT RUN` |
| **RLS-RPT-09** | `student_personnel` | Authenticated as Student A | `SELECT * FROM public.reports WHERE id = Report_B` (Student B's report) | Returns 0 rows. Report completely hidden. | Horizontal report isolation | M2 | `NOT RUN` |
| **RLS-RPT-10** | `coordinator` | Authenticated as Coordinator | `SELECT * FROM public.reports` | Returns all reports regardless of author or status. | Triage visibility | M2 | `NOT RUN` |
| **RLS-RPT-11** | `management` | Authenticated as Management | `SELECT * FROM public.reports` | Returns all reports campus-wide. | Oversight visibility | M2 | `NOT RUN` |

---

### Domain 3: Technician Assignment, Decline Flow & Work Logs

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-ASG-01** | `coordinator` | Active report in `submitted` | `INSERT INTO public.assignments` assigning report to Tech A | Insert succeeds. Status defaults to `assigned`. | Coordinator dispatch | M2 | `NOT RUN` |
| **RLS-ASG-02** | `technician` | Assigned report exists for Tech A | Authenticated as Tech A: `SELECT * FROM public.reports WHERE id = ...` | Report returned (`can_view_report()` = TRUE). | Technician work queue | M2 | `NOT RUN` |
| **RLS-ASG-03** | `technician` | Report assigned to Tech B only | Authenticated as Tech A: query report | Returns 0 rows. Report invisible to unassigned technician. | Cross-technician isolation | M2 | `NOT RUN` |
| **RLS-ASG-04** | `technician` | Assignment in `assigned` status | Call RPC `decline_assignment(id, 'Conflict with emergency task')` | Status updated to `declined`, `decline_reason` stored. | Authorized decline flow | M2 | `NOT RUN` |
| **RLS-ASG-05** | `technician` | Assignment declined by Tech A | Authenticated as Tech A: query report | Returns 0 rows. Report invisible to technician with declined-only assignment. | Post-decline data leakage | M2 | `NOT RUN` |
| **RLS-ASG-06** | `technician` | Assignment in `assigned` status | Attempt decline with whitespace `decline_reason = '   '` | Constraint `chk_decline_reason` fails via `btrim()`. Decline rejected. | Audit evasion | M2 | `NOT RUN` |
| **RLS-ASG-07** | `technician` | Assignment in `in_progress` status | Attempt to decline assignment | Fails via policy `assignments_update_technician_decline` and RPC check. | Abandonment without triage | M2 | `NOT RUN` |
| **RLS-ASG-08** | `technician` | Assignment in `assigned` status | Attempt UPDATE modifying `assigned_by` or `notes` | Subquery equality checks reject modification. | Coordinator metadata tampering | M2 | `NOT RUN` |
| **RLS-ASG-09** | `technician` | Assignment in `in_progress` status | `INSERT INTO public.work_logs` (hours: 2.5, description) | Insert succeeds. | Work logging | M2 | `NOT RUN` |
| **RLS-ASG-10** | `technician` | Assignment in `declined` status | Attempt `INSERT INTO public.work_logs` | Fails via policy `work_logs_insert` (requires active assignment). | Phantom work logs | M2 | `NOT RUN` |

---

### Domain 4: Report Cancellation & Status Transitions

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-CAN-01** | `student_personnel` | Own report in `submitted` status | `UPDATE public.reports SET status = 'cancelled'` | Update succeeds. Policy `reports_update_reporter_cancel` permits cancellation. | Reporter early cancel | M2 | `NOT RUN` |
| **RLS-CAN-02** | `student_personnel` | Own report in `in_progress` status | Attempt `UPDATE public.reports SET status = 'cancelled'` | Fails with RLS violation (permitted only in `submitted` or `under_review`). | Cancellation during repair | M2 | `NOT RUN` |
| **RLS-CAN-03** | `coordinator` | Report in `in_progress` status | `UPDATE public.reports SET status = 'cancelled'` | Update succeeds via `reports_update_coordinator`. | Coordinator administrative cancel | M2 | `NOT RUN` |
| **RLS-CAN-04** | `coordinator` | Report cancelled with active assignments | Execute atomic cancellation transaction | Report transitions to `cancelled`; active assignments transition to `cancelled`. | Orphaned technician tasks | M2 | `NOT RUN` |
| **RLS-AUD-01** | System / Automated | Any report status change | `UPDATE public.reports SET status = 'under_review'` | Trigger T3 automatically inserts row into `report_status_history` (`reason = NULL`). | Audit gap prevention | M2 | `NOT RUN` |

---

### Domain 5: Coordinator Verification Restrictions (Anti-Self-Dealing)

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-VER-01** | `coordinator` | Completed report authored by Student A | `INSERT INTO public.verifications` (is_satisfactory = true, notes) | Insert succeeds. | Standard verification | M2 | `NOT RUN` |
| **RLS-VER-02** | `coordinator` | Completed report authored by **Coordinator A** | Coordinator A attempts `INSERT INTO public.verifications` | Fails with RLS check `r.reporter_id != auth.uid()`. | Self-verification conflict of interest | M2 | `NOT RUN` |
| **RLS-VER-03** | `coordinator` | Completed report where Coordinator A performed technician work | Coordinator A attempts `INSERT INTO public.verifications` | Fails with RLS check `NOT EXISTS (technician_id = auth.uid())`. | Self-repair verification | M2 | `NOT RUN` |
| **RLS-VER-04** | `coordinator` | Report in `in_progress` status | Attempt `INSERT INTO public.verifications` | Fails with RLS check `r.status = 'completed'`. | Premature verification | M2 | `NOT RUN` |
| **RLS-VER-05** | `technician` | Completed report | Attempt `INSERT INTO public.verifications` | Fails with RLS violation (Coordinator only). | Unauthorized technician sign-off | M2 | `NOT RUN` |

---

### Domain 6: Comments & Notification Immutability

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-COM-01** | `student_personnel` | Own report | `INSERT INTO public.report_comments` (content: 'Water is rising') | Comment inserted. | Reporter communication | M2 | `NOT RUN` |
| **RLS-COM-02** | `student_personnel` | Own authored comment | Attempt `UPDATE public.report_comments SET content = 'Altered'` | Fails. No UPDATE policy exists (default PostgreSQL deny). | Comment alteration | M2 | `NOT RUN` |
| **RLS-COM-03** | `coordinator` | Existing comment | Attempt `DELETE FROM public.report_comments` | Fails. No DELETE policy exists (default PostgreSQL deny). | Comment destruction | M2 | `NOT RUN` |
| **RLS-NOT-01** | `student_personnel` | Notification for Student A | `UPDATE public.notifications SET is_read = true WHERE id = ...` | Update succeeds. | Notification acknowledgment | M2 | `NOT RUN` |
| **RLS-NOT-02** | `student_personnel` | Notification for Student A | Attempt `UPDATE public.notifications SET title = 'Spoofed'` | Fails with column privilege violation (`GRANT UPDATE (is_read)`). | Notification tampering | M2 | `NOT RUN` |
| **RLS-NOT-03** | `student_personnel` | Notification for Student B | Attempt to SELECT or UPDATE Student B's notification | Returns 0 rows. Access denied by `recipient_id = auth.uid()`. | Cross-user notification leak | M2 | `NOT RUN` |

---

### Domain 7: Storage & File Attachment Security

| Test ID | Acting Role | Preconditions | Action | Expected Result | Security Risk Addressed | Method | Status |
|---|---|---|---|---|---|:---:|:---:|
| **RLS-ATT-01** | `student_personnel` | Own report in `submitted` | Upload image to `reports/{report_id}/{attachment_id}.png` | Storage policy validates canonical UUID regex; upload succeeds. | Authorized attachment upload | M3 | `NOT RUN` |
| **RLS-ATT-02** | `student_personnel` | Own report in `submitted` | Attempt upload to `reports/invalid-uuid/{id}.png` | Policy regex fails; `CASE` evaluates to `NULL`; rejected with HTTP 403 (zero casting crash). | UUID injection / optimizer crash | M3 | `NOT RUN` |
| **RLS-ATT-03** | `student_personnel` | Own report in `submitted` | Attempt upload of `.exe` or `.pdf` file | Rejected by bucket `allowed_mime_types` and policy regex. | Malicious file execution | M3 | `NOT RUN` |
| **RLS-ATT-04** | `student_personnel` | Own report in `submitted` | Attempt upload of 15 MB file | Rejected by bucket `file_size_limit = 10485760`. | Storage exhaustion / DoS | M3 | `NOT RUN` |
| **RLS-ATT-05** | `student_personnel` | Report has 4 active attachments | Spawn 10 concurrent requests to insert 5th attachment | Trigger T5 locks parent report row (`FOR UPDATE`); exactly 1 succeeds, 9 fail with max active limit error. | Concurrency limit bypass | M4 | `NOT RUN` |
| **RLS-ATT-06** | `coordinator` | Report with active attachment | Call RPC `soft_delete_attachment(id)` | Attachment marked `deleted_at = now()`, `deleted_by = auth.uid()`. Metadata preserved. | Authorized photo moderation | M2 | `NOT RUN` |
| **RLS-ATT-07** | `student_personnel` | Own report with soft-deleted photo | Attempt to download soft-deleted photo via Storage API | Access denied. `storage_attachments_select` hides soft-deleted files from student. | Content moderation bypass | M3 | `NOT RUN` |
| **RLS-ATT-08** | `coordinator` | Soft-deleted photo | Attempt download via Storage API | Download permitted for audit/moderation review. | Coordinator audit oversight | M3 | `NOT RUN` |
| **RLS-ATT-09** | Any Role | Binary stored in bucket | Attempt in-place file replacement (`UPDATE storage.objects`) | Denied. No UPDATE policy exists on `storage.objects`. | Binary tampering | M3 | `NOT RUN` |

---
*End of Role-Based RLS Integration Test Matrix. All 45 tests designated NOT RUN.*
