# CMIRS Phase 5B — Local Migration Test Results Template

> **Document:** `docs/database-design/PHASE_5B_LOCAL_TEST_RESULTS_TEMPLATE.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 5B — Local Migration Execution Readiness and Test Run  
> **Role:** Lead QA & Database Engineer  
> **Status:** RESULTS TEMPLATE (AWAITING EXECUTION AUTHORIZATION)  
> **Execution Status:** **ALL 45 TESTS NOT RUN — ZERO TESTS EXECUTED**  

---

## 1. Execution Pre-Checklist (To Be Verified Prior to Test Run)

| Pre-Check Item | Verification Criterion | Pre-Execution Status |
|---|---|:---:|
| **Local Host Guard** | Confirmed target host is `127.0.0.1` or `localhost` (No remote Supabase URL) | [ ] PENDING AUTHORIZATION |
| **Runtime Service** | Local Docker / Supabase CLI or PostgreSQL 15/16 instance active on local port | [ ] PENDING RUNTIME SETUP |
| **Migration Hash Match** | All 6 migration files match SHA-256 baseline hashes in Phase 5B Execution Plan | [x] CONFIRMED MATCH |
| **Clean Baseline State** | Target database schema `public` contains zero conflicting tables or enums | [ ] PENDING INSPECTION |
| **Rollback Safety** | Test runner operates within `BEGIN ... ROLLBACK` or against disposable container | [x] CONFIRMED IN SCAFFOLDING |

---

## 2. Actual Test Results by Suite

> [!IMPORTANT]
> In accordance with strict Phase 5B safety restrictions, **no tests have been executed**. All tests below are recorded in their initial unexecuted state (`NOT RUN — AWAITING AUTHORIZATION`). Following owner authorization and live local execution, the operator will record actual observed outputs, timestamps, and status verdicts.

### 2.1 Suite 1: Schema & Migration Integrity

| Test ID | Description | Expected Outcome | Actual Observed Output | Status | Execution Timestamp |
|---|---|---|---|:---:|:---:|
| **TEST-MIG-01** | Verify all 12 core tables exist in `public` | Exactly 12 tables returned | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-MIG-02** | Verify 5 custom enums, labels, and order | 5 enums with exact approved labels | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-MIG-03** | Verify sequence `report_number_seq` | Sequence exists, starts at 1 | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-MIG-04** | Verify 24 performance and RLS indexes | All 24 indexes created and active | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-MIG-05** | Verify storage bucket `report-attachments` | Private bucket, 10MB, approved MIME | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-MIG-06** | Test migration replay idempotency | Re-executing DDL raises zero errors | *(Awaiting test execution)* | `NOT RUN` | — |

---

### 2.2 Suite 2: Authentication & Role Authorization

| Test ID | Description | Expected Outcome | Actual Observed Output | Status | Execution Timestamp |
|---|---|---|---|:---:|:---:|
| **TEST-AUTH-01** | GoTrue auth trigger creates student profile | Trigger T4 inserts profile on signup | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUTH-02** | Role lookup reflects update immediately | `get_user_role()` returns updated role | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUTH-03** | Role change audit log inserted on update | Admin logs change, constraint enforced | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUTH-04** | Anon unauthenticated access blocked | SELECT on tables/storage denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUTH-05** | Identity spoofing rejected on insert | Cannot set `reporter_id != auth.uid()` | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUTH-06** | Profile email/id immutability guarded | Updates to email/id denied | *(Awaiting test execution)* | `NOT RUN` | — |

---

### 2.3 Suite 3: Reports & Lifecycle Workflow

| Test ID | Description | Expected Outcome | Actual Observed Output | Status | Execution Timestamp |
|---|---|---|---|:---:|:---:|
| **TEST-RPT-01** | Initial status must be `submitted` | Non-submitted insert fails RLS | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-02** | Initial priority must be NULL | Non-NULL priority insert fails RLS | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-03** | Report number assigned from sequence | Custom string overwritten with `RPT-...` | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-04** | Report number immutable on UPDATE | Trigger blocks `report_number` update | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-05** | Reporter ID immutable on UPDATE | Trigger blocks `reporter_id` update | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-06** | Reporter can cancel own submitted report | Transition to `cancelled` succeeds | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-07** | Reporter cannot cancel assigned report | Transition to `cancelled` denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-08** | Coordinator self-verification barred | Verification insert by author denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-RPT-09** | Coordinator cancel updates assignments | Active assignments cancelled atomically | *(Awaiting test execution)* | `NOT RUN` | — |

---

### 2.4 Suite 4: Assignments & Work Logs

| Test ID | Description | Expected Outcome | Actual Observed Output | Status | Execution Timestamp |
|---|---|---|---|:---:|:---:|
| **TEST-ASG-01** | Assigned technician can view report | Report visible via `can_view_report()` | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-02** | Declined-only assignment excludes view | Report invisible to declined technician | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-03** | Technician decline from assigned status | Status updated to `declined` with reason | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-04** | Technician decline from in-progress barred | Decline from `in_progress` denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-05** | Empty whitespace decline reason rejected | Constraint `chk_decline_reason` fails | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-06** | Assignment metadata immutable to tech | `assigned_by`, `assigned_at` immutable | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-07** | Work logs barred on inactive assignment | Insert on declined/cancelled denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ASG-08** | Work hold transition permitted | `in_progress <-> on_hold` succeeds | *(Awaiting test execution)* | `NOT RUN` | — |

---

### 2.5 Suite 5: Comments, Notifications & Audit History

| Test ID | Description | Expected Outcome | Actual Observed Output | Status | Execution Timestamp |
|---|---|---|---|:---:|:---:|
| **TEST-AUD-01** | Comments immutable against UPDATE | UPDATE on `report_comments` denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUD-02** | Comments immutable against DELETE | DELETE on `report_comments` denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUD-03** | Admin & management can SELECT comments | Oversight read permitted via report RLS | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUD-04** | Notification `is_read` update permitted | Update to `is_read = true` succeeds | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUD-05** | Notification title/message update barred | Column privilege denies update | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-AUD-06** | Trigger T3 auto-inserts status history | Status change creates history row | *(Awaiting test execution)* | `NOT RUN` | — |

---

### 2.6 Suite 6: Attachments & Storage Security

| Test ID | Description | Expected Outcome | Actual Observed Output | Status | Execution Timestamp |
|---|---|---|---|:---:|:---:|
| **TEST-ATT-01** | Canonical path photo upload succeeds | Valid UUID path upload accepted | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-02** | Malformed UUID path rejected cleanly | Non-UUID path returns HTTP 403 (no 500) | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-03** | Non-UUID report path rejected | Mismatched segment returns HTTP 403 | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-04** | Disallowed file extension rejected | Non-image extension denied | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-05** | File size limit (> 10MB) enforced | Large file rejected by bucket/table check | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-06** | Concurrency Trigger T5 row-locking | Exactly 5 attachments allowed, 6th fails | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-07** | Soft-delete RPC marks attachment | `deleted_at` set; record preserved | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-08** | Soft-deleted photo hidden from student | Download denied to reporter/tech | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-09** | Oversight can download soft-deleted photo | Coordinator/admin download succeeds | *(Awaiting test execution)* | `NOT RUN` | — |
| **TEST-ATT-10** | Unlinked storage binary download blocked | Download denied without active DB row | *(Awaiting test execution)* | `NOT RUN` | — |

---

## 3. Post-Test Cleanup & State Verification

Following completion of the test suite, the operator must execute the cleanup audit query and record residual counts:

```sql
SELECT 
  (SELECT COUNT(*) FROM public.profiles WHERE email LIKE '%.test@university.edu') AS residual_test_profiles,
  (SELECT COUNT(*) FROM public.reports WHERE title LIKE '%Test%' OR title = 'Leaking pipe') AS residual_test_reports,
  (SELECT COUNT(*) FROM public.categories WHERE name LIKE '%Test%') AS residual_test_categories;
```

| Verification Metric | Target Expected Count | Actual Residual Count Observed | Cleanup Verification Result |
|---|:---:|:---:|:---:|
| **Residual Test Profiles** | `0` | *(Pending test run)* | `NOT RUN` |
| **Residual Test Reports** | `0` | *(Pending test run)* | `NOT RUN` |
| **Residual Test Categories** | `0` | *(Pending test run)* | `NOT RUN` |

---

## 4. Execution Summary & Operator Sign-Off

*(To be completed by the operator following authorized local execution)*

- **Operator Name / Role:** __________________________________
- **Execution Date & Time:** __________________________________
- **Local Target URL:** __________________________________
- **Total Tests Executed:** `0 / 45`
- **Total Tests Passed:** `0`
- **Total Tests Failed:** `0`
- **Final Test Run Verdict:** `AWAITING AUTHORIZATION`
