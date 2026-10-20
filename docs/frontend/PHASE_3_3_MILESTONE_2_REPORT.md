# Phase 3.3 Milestone 2 Implementation Report: Mutation Data Access Layer

**Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
**Workspace:** `D:\CMIRS-System\my-app`  
**Milestone:** Phase 3.3 — Milestone 2 (Authenticated Mutation Data Access Layer)  
**Status:** **COMPLETE**  
**Date:** October 20, 2026  
**Implementation Boundaries:** Milestone 2 Only (Local DAL Mutation Module, Unit Tests, and Documentation)

---

## 1. Executive Summary

Milestone 2 of **Phase 3.3: Report Submission & Mutation Integration** has been successfully implemented and verified locally. This milestone delivers the server-side, authenticated mutation Data Access Layer in `utils/reports/mutations.ts`, backed by isolated unit tests in `tests/unit/mutation-dal.test.mjs`.

All write operations strictly preserve PostgreSQL Row Level Security (RLS) as an independent defense boundary, resolve identity and canonical roles via server session cryptographic validation (`getCurrentUserAndProfile()`), enforce pure input bounds via Milestone 1 validators, and sanitize all database notices to prevent raw SQL leaks.

### Key Deliverables Completed
1. **Primary Deliverable (`utils/reports/mutations.ts` — 935 lines):** Implemented all 7 approved candidate mutation functions (`createReportRecord`, `triageReportRecord`, `assignTechnicianToReport`, `declineAssignmentViaRpc`, `transitionReportStatusRecord`, `createWorkLogRecord`, and `verifyReportRecord`).
2. **Local Unit Test Suite (`tests/unit/mutation-dal.test.mjs` — 568 lines):** Added 13 automated unit tests covering authentication guards, spoofing prevention, query construction, role enforcement, separation of duties, partial-failure handling, and error sanitization.
3. **Quality & Safety Verification:**
   - Unit tests: **83 / 83 tests passing** across all 7 test suites (1057ms).
   - TypeScript check (`npx tsc --noEmit`): Clean (exit code 0).
   - ESLint (`npm run lint`): Clean (0 errors, 0 warnings).
   - Next.js Turbopack production build (`npm run build`): Clean (compiled in 2.6s, 11/11 static pages generated, exit code 0).
   - Remote Supabase calls, migrations, and schema changes: **Zero executed**.

---

## 2. Functions Implemented and Target Tables / RPCs

| Function Name | Candidate Operation | Target Table / RPC | Operation Type |
| :--- | :--- | :--- | :--- |
| **`createReportRecord`** | Create a maintenance report | `public.reports` | PostgREST `INSERT` |
| **`triageReportRecord`** | Confirm priority & triage status | `public.reports` | PostgREST `UPDATE` |
| **`assignTechnicianToReport`** | Assign/reassign technician | `public.assignments`, `public.reports` | PostgREST `UPDATE` + `INSERT` + `UPDATE` |
| **`declineAssignmentViaRpc`** | Decline assigned work order | `public.decline_assignment(UUID, TEXT)` | Database RPC call |
| **`transitionReportStatusRecord`**| Lifecycle state transition | `public.reports`, `public.assignments` | PostgREST `UPDATE` |
| **`createWorkLogRecord`** | Log technician work session | `public.work_logs` | PostgREST `INSERT` |
| **`verifyReportRecord`** | Record inspection & resolution | `public.verifications`, `public.reports` | PostgREST `INSERT` + `UPDATE` |

---

## 3. Authentication, Role Checks, and Identity Resolution

Every mutation function executes through a strict authentication pipeline:
1. **Session-Derived Identity (`auth.uid()`):** Identity is established exclusively via `getCurrentUserAndProfile()`, which queries Supabase Auth cryptographically (`supabase.auth.getUser()`) and verifies that `profiles.is_active === true`. Client-supplied user IDs, roles, ownership claims, and report numbers are completely rejected.
2. **Fail-Closed Unauthenticated/Inactive Guard:** If `user` is null or `is_active === false`, operations immediately fail with a sanitized error (`Authentication required. Please log in with an active account`) without executing database queries.
3. **Role Enforcement:**
   - `createReportRecord`: All 5 canonical roles (`student_personnel`, `technician`, `coordinator`, `administrator`, `management`) are permitted to submit reports per Approved PD-R6.
   - `triageReportRecord`: Restricted strictly to `coordinator`.
   - `assignTechnicianToReport`: Restricted strictly to `coordinator`; verifies target user is an active `technician`.
   - `declineAssignmentViaRpc`: Restricted strictly to `technician`; verified by both application logic and RPC `decline_assignment`.
   - `transitionReportStatusRecord`: Role matrix enforces specific lifecycle transitions (reporter cancellation on `submitted`/`under_review`; technician on assigned work orders; coordinator on holds/cancellations).
   - `createWorkLogRecord`: Restricted strictly to `technician`.
   - `verifyReportRecord`: Restricted strictly to `coordinator`.

