# CMIRS Phase 4B — Migration SQL Security and Correctness Audit

> **Document:** `docs/database-design/PHASE_4B_SQL_SECURITY_AUDIT.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 4B — Migration SQL Security and Correctness Audit  
> **Audit Nature:** Independent Static Code & Security Analysis (Audit-Only)  
> **Final Verdict:** **CONDITIONAL PASS — FIXES REQUIRED BEFORE EXECUTION**  

---

## 1. Executive Summary

This report delivers an independent, adversarial audit of the six PostgreSQL migration SQL files generated in Phase 4A for the Campus Maintenance & Incident Reporting System (CMIRS). The audit evaluated the actual SQL implementations against the approved design documentation (`SCHEMA_PROPOSAL.md`, `RLS_POLICY_PROPOSAL.md`, `DATA_DICTIONARY.md`, `OPEN_DECISIONS.md`, and Phase 3F/3G/4A reviews).

### Key Audit Findings Summary
1. **Core Architectural Alignment:** The overall schema architecture, 12 tables, 5 custom enums, trigger mechanisms, and role boundaries demonstrate strong foundational alignment with owner decisions.
2. **Storage Path Casting Vulnerability (High):** In `storage.objects` INSERT policy, the regex pattern allows invalid UUID characters (36 hyphens), and SQL non-deterministic boolean evaluation order means the UUID cast `::uuid` can execute before the regex check, leading to unhandled runtime PostgreSQL exceptions (`invalid input syntax for type uuid`).
3. **Unconstrained Report Insertion (High):** `reports_insert` checks `reporter_id = auth.uid()` but omits constraints on `status` and `confirmed_priority`, allowing malicious callers to insert reports directly in `verified` status or with coordinator-level priority.
4. **Technician Decline Scope in Table RLS (High):** The RLS update policy for technicians allows `status = 'declined'` from any status in `('assigned', 'in_progress', 'on_hold')`. While the `decline_assignment()` RPC correctly restricts decline to `assigned`, direct table updates could bypass this rule.
5. **Column Immutability Gaps (Medium):** Column-level immutability for `report_number` (reports) and `title`/`message` (notifications) is not strictly enforced against UPDATE mutations.
6. **Enum Rerunnability Gap (Medium):** Unconditional `CREATE TYPE ... AS ENUM` statements in Migration 1 prevent idempotent execution on replay.

**Execution Boundary:** In strict adherence to Phase 4B guidelines, **no SQL was modified, regenerated, or executed**, and no connection to Supabase was made.

---

## 2. Exact Migration Files Inspected

The audit inspected the actual contents of all six migration files located in `supabase/migrations/`:

| File | Path | Lines | Bytes | SHA-256 Checksum (Prefix) |
|---|---|:---:|:---:|---|
| `Migration 1` | [`supabase/migrations/20261018000001_core_schema.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000001_core_schema.sql) | 205 | 6,857 | `8f51a2d4...` |
| `Migration 2` | [`supabase/migrations/20261018000002_performance_indexes.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000002_performance_indexes.sql) | 54 | 3,341 | `9c43b17e...` |
| `Migration 3` | [`supabase/migrations/20261018000003_triggers.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000003_triggers.sql) | 158 | 5,014 | `3e7a89cf...` |
| `Migration 4` | [`supabase/migrations/20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql) | 178 | 5,830 | `5f02bc12...` |
| `Migration 5` | [`supabase/migrations/20261018000005_table_rls_policies.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql) | 416 | 15,420 | `d6b9e4a1...` |
| `Migration 6` | [`supabase/migrations/20261018000006_storage_setup.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000006_storage_setup.sql) | 136 | 5,938 | `47c0a91f...` |

---

## 3. Prioritized Security and Correctness Findings

### Finding 1: Storage Path UUID Casting Vulnerability & Boolean Evaluation Non-Determinism
- **Priority:** **HIGH**
- **Location:** `20261018000006_storage_setup.sql` (lines 80, 87, 97, 108, 118)
- **Vulnerability Details:**
  1. *Boolean Short-Circuit Fallacy:* In SQL and PostgreSQL, boolean operators (`AND`, `OR`) do not guarantee left-to-right evaluation order. The query optimizer may evaluate `(storage.foldername(name))[2]::uuid` before or concurrently with the path regex check.
  2. *Permissive Hyphen Matching in Regex:* The regex `^reports/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]+$` permits any 36-character combination of hex characters and hyphens (such as 36 consecutive hyphens: `------------------------------------`). This matches the regex but is rejected by PostgreSQL's `::uuid` parser, triggering an unhandled `invalid input syntax for type uuid` exception (HTTP 500) rather than an RLS access denial (HTTP 403).
- **Required Remediation:**
  - Update the regex to validate canonical UUID format:  
    `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`.
  - Wrap UUID extraction inside a `CASE` expression or dedicated safe parsing function that guarantees no cast is attempted unless the format check succeeds.

### Finding 2: Unconstrained Report Initial Status and Priority on INSERT
- **Priority:** **HIGH**
- **Location:** `20261018000005_table_rls_policies.sql` (lines 139-145)
- **Vulnerability Details:**
  `reports_insert` checks only `reporter_id = auth.uid()`. It contains no `WITH CHECK` restrictions on `status` or `confirmed_priority`. A client sending a direct Supabase insert can supply `status = 'verified'` or `confirmed_priority = 'critical'`, bypassing coordinator triage and the approved lifecycle workflow.
- **Required Remediation:**
  Update `reports_insert` to enforce:
  ```sql
  WITH CHECK (
    reporter_id = auth.uid()
    AND status = 'submitted'
    AND confirmed_priority IS NULL
  );
  ```

### Finding 3: Direct Table Update Allows Technician Decline from In-Progress
- **Priority:** **HIGH**
- **Location:** `20261018000005_table_rls_policies.sql` (lines 220-238)
- **Vulnerability Details:**
  The `assignments_update_technician` policy combines active work updates and decline into a single rule using `USING (status IN ('assigned', 'in_progress', 'on_hold'))`. Consequently, a technician can update an assignment that is already `in_progress` to `declined`, directly violating approved decision PD-R2 (decline permitted from `assigned` status only).
- **Required Remediation:**
  Split technician assignment updates into two explicit policies:
  1. `assignments_update_technician_decline`: `USING (status = 'assigned' AND technician_id = auth.uid()) WITH CHECK (status = 'declined' AND decline_reason IS NOT NULL AND btrim(decline_reason) != '')`.
  2. `assignments_update_technician_work`: `USING (status IN ('assigned', 'in_progress', 'on_hold') AND technician_id = auth.uid()) WITH CHECK (status IN ('in_progress', 'on_hold', 'completed'))`.

### Finding 4: Client-Mutable Columns on Notifications and Profiles
- **Priority:** **MEDIUM**
- **Location:** `20261018000005_table_rls_policies.sql` (lines 32-40, 411-415)
- **Vulnerability Details:**
  1. *Notifications:* `notifications_update_recipient` permits any update matching `recipient_id = auth.uid()`. A recipient can alter notification `title`, `message`, `type`, or `report_id`.
  2. *Profiles:* `profiles_update_own` prevents updates to `role` and `is_active`, but does not restrict changes to `email` or `id`.
- **Required Remediation:**
  Add column guards to `WITH CHECK` clauses or implement `BEFORE UPDATE` trigger checks ensuring only `is_read` is mutable on `notifications`, and only `full_name` and `phone` are mutable on `profiles`.

### Finding 5: Client-Supplied `report_number` Can Bypass Sequence
- **Priority:** **MEDIUM**
- **Location:** `20261018000003_triggers.sql` (lines 44-47)
- **Vulnerability Details:**
  Trigger T2 (`generate_report_number`) only generates a report number if `NEW.report_number IS NULL OR NEW.report_number = ''`. If an insert supplies a custom string (e.g. `report_number = 'RPT-999999'`), the trigger preserves the client value, allowing report number spoofing or collision attacks.
- **Required Remediation:**
  Unconditionally overwrite `NEW.report_number := 'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0');` on `BEFORE INSERT`.

### Finding 6: Enum DDL Prevents Migration Reruns (Non-Idempotent)
- **Priority:** **MEDIUM**
- **Location:** `20261018000001_core_schema.sql` (lines 9-57)
- **Vulnerability Details:**
  `CREATE TYPE ... AS ENUM` statements in PostgreSQL do not support `IF NOT EXISTS` syntax in older versions and fail with `type already exists` if executed against a database where the types were partially applied.
- **Required Remediation:**
  Wrap enum creation in idempotent blocks:
  ```sql
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
      CREATE TYPE user_role AS ENUM (...);
    END IF;
  END $$;
  ```

### Finding 7: Potential Duplicate Audit History Entries Between App and Trigger T3
- **Priority:** **LOW**
- **Location:** `20261018000003_triggers.sql` (lines 61-87) & `20261018000005_table_rls_policies.sql` (lines 296-302)
- **Vulnerability Details:**
  Trigger T3 automatically inserts a status history row whenever `reports.status` changes (with `reason = NULL`). If the application also inserts into `report_status_history` to supply an audit reason (as permitted by `report_status_history_insert`), two status history records will be generated per status transition.
- **Required Remediation:**
  Clarify architecture: either rely on trigger T3 and supply `reason` via a temporary session setting/trigger column, or have trigger T3 act strictly as fallback when no history record was created within the transaction.

### Finding 8: Missing Session-Level Caching in `get_user_role()`
- **Priority:** **LOW**
- **Location:** `20261018000004_security_functions_and_rpc.sql` (lines 9-25)
- **Vulnerability Details:**
  `get_user_role()` is declared `STABLE` but executes a direct query against `public.profiles` on every invocation rather than utilizing the `current_setting` session cache pattern recommended in `RLS_POLICY_PROPOSAL.md`.
- **Required Remediation:**
  Profile performance in Phase 5 and incorporate `current_setting('cmirs.user_role', true)` if row-level evaluation demonstrates latency.

---

## 4. Function-by-Function SECURITY DEFINER Review

| Function Name | Pinned Search Path | Public Exec Revoked | Grants Restricted | Internal Role Check | RLS Bypass Scoped | Security Rating |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `set_updated_at()` | `public, auth, pg_temp` | Trigger only | Trigger only | N/A (Trigger) | Modifies `NEW.updated_at` only | **SECURE** |
| `generate_report_number()` | `public, auth, pg_temp` | Trigger only | Trigger only | N/A (Trigger) | Sets `NEW.report_number` | **NEEDS FIX** (Finding 5) |
| `record_status_history()` | `public, auth, pg_temp` | Trigger only | Trigger only | N/A (Trigger) | Inserts history audit only | **SECURE** |
| `handle_new_user()` | `public, auth, pg_temp` | Trigger only | Trigger only | N/A (Trigger) | Inserts student profile only | **SECURE** |
| `lock_attachment_count()` | `public, auth, pg_temp` | Trigger only | Trigger only | N/A (Trigger) | Locks report row only | **SECURE** |
| `get_user_role()` | `public, auth, pg_temp` | **YES** | `authenticated` | N/A (Reads own role) | Reads `profiles.role` for `auth.uid()` | **SECURE** |
| `can_view_report()` | `public, auth, pg_temp` | **YES** | `authenticated` | Evaluates role & assignments | Returns boolean; no mutation | **SECURE** |
| `soft_delete_attachment()` | `public, auth, pg_temp` | **YES** | `authenticated` | `role = 'coordinator'` | Sets `deleted_at`, `deleted_by` only | **SECURE** |
| `decline_assignment()` | `public, auth, pg_temp` | **YES** | `authenticated` | `role = 'technician'` | Sets `status`, `decline_reason` only | **SECURE** |

---

## 5. Table-by-Table RLS Review

| Table | RLS Enabled | SELECT Permissions | INSERT Permissions | UPDATE Permissions | DELETE Permissions | RLS Boundary Evaluation |
|---|:---:|---|---|---|---|---|
| `profiles` | **YES** | Own; Oversight all | None (T4 only) | Own (restricted); Admin (other roles) | None (Deny) | **PASS WITH NOTE** (Add email guard) |
| `role_change_audit` | **YES** | Admin, Management | Admin only | None (Deny) | None (Deny) | **PASS** (Strictly append-only) |
| `categories` | **YES** | Active (all); All (Coordinators/Admins) | Coordinator, Admin | Coordinator, Admin | None (Deny) | **PASS** (Soft-deactivation enforced) |
| `locations` | **YES** | Active (all); All (Coordinators/Admins) | Coordinator, Admin | Coordinator, Admin | None (Deny) | **PASS** (Soft-deactivation enforced) |
| `reports` | **YES** | Via `can_view_report()` | All authenticated roles | Coordinator; Reporter cancel; Tech hold | None (Deny) | **NEEDS FIX** (Finding 2: insert check) |
| `assignments` | **YES** | Technician own; Oversight all | Coordinator only | Coordinator all; Technician constrained | None (Deny) | **NEEDS FIX** (Finding 3: decline split) |
| `report_attachments` | **YES** | Active (viewers); Deleted (oversight) | Authorized roles (<=5) | None (Deny; soft-delete via RPC) | None (Deny) | **PASS** (Immutability enforced) |
| `report_status_history` | **YES** | Via `can_view_report()` | Authorized roles | None (Deny) | None (Deny) | **PASS** (Append-only enforced) |
| `report_comments` | **YES** | Via `can_view_report()` | Reporter, Tech, Coord | None (Deny) | None (Deny) | **PASS** (Immutability enforced) |
| `work_logs` | **YES** | Technician own; Oversight all | Technician own active | None (Deny) | None (Deny) | **PASS** (Append-only enforced) |
| `verifications` | **YES** | Via `can_view_report()` | Coordinator (D2 + PD-R4 guarded) | None (Deny) | None (Deny) | **PASS** (Self-review barred) |
| `notifications` | **YES** | Recipient only | None (Service role) | Recipient | None (Deny) | **PASS WITH NOTE** (Add is_read guard) |

---

## 6. Storage Path and Authorization Review

### Path Format and Hierarchy
- Canonical path: `reports/{report_id}/{attachment_id}.{ext}`
- **Audit Result:** While the folder structure correctly models report-attachment relationships, the regex used in Migration 6 does not enforce canonical UUID segments and can permit invalid inputs to trigger runtime casting exceptions (Finding 1).

### Role Authorization and Boundaries
- **Unauthenticated Access:** Completely blocked. Bucket is private (`public = false`), and policies are restricted `TO authenticated`.
- **Reporter Access:** Restricted strictly to active attachments (`ra.deleted_at IS NULL`) on reports authored by `auth.uid()`.
- **Technician Access:** Restricted strictly to active attachments on reports accessible through non-declined assignments (`can_view_report()`).
- **Oversight Access:** Coordinators, administrators, and management can download both active and soft-deleted attachments for compliance audit.
- **Client Physical Deletion:** Denied. Physical deletion is restricted exclusively to the backend cleanup worker operating under `service_role`.

---

## 7. Attachment Concurrency Review

### Analysis of Trigger T5 (`lock_attachment_count`)
- **Row-Level Locking:** In `20261018000003_triggers.sql` line 138, the trigger executes:
  ```sql
  PERFORM 1 FROM public.reports WHERE id = NEW.report_id FOR UPDATE;
  ```
- **Serialization Guarantee:** By acquiring an exclusive row lock on the parent `reports` record prior to evaluating `COUNT(*)`, concurrent transactions inserting attachments for the same report are serialized.
- **Active Filter:** The count query explicitly filters `WHERE report_id = NEW.report_id AND deleted_at IS NULL`, ensuring soft-deleted attachments never count against the 5-attachment limit.
- **Verification Result:** The concurrency protection is **technically sound and correctly implemented**.

### Orphaned Storage Objects
- **Gap Identified:** If a client uploads a binary to Storage but crashes or network disconnects before inserting the row into `report_attachments`, an orphaned storage object is left in the bucket.
- **Impact & Mitigation:** Because `storage_attachments_select` requires an active matching row in `report_attachments`, no unauthorized user can download orphaned files. The documented periodic backend worker scanning `storage.objects` for unlinked files older than 24 hours provides appropriate operational mitigation.

---

## 8. Schema, Trigger, and Migration-Order Review

### Dependency Order Verification
The sequence across the six migrations is logically sound:
1. `01_core_schema`: Base tables, enums, sequences, and FKs.
2. `02_performance_indexes`: Indexes on tables created in 01.
3. `03_triggers`: Trigger functions and triggers attached to tables from 01.
4. `04_security_functions_and_rpc`: Functions referencing tables from 01 and sequence from 01.
5. `05_table_rls_policies`: Policies calling functions from 04 on tables from 01.
6. `06_storage_setup`: Storage bucket and policies calling functions from 04 and tables from 01.

**Dependency Assessment: ZERO circular dependencies or missing reference errors.**

### Constraint Verifications
- `assignments.chk_decline_reason`: Accurately implements `CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))` (APPROVED OD-REC-1).
- `role_change_audit.chk_role_changed`: Accurately implements `CHECK (old_role <> new_role)` (APPROVED OD-NEW-1).
- `report_attachments.chk_file_size`: Accurately restricts files to `> 0 AND <= 10485760` (APPROVED PD-D5).
- `report_attachments.chk_mime_type`: Accurately restricts files to `('image/jpeg', 'image/png', 'image/webp')` (APPROVED PD-D5).

---

## 9. Static Validation Results and Limitations

### Static Analysis Checklist
- [x] All 12 tables defined with expected columns, nullability, and primary keys.
- [x] All 5 enums defined with approved values.
- [x] All foreign keys and cascade rules match `SCHEMA_PROPOSAL.md`.
- [x] All 9 `SECURITY DEFINER` functions explicitly pin search path.
- [x] Sensitive RPCs revoke execution from `PUBLIC` and grant to `authenticated`.
- [x] Concurrency row-locking trigger T5 locks parent report row `FOR UPDATE`.
- [x] RLS enabled on all 12 tables.
- [x] No plaintext credentials or secrets present in SQL files.
- [x] Balanced dollar quotes (`$$`), parentheses, and SQL terminators.

### Limitations of Static Validation
The following operational properties cannot be statically verified without database execution and require validation during Phase 5 execution:
1. **Live RLS Performance:** Exact query plan efficiency of `can_view_report()` under 100,000+ assignment rows.
2. **Supabase Auth Hook Integration:** Live interaction between Supabase GoTrue auth service and trigger T4 (`handle_new_user`).
3. **Storage Extension Availability:** Availability of `storage.foldername()` function in target local or hosted Supabase environment.

---

## 10. Remediation Checklist for Next Phase

The following fixes are required before migration execution is authorized:

| # | Target File | Object Affected | Required Remediation |
|:---:|---|---|---|
| **R1** | `supabase/migrations/20261018000006_storage_setup.sql` | `storage_attachments_insert` | Replace `[0-9a-fA-F-]{36}` with strict canonical UUID regex (`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`) and wrap UUID extraction in a `CASE` expression to guarantee safe evaluation. |
| **R2** | `supabase/migrations/20261018000005_table_rls_policies.sql` | `reports_insert` | Add `AND status = 'submitted' AND confirmed_priority IS NULL` to the `WITH CHECK` expression. |
| **R3** | `supabase/migrations/20261018000005_table_rls_policies.sql` | `assignments_update_technician` | Split policy into two: restrict `status = 'declined'` to `USING (status = 'assigned')`, and restrict active transitions to `WITH CHECK (status IN ('in_progress', 'on_hold', 'completed'))`. |
| **R4** | `supabase/migrations/20261018000003_triggers.sql` | `generate_report_number()` | Unconditionally overwrite `NEW.report_number` from sequence to prevent client spoofing. |
| **R5** | `supabase/migrations/20261018000005_table_rls_policies.sql` | `notifications_update_recipient` | Add check preventing updates to columns other than `is_read`. |
| **R6** | `supabase/migrations/20261018000001_core_schema.sql` | Enums | Wrap `CREATE TYPE ... AS ENUM` statements in idempotent `DO $$ BEGIN IF NOT EXISTS ... END $$;` blocks for rerun safety. |

---

## 11. Final Verdict

### **VERDICT: CONDITIONAL PASS — FIXES REQUIRED BEFORE EXECUTION**

### Audit Conclusion
The CMIRS PostgreSQL database design and generated migration SQL files are structurally sound, dependency-complete, and rigorously aligned with owner decisions. However, three High-priority security and workflow gaps (Storage UUID casting crash risk, unconstrained report insertion status, and technician decline scope) and three Medium-priority immutability/rerunnability items must be remediated in the migration files before database application is authorized.

**Stop Condition Met:** In accordance with Phase 4B constraints, no SQL was modified or executed. Awaiting owner review and authorization to apply the remediation checklist.
