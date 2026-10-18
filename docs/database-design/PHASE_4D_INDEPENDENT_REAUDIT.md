# CMIRS Phase 4D — Independent Migration SQL Security Re-Audit

> **Document:** `docs/database-design/PHASE_4D_INDEPENDENT_REAUDIT.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 4D — Independent Migration SQL Security Re-Audit  
> **Auditor Role:** Senior PostgreSQL / Supabase Security Auditor  
> **Status:** AUDIT DELIVERABLE  
> **Final Verdict:** **PASS — READY FOR OWNER REVIEW**  

---

## 1. Executive Verdict

### **VERDICT: PASS — READY FOR OWNER REVIEW**

All six remediation items (R1–R6) from Phase 4B have been verified against the actual SQL migration files. The remediated codebase resolves the previous High and Medium severity findings:
1. **Storage Path Validation (R1):** Completely hardened against runtime UUID cast exceptions via canonical UUID regexes and SQL `CASE` short-circuit evaluation.
2. **Report Insertion Boundaries (R2):** Strictly locked to `status = 'submitted'` and `confirmed_priority IS NULL`.
3. **Technician Assignment Transitions (R3):** Split into two mutually exclusive policies, making decline from active work states impossible and protecting assignment metadata.
4. **Report Number Generation & Immutability (R4):** Unconditionally assigned from sequence on insert and guarded by a `BEFORE UPDATE` trigger preventing modification of `report_number` and `reporter_id`.
5. **Notification Updates (R5):** Restricted to `is_read` through column-level SQL privileges and row-level `WITH CHECK` expressions.
6. **Enum Idempotency (R6):** Wrapped in compatibility-verified `DO $$` blocks supporting replay while rejecting foreign type collisions.

**Critical Non-Execution Statement:**  
In strict compliance with Phase 4D constraints, **no SQL was executed, no migrations were applied, no database or Supabase connection was initiated, and no application source code was modified.** Static inspection and symbolic SQL analysis only were performed. This pass verdict confirms design and migration script readiness for owner review; it does not authorize execution.

---

## 2. Files and Migration Diffs Inspected

### Migration Files Inspected
1. [`supabase/migrations/20261018000001_core_schema.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000001_core_schema.sql) (270 lines, 8,970 bytes)
2. [`supabase/migrations/20261018000002_performance_indexes.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000002_performance_indexes.sql) (54 lines, 3,341 bytes)
3. [`supabase/migrations/20261018000003_triggers.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000003_triggers.sql) (181 lines, 6,056 bytes)
4. [`supabase/migrations/20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql) (178 lines, 5,830 bytes)
5. [`supabase/migrations/20261018000005_table_rls_policies.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql) (455 lines, 17,705 bytes)
6. [`supabase/migrations/20261018000006_storage_setup.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000006_storage_setup.sql) (154 lines, 7,267 bytes)

### Reference & Audit Documents Reviewed
- `docs/database-design/SCHEMA_PROPOSAL.md`
- `docs/database-design/RLS_POLICY_PROPOSAL.md`
- `docs/database-design/DATA_DICTIONARY.md`
- `docs/database-design/OPEN_DECISIONS.md`
- `docs/database-design/PHASE_4B_SQL_SECURITY_AUDIT.md`
- `docs/database-design/PHASE_4C_REMEDIATION_REVIEW.md`

### Git Diff Verification
- Verified working tree diffs using `git diff supabase/migrations/`.
- Confirmed that modifications occurred strictly on migrations `01`, `03`, `05`, and `06` to implement remediations R1–R6.

---

## 3. R1–R6 Independent Verification Table

| Remediation Item | Target Object & File | Verification Scope | Audit Result | Detailed Evaluation |
|---|---|---|:---:|---|
| **R1 — Safe Storage UUID Path Validation** | `storage_attachments_insert` on `storage.objects` (`06_storage_setup.sql`) | Path regex, UUID casting, short-circuit safety, path spoofing | **PASS** | Regex validates canonical UUID format for both report and attachment segments. `CASE` construct guarantees that if regex does not match, cast to `::uuid` is never evaluated, preventing unhandled 500 casting exceptions. `bucket_id` and role boundaries verified. |
| **R2 — Restrict Initial Report Values** | `reports_insert` on `public.reports` (`05_table_rls_policies.sql`) | Initial status, priority injection, reporter identity | **PASS** | `WITH CHECK` strictly enforces `reporter_id = auth.uid() AND status = 'submitted' AND confirmed_priority IS NULL`. Eliminates direct insertion into privileged statuses (`verified`, `in_progress`) or unauthorized priority assignment. |
| **R3 — Restrict Technician Assignment Transitions** | `assignments_update_technician_decline` and `assignments_update_technician_work` (`05_table_rls_policies.sql`) | Status transitions, decline boundaries, metadata tampering | **PASS** | Policy split eliminates the bypass vector: decline requires `USING (status = 'assigned')`; active work transitions require `WITH CHECK (decline_reason IS NULL)`. Both policies enforce equality checks against existing row values for `report_id`, `assigned_by`, `assigned_at`, and `notes`. |
| **R4 — Report Number & Reporter Immutability** | Trigger T2 & `trg_reports_immutable_cols` (`03_triggers.sql`) | Sequence generation, client override, update immutability | **PASS** | Trigger T2 unconditionally overwrites `NEW.report_number` from sequence `public.report_number_seq`. `trg_reports_immutable_cols` enforces that `report_number` and `reporter_id` cannot be modified under any UPDATE operation across all roles. |
| **R5 — Restrict Notification Updates** | `notifications_update_recipient` & column grants (`05_table_rls_policies.sql`) | Column-level privileges, payload tampering | **PASS** | `GRANT UPDATE (is_read) ON public.notifications TO authenticated;` restricts SQL statements to `is_read` at parser level. `WITH CHECK` enforces equality of all non-read columns against database values. |
| **R6 — Idempotent and Compatible Enum DDL** | 5 Custom Enums (`01_core_schema.sql`) | Replay safety, type collision, label compatibility | **PASS** | All five enums wrapped in `DO $$` blocks that create types if absent, or verify compatibility against sentinel approved labels if present. Clean replay supported; foreign collisions rejected. |

---

## 4. Analysis of R7 and R8

### R7 — Status History Duplication Analysis
- **Trigger T3 Behavior:** Trigger T3 (`record_status_history`) fires `AFTER UPDATE OF status ON public.reports`. It automatically inserts a history row into `report_status_history` with `changed_by = COALESCE(auth.uid(), NEW.reporter_id)` and `reason = NULL`.
- **Potential Duplication Vector:** In the application workflow, state transitions (such as holds, cancellations, or reopening) require a justification reason. If the client or server application inserts a history row containing a reason and subsequently updates `reports.status`, trigger T3 fires and inserts a second history entry with `reason = NULL`.
- **Auditor Evaluation & Recommendation:**
  - Trigger T3 fulfills a critical security requirement: an audit record is guaranteed even if the application fails to insert one.
  - For Phase 5 application architecture, the authoritative pattern is to manage state transitions via dedicated PostgreSQL stored procedures/RPCs (e.g. `transition_report_status`). The procedure can set a transaction-scoped flag `SET LOCAL cmirs.skip_history_trigger = 'true'` when inserting the reasoned history row, or trigger T3 can check if an entry for the same `(report_id, new_status)` was already committed in the current transaction.
  - **Status:** **INFORMATIONAL (Application Architecture Requirement for Phase 5)**. No SQL modification required in migration scripts.

### R8 — Authorization Freshness Analysis
- **Function Architecture:** `get_user_role()` is declared `STABLE`, with `SECURITY DEFINER` and `SET search_path = public, auth, pg_temp;`. It queries `public.profiles WHERE id = auth.uid()`.
- **Auditor Evaluation:**
  - Role checks query the authenticated caller's profile directly. Any administrative role change committed to `public.profiles` is immediately visible to the user's subsequent requests.
  - Rejecting session-level caching (e.g. `current_setting`) was the correct decision: in environments using connection poolers in transaction pooling mode (such as Supabase Supavisor / PgBouncer), session variables can persist across distinct transactions, introducing critical privilege-escalation and cross-tenant data leakage risks.
  - The `STABLE` declaration allows the planner to optimize multiple calls within a single statement without sacrificing inter-transaction freshness.
  - **Status:** **PASS (Confirmed Secure and Fresh)**.

---

## 5. Full Six-Migration Security Findings

| Finding ID | Severity | Migration File | Target Object | Impact & Scenario | Recommendation / Action |
|---|:---:|---|---|---|---|
| **SEC-01** | **INFORMATIONAL** | `01_core_schema.sql` | `assignments.chk_decline_reason` | The check constraint `status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != '')` allows `decline_reason` to be non-null when status is not `declined`. | Policy R3 explicitly enforces `decline_reason IS NULL` during active work transitions. The database-level constraint permits non-null values if not updated via R3. In Phase 5, consider strengthening constraint to enforce `decline_reason IS NULL` when `status != 'declined'`. |
| **SEC-02** | **INFORMATIONAL** | `04_security_functions_and_rpc.sql` | `soft_delete_attachment` | The RPC validates caller role (`coordinator`) and active status, but does not record a justification reason. | Approved decision OD-NEW-2 approved recording `deleted_at` and `deleted_by` without a reason column. If compliance mandates audit justifications, an optional reason column can be added post-MVP. |
| **SEC-03** | **INFORMATIONAL** | `05_table_rls_policies.sql` | `assignments_update_coordinator` | Coordinators can update assignments without an explicit status constraint in RLS. | Approved design grants coordinators full reassignment and cancellation authority. Coordinators should use server-side RPCs in Phase 5 to ensure reassignment notifications fire atomically. |
| **SEC-04** | **INFORMATIONAL** | `06_storage_setup.sql` | `storage.objects` | Unlinked storage binaries from aborted client uploads remain in the private bucket. | Addressed by approved background cleanup worker running under `service_role`. Private bucket RLS prevents unauthorized downloads of unlinked binaries. |

**No CRITICAL, HIGH, or MEDIUM severity findings remain.**

---

## 6. Requirements and Regression Checklist

| Requirement / Decision | Source | SQL Implementation Verification | Re-Audit Status |
|---|---|---|:---:|
| **RPT-000001 Report Numbering** | `PD-D4` | `report_number_seq` + trigger T2 (unconditional) + `prevent_report_immutable_col_update` | **PASS** |
| **Photo Upload Limits (5 active, 10MB, mime)** | `PD-D5` | `lock_attachment_count` (locks report row `FOR UPDATE`); `chk_file_size`; `chk_mime_type`; storage policies | **PASS** |
| **Self-Verification Prohibition** | `D2, PD-R4` | `verifications_insert_coordinator` checks `r.reporter_id != auth.uid()` and `a.technician_id != auth.uid()` | **PASS** |
| **Technician & Coordinator Work Holds** | `PD-W1` | `reports_update_technician_hold`, `assignments_update_technician_work` permit `in_progress <-> on_hold` | **PASS** |
| **Reporter Cancellation Boundary** | `PD-W2` | `reports_update_reporter_cancel` restricts cancellation to `submitted` or `under_review` | **PASS** |
| **Coordinator Cancellation Boundary** | `PD-W3` | `reports_update_coordinator` permits cancellation on all non-terminal reports | **PASS** |
| **Atomic Assignment Cancellation** | `PD-W4` | Documented transaction boundary; RLS permits coordinator bulk cancellation of active assignments | **PASS** |
| **Comment Immutability** | `PD-D3` | `report_comments` has no `updated_at`; UPDATE and DELETE denied to all roles | **PASS** |
| **Attachment Immutability & Soft Deletion** | `PD-D2, OD-NEW-2` | Direct UPDATE/DELETE denied; soft deletion exclusive to coordinator `soft_delete_attachment()` RPC | **PASS** |
| **Technician Visibility Scope** | `PD-R1, OD-NEW-4` | `can_view_report()` filters `assignments.status != 'declined'`; declined-only assignments excluded | **PASS** |
| **All 5 Roles Report Submission** | `PD-R6` | `reports_insert` permits all authenticated roles with initial value guards (R2) | **PASS** |
| **Non-Empty Decline Reason** | `OD-NEW-3, OD-REC-1` | `chk_decline_reason` with `btrim()`; `assignments_update_technician_decline` policy; `decline_assignment()` RPC | **PASS** |
| **Admin & Management Comment Access** | `OD-REC-2` | `report_comments_select` uses `can_view_report(report_id)`, granting oversight read access | **PASS** |
| **Private Storage Bucket & Hierarchy** | `OD-REC-3` | Bucket `report-attachments` private; canonical regex + `CASE` evaluation on `storage.objects` | **PASS** |

---

## 7. Static Validation Methods Performed and Limitations

### Methods Performed
1. **Symbolic AST & String Analysis:** Evaluated SQL clauses, `WITH CHECK` predicates, subquery scoping, and boolean operator evaluation trees.
2. **Deterministic Evaluation Analysis:** Verified that all type casts in RLS policies (`::uuid`) are protected by explicit control structures (`CASE`) that prevent unhandled execution on invalid inputs.
3. **Cross-Table Grant & Policy Matrix Reconciliation:** Reconciled table grants against row-level security policies across all 12 tables and 5 application roles.
4. **Idempotency & Replay Verification:** Analyzed DDL scripts for duplicate object collision safety on re-execution.

### Operational Limitations
- **Live Planner Benchmarks:** Query execution plans on multi-table joins in `can_view_report()` under massive production datasets (e.g. 500,000+ assignment rows) cannot be benchmarked without a live database.
- **Supabase Storage Extension Context:** The runtime existence of the `storage` schema and helper functions (`storage.foldername()`) must be confirmed during Phase 5 deployment.

---

## 8. Explicit Non-Execution Confirmation

- **No SQL commands were executed.**
- **No migrations were applied to any database.**
- **No connection to Supabase was made.**
- **No secrets, credentials, or environment files were read or modified.**
- **No application source code files were touched.**

---

## 9. Final Verdict

### **VERDICT: PASS — READY FOR OWNER REVIEW**

The CMIRS migration SQL suite (Migrations 1 through 6) is structurally sound, security-hardened, and fully reconciled against all 19 owner-approved decisions. All remediations from Phase 4B have been independently verified as effective and regression-free.

**Next Safe Step:** Submit the migration files and this re-audit report for final owner authorization before proceeding to Phase 5 (Migration Execution and Live Environment Verification).