---

## 4. RLS Assumptions and Migration References

The mutation service assumes the existing, deployed database policies and triggers from `supabase/migrations/`:

| Table / Target | Policy / Trigger | Migration File | Rule Enforced |
| :--- | :--- | :--- | :--- |
| `reports` | `reports_insert` | `20261018000005_table_rls_policies.sql:140-147` | Requires `reporter_id = auth.uid()`, `status = 'submitted'`, and `confirmed_priority IS NULL`. |
| `reports` | `trg_reports_report_number` | `20261018000003_triggers.sql:37-55` | Unconditionally generates sequence number `RPT-XXXXXX` on insert. |
| `reports` | `trg_reports_immutable_cols` | `20261018000003_triggers.sql:56-78` | Locks `report_number` and `reporter_id` from modification on update. |
| `reports` | `trg_reports_status_history` | `20261018000003_triggers.sql:84-117` | Automatically logs status transitions into `public.report_status_history`. |
| `reports` | `reports_update_coordinator` | `20261018000005_table_rls_policies.sql:150-160` | Permits coordinators to update non-terminal reports (`status NOT IN ('verified', 'cancelled')`). |
| `reports` | `reports_update_reporter_cancel` | `20261018000005_table_rls_policies.sql:162-172` | Reporters may only cancel own reports in `submitted` or `under_review`. |
| `reports` | `reports_update_technician_hold` | `20261018000005_table_rls_policies.sql:174-192` | Technicians may transition hold/progress states on active work orders. |
| `assignments` | `assignments_insert_coordinator` | `20261018000005_table_rls_policies.sql:204-210` | Coordinators may insert assignments with `assigned_by = auth.uid()`. |
| `assignments` | `assignments_update_coordinator` | `20261018000005_table_rls_policies.sql:212-220` | Coordinators may update assignments (e.g., mark `reassigned`). |
| `assignments` | `decline_assignment` RPC | `20261018000004_security_functions_and_rpc.sql:132-178` | Validates technician ownership, assigned status, and non-empty `btrim(reason)`. |
| `work_logs` | `work_logs_insert` | `20261018000005_table_rls_policies.sql:382-395` | Validates technician owns active assignment in `('assigned', 'in_progress', 'on_hold')`. |
| `verifications` | `verifications_insert_coordinator` | `20261018000005_table_rls_policies.sql:407-427` | Report must be in `completed` status; verifier cannot be reporter (PD-R4) or technician (D2). |

---

## 5. Transaction and Partial-Failure Analysis

Because PostgREST executes individual HTTP queries without multi-statement client-side transactions, operations involving multiple tables require explicit failure handling and architectural analysis:

### 1. `assignTechnicianToReport`
- **Steps:**
  1. Update existing active assignments to `status = 'reassigned'`.
  2. Insert new assignment row (`status = 'assigned'`).
  3. Update report status to `status = 'assigned'` (reverting `in_progress` per Approved Decision 1).
- **Partial Failure Risk:** If Step 2 succeeds but Step 3 fails, the new assignment row exists in the database, but the report status remains `in_progress`.
- **Mitigation Implemented:** The function checks the return of Step 3. If Step 3 fails, the function returns `{ success: false, error: 'Technician assigned, but failed to update report lifecycle status to assigned.' }`. It does not claim full success. Coordinators can safely retry assignment.

### 2. `verifyReportRecord`
- **Steps:**
  1. Insert verification row into `public.verifications`.
  2. Update report status to `verified` (if satisfactory) or `reopened` (if unsatisfactory).
- **Partial Failure Risk:** If Step 1 succeeds but Step 2 fails, a verification record exists while the report remains `completed`.
- **Order Invariant:** Step 1 **must** execute before Step 2 because the database RLS policy `verifications_insert_coordinator` enforces `r.status = 'completed'`. If Step 2 ran first, Step 1 would be rejected by PostgreSQL RLS.
- **Mitigation Implemented:** If Step 2 fails, the function logs the exact error and returns `{ success: false, error: 'Verification recorded, but failed to update report status...' }`.

### 3. Status History and Trigger T3
- As documented in `docs/database-design/PHASE_4C_REMEDIATION_REVIEW.md` (Finding R7), Trigger T3 (`record_status_history`) executes `AFTER UPDATE OF status ON public.reports` and automatically inserts an audit row with `reason = NULL`.
- To prevent duplicate history records, `mutations.ts` relies on Trigger T3 for status transition auditing. For verifications, explanatory notes are captured in `public.verifications.notes`; for decline, reasons are captured in `public.assignments.decline_reason`.

---

## 6. Local Tests Added and Actual Results

All unit tests were added in `tests/unit/mutation-dal.test.mjs` using controlled mock contexts:

| Test Scenario | Area Tested | Result |
| :--- | :--- | :--- |
| 1. Auth Guard | Rejection of null user and inactive profiles | **PASS** |
| 2. Validation & Spoofing Guard | Rejection of missing fields and client-supplied `reporter_id` / `status` | **PASS** |
| 3. Report Creation | PostgREST query payload, sequence numbering, and default fields | **PASS** |
| 4. Error Sanitization | Foreign key constraint violation sanitized without leaking SQL | **PASS** |
| 5. Report Triage | Coordinator role restriction and confirmed priority update | **PASS** |
| 6. Technician Assignment | Target technician active validation and terminal report guard | **PASS** |
| 7. Reassignment Workflow | Reverts `in_progress` report to `assigned` per Approved Decision 1 | **PASS** |
| 8. Partial Failure Handling | Non-success return when secondary status update fails | **PASS** |
| 9. Decline Assignment RPC | Technician role enforcement and `decline_assignment` RPC call | **PASS** |
| 10. Status Transitions | Reporter cancellation limits and coordinator assignment cancellation | **PASS** |
| 11. Work Logs | Hours spent decimal precision and technician assignment linkage | **PASS** |
| 12. Separation of Duties | Rejection of self-review (PD-R4) and self-repair (D2) verifications | **PASS** |
| 13. Rejection & Reopening | Verification failure reopens report with notes per Approved Decision 2 | **PASS** |

### Execution Command Output
```
> node --test tests/unit/*.test.mjs

✔ Finding 1 & Schema: Verified column selection enforces categories!inner join semantics (35.3822ms)
...
✔ Auth Guard: Rejects unauthenticated callers and inactive profiles (4.172ms)
✔ Validation & Spoofing Guard: Rejects invalid payloads and client-supplied identity claims (0.6761ms)
✔ Report Creation: Constructs correct PostgREST query and returns generated fields (0.9016ms)
✔ Report Creation: Sanitizes database errors and does not leak internal SQL (1.1327ms)
✔ Report Triage: Restricts triage to coordinator role and updates confirmed priority (1.2774ms)
✔ Technician Assignment: Enforces active technician role and non-terminal report state (1.3453ms)
✔ Technician Assignment: Reassignment reverts in_progress report to assigned (Approved Decision 1) (1.0008ms)
✔ Technician Assignment: Handles partial failure when report status update fails (1.1619ms)
✔ Decline Assignment RPC: Enforces technician role and invokes decline_assignment RPC (1.0539ms)
✔ Status Transitions: Enforces reporter cancellation eligibility and active work state machine (2.1457ms)
✔ Work Logs: Records technician work session with valid hours and assignment link (0.9826ms)
✔ Coordinator Verification: Enforces separation of duties (PD-R4 and D2) (1.1933ms)
✔ Coordinator Verification: Rejection records notes and reopens report (Approved Decision 2) (0.6432ms)
...
ℹ tests 83
ℹ suites 0
ℹ pass 83
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1057.0218
```

---

## 7. Known Limitations and Blocked Operations

1. **Multi-Table Atomic Transactions:** PostgREST client mutations do not support native distributed transactions across multiple tables without database-level RPC functions. In a future database phase when migration changes are authorized, creating dedicated RPCs (`assign_technician_atomic`, `verify_report_atomic`) would guarantee single-transaction atomicity for multi-table writes. In Phase 3.3, sequential execution with strict step verification and partial failure error reporting is enforced.
2. **Photo Attachment Storage Operations:** File uploads to the `report-attachments` bucket and metadata insertion into `public.report_attachments` are strictly deferred from Milestone 2 per the explicit authorization boundaries.

---

## 8. Confirmation of Strict Boundary Compliance

| Boundary Item | Compliance Status | Evidence |
| :--- | :--- | :--- |
| **No Remote Database Writes** | **CONFIRMED** | Zero remote Supabase API calls made. All tests executed with in-memory mocks. |
| **No Schema / RLS Modifications** | **CONFIRMED** | `supabase/migrations/` was completely untouched. |
| **No Service-Role Key Usage** | **CONFIRMED** | Zero references to service-role keys. Client uses authenticated user session. |
| **No Server Actions Implemented** | **CONFIRMED** | `actions/reports.ts` was not created. Deferred to Milestone 3. |
| **No UI Forms / Routes Modified** | **CONFIRMED** | `app/reports/new/page.tsx` and UI forms were not modified. Deferred to Milestone 4. |
| **No Storage Operations** | **CONFIRMED** | No file uploads or Storage bucket mutations executed. |
| **No Git Commits / Pushes** | **CONFIRMED** | Git history untouched; working copy preserved. |

---

## 9. Next Steps

Milestone 2 is complete. Milestone 3 (**Server Actions & Cache Invalidation: `actions/reports.ts`**) is ready to begin upon separate user approval:
1. Implement Server Actions with `'use server'` directive wrapping DAL mutation functions.
2. Bind actions to React 19 `useActionState` payload contracts.
3. Incorporate Next.js `revalidatePath('/reports')` and `revalidateTag()`.
4. Add isolated unit tests for Server Actions.
5. Stop for Milestone 4 approval.
