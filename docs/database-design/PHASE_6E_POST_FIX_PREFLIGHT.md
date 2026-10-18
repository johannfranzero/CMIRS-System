# CMIRS Phase 6E — Post-Fix Deployment Preflight

> **Document:** `docs/database-design/PHASE_6E_POST_FIX_PREFLIGHT.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 6E — Post-Fix Deployment Preflight  
> **Target Project Reference:** `xyirfifvcntuzceivtho` (`CMIRS-System`)  
> **Database Engine:** PostgreSQL `17.11.0.003` (Channel `ga`, Region `ap-southeast-1`)  
> **Execution Status:** **PREFLIGHT AUDIT COMPLETED — ZERO REMOTE OPERATIONS EXECUTED**  
> **Final Phase Verdict:** **READY FOR OWNER DEPLOYMENT APPROVAL**  

---

## 1. Executive Summary & Purpose

Phase 6E serves as the formal preflight review following the Phase 6D remediation of Migration 4 ([`20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql)).

In Phase 6C, Migrations 1, 2, and 3 were successfully applied and committed to the remote Supabase project `xyirfifvcntuzceivtho`. Migration 4 failed at statement 3 due to a PL/pgSQL variable collision with the PostgreSQL reserved keyword `CURRENT_ROLE`. In Phase 6D, the variable was renamed to `caller_role` across the affected functions.

This preflight report:
1. Validates the structural, security, and interface integrity of the corrected Migration 4.
2. Formulates an unexecuted, pure read-only remote inspection plan to detect any potential leftover objects from Migration 4.
3. Re-verifies cryptographic checksums for all six migration files.
4. Confirms that downstream dependencies in Migrations 5 and 6 remain 100% compatible.
5. Establishes the safe deployment protocol for owner authorization.

---

## 2. Comprehensive Audit of Corrected Migration 4

All four functions in [`20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql) were audited line by line:

```mermaid
graph TD
    subgraph "Corrected Migration 4 Architecture"
        F1["1. get_user_role()<br/>STABLE | SECURITY DEFINER<br/>search_path = public, auth, pg_temp<br/>Variable: caller_role"]
        F2["2. can_view_report(UUID)<br/>STABLE | SECURITY DEFINER<br/>search_path = public, auth, pg_temp<br/>Variable: caller_role"]
        F3["3. soft_delete_attachment(UUID)<br/>RPC | SECURITY DEFINER<br/>search_path = public, auth, pg_temp<br/>Variable: caller_role"]
        F4["4. decline_assignment(UUID, TEXT)<br/>RPC | SECURITY DEFINER<br/>search_path = public, auth, pg_temp<br/>Variable: caller_role"]
    end

    F1 --> F2
    F1 --> F3
    F1 --> F4
```

### 2.1 Function Specification Matrix

| Function / RPC | Return Type | Volatility | Security Definer? | Pinned Search Path | Execution Grants | Identifier Consistency |
|---|---|:---:|:---:|---|---|:---:|
| `public.get_user_role()` | `user_role` | `STABLE` | **YES** | `public, auth, pg_temp` | `REVOKE FROM PUBLIC; GRANT TO authenticated;` | `caller_role` **VERIFIED** |
| `public.can_view_report(UUID)` | `BOOLEAN` | `STABLE` | **YES** | `public, auth, pg_temp` | `REVOKE FROM PUBLIC; GRANT TO authenticated;` | `caller_role` **VERIFIED** |
| `public.soft_delete_attachment(UUID)` | `VOID` | `VOLATILE` | **YES** | `public, auth, pg_temp` | `REVOKE FROM PUBLIC; GRANT TO authenticated;` | `caller_role` **VERIFIED** |
| `public.decline_assignment(UUID, TEXT)` | `VOID` | `VOLATILE` | **YES** | `public, auth, pg_temp` | `REVOKE FROM PUBLIC; GRANT TO authenticated;` | `caller_role` **VERIFIED** |

### 2.2 Deep Security & Logic Verification
1. **`get_user_role()`:**
   - Queries `public.profiles.role` using `WHERE id = auth.uid()`.
   - Stores result into `caller_role` and returns it.
   - Marked `STABLE` so PostgreSQL can optimize multiple calls within a single statement (e.g., inside RLS policies).
2. **`can_view_report(report_id UUID)`:**
   - Evaluates `caller_role := public.get_user_role();`.
   - Branch 1 (Oversight): Grants access if `caller_role IN ('coordinator', 'administrator', 'management')`.
   - Branch 2 (Reporter): Grants access if `reporter_id = auth.uid()` on the target report, regardless of the reporter's role.
   - Branch 3 (Technician): Grants access if `caller_role = 'technician'` and caller holds an active assignment (`status != 'declined'`).
   - Default: Returns `FALSE`.
3. **`soft_delete_attachment(attachment_id UUID)`:**
   - Guards caller: strictly requires `caller_role = 'coordinator'`.
   - Validates existence and checks `deleted_at IS NOT NULL` before updating.
   - Performs audit update: `SET deleted_at = now(), deleted_by = auth.uid()`.
4. **`decline_assignment(target_assignment_id UUID, reason TEXT)`:**
   - Guards caller: strictly requires `caller_role = 'technician'`.
   - Validates `reason IS NOT NULL AND btrim(reason) != ''`.
   - Validates technician ownership: `curr_tech_id = auth.uid()`.
   - Validates state transition: `curr_status = 'assigned'`.
   - Performs assignment transition: `SET status = 'declined', decline_reason = reason`.

---

## 3. Cryptographic Checksum Baseline Audit

A full SHA-256 hash recalculation was executed locally across all six migration files:

```powershell
Get-FileHash supabase/migrations/*.sql -Algorithm SHA256
```

| Migration File | Current SHA-256 Checksum | Baseline Status | Notes |
|---|---|:---:|---|
| [`20261018000001_core_schema.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000001_core_schema.sql) | `3CA8111D309334AD842D1BA65E4D642F23D42EFF02863D528196A80855B63BCF` | **UNMODIFIED** | Applied & committed remotely. |
| [`20261018000002_performance_indexes.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000002_performance_indexes.sql) | `1184B97E1FDC7B42487C8EA4D8B4E767506A1EF9ABA0032AE625ACA1767D01FC` | **UNMODIFIED** | Applied & committed remotely. |
| [`20261018000003_triggers.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000003_triggers.sql) | `858CF347752152A517D6EF68E726EA5401ACEDB57672CD34E43D79C9285B2254` | **UNMODIFIED** | Applied & committed remotely. |
| [`20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql) | `DDB4039A9D35974E6FC89DF613180AAE56090B4384113427C0A5E19E9E62EFEE` | **REMEDIATED** | Previous hash `FFD5A221...` superseded. |
| [`20261018000005_table_rls_policies.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql) | `76E42398817FF61385B884C2548BDCECFF6FEBED125F115BB024BFBE98B9C42C` | **UNMODIFIED** | Pending remote execution. |
| [`20261018000006_storage_setup.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000006_storage_setup.sql) | `38610E66A59620FFCF11414F533C1B19552514E27209EE01EF1035D0684B20AF` | **UNMODIFIED** | Pending remote execution. |

---

## 4. Analysis of Rollback Evidence & Limitations

### 4.1 Supporting Evidence for Migration 4 Rollback
The conclusion that Migration 4 rolled back rests on the following physical evidence recorded in Phase 6C:
1. **CLI Halt & Error Exit:** `npx supabase db push` aborted with exit code `1` and JSON payload `DbPushApplyError: ERROR: syntax error at or near "current_role" (SQLSTATE 42601)`.
2. **Remote Migration History Table:** Inspection via `npx supabase migration list --linked` showed:
   ```json
   {"local": "20261018000004", "remote": "", "time": "2026-10-18 00:00:04"}
   ```
   Version `20261018000004` is absent from `supabase_migrations.schema_migrations`.
3. **PostgreSQL Transactional DDL:** In PostgreSQL, DDL executed inside an aborted transaction block (`BEGIN ... ROLLBACK`) is undone in its entirety.

### 4.2 Engineering Caveats: Why Full Absence Cannot Be Assumed
It is unsafe in database engineering to **assume** zero leftover objects based solely on a CLI error:
- If individual statements within the migration file were executed in autocommit mode, Statement 1 (`CREATE OR REPLACE FUNCTION public.get_user_role`) and Statement 2 (`REVOKE/GRANT`) could have committed prior to the Statement 3 failure.
- If an object existed prior to migration execution (e.g. from an unrecorded schema session), the failed push would leave it untouched.
- Therefore, the actual remote presence or absence of functions must be verified or accounted for.

### 4.3 Safeguard: Idempotency of `CREATE OR REPLACE`
Even if `get_user_role()` or any other function partially persisted:
- Every function in [`20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql) uses `CREATE OR REPLACE FUNCTION`.
- `CREATE OR REPLACE FUNCTION` replaces any existing function with identical signature and argument types in-place without generating a duplicate object error.
- All subsequent `REVOKE` and `GRANT` statements are idempotent.
- **Conclusion:** Leftover objects from Migration 4, whether present or absent, will not cause migration conflicts or deployment failure.

---

## 5. Read-Only Remote Inspection Plan for Leftover Objects

The following read-only SQL inspection script has been prepared to inspect the remote database for any residual functions or grants from Migration 4.

> [!IMPORTANT]
> In accordance with Phase 6E strict boundaries, this script has **not** been executed against the remote database. It is provided here for pre-deployment audit verification or manual execution in the Supabase Dashboard SQL Editor if desired by the owner.

```sql
-- =============================================================================
-- CMIRS Phase 6E: Safe, Read-Only Migration 4 Residual Object Audit
-- (100% Read-Only: Zero DDL, Zero DML, Pure Catalog Inspection)
-- =============================================================================

-- 1. Check applied migration records in schema_migrations
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version ASC;

-- 2. Inspect pg_proc for Migration 4 function signatures in the public schema
SELECT 
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS argument_types,
  pg_get_function_result(p.oid) AS return_type,
  p.prosecdef AS is_security_definer,
  array_to_string(p.proconfig, ', ') AS search_path_config,
  r.rolname AS function_owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_user_role',
    'can_view_report',
    'soft_delete_attachment',
    'decline_assignment'
  );

-- 3. Inspect routine execution grants in information_schema
SELECT 
  routine_schema,
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'get_user_role',
    'can_view_report',
    'soft_delete_attachment',
    'decline_assignment'
  );
```

---

## 6. Downstream Dependency Verification (Migrations 5 and 6)

The corrected Migration 4 was cross-referenced against the exact dependency calls in Migrations 5 and 6:

### 6.1 Migration 5: `20261018000005_table_rls_policies.sql`
- **Calls to `public.get_user_role()`:** 18 distinct policy clauses across `profiles`, `role_change_audit`, `categories`, `locations`, `reports`, `assignments`, `report_comments`, `work_logs`, and `verifications`.
- **Calls to `public.can_view_report(id)`:** Used as the central visibility predicate in policy `reports_select` ([05_table_rls_policies.sql:L131-L136](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql#L131-L136)).
- **Compatibility:** The function signatures (`get_user_role() RETURNS user_role` and `can_view_report(UUID) RETURNS BOOLEAN`) were completely preserved. Migration 5 is 100% compatible.

### 6.2 Migration 6: `20261018000006_storage_setup.sql`
- **Calls to `public.get_user_role()`:** Used in `storage_attachments_select` (lines 39, 43, 55) and `storage_attachments_insert` (lines 84, 100, 115).
- **Calls to `public.can_view_report(ra.report_id)`:** Used in `storage_attachments_select` (line 60) for technician download authorization.
- **Compatibility:** The interface is 100% identical. Migration 6 is 100% compatible.

---

## 7. Verified Facts vs. Assumptions Matrix

| Topic | Verified Fact (Proven by Independent Audit) | Assumption / Unverified Runtime |
|---|---|---|
| **Local File State** | Migration 4 has been corrected locally (`current_role` → `caller_role`); hash is `DDB4039A...`. Hashes 1–3, 5, 6 are identical to original. | Assumed that local files will not be altered prior to push. |
| **Remote Database Version** | PostgreSQL `17.11.0.003` (GA channel, Singapore). | None (verified via CLI project list). |
| **Remote Applied Migrations** | Migrations 1, 2, and 3 are recorded as applied in `supabase_migrations.schema_migrations`. | Assumed that remote project has remained untouched since Phase 6C. |
| **Remote Pending Migrations** | Migrations 4, 5, and 6 are pending (`remote: ""`). | None (verified via Phase 6C post-error inspection). |
| **Migration 4 Object Presence** | `can_view_report` was never compiled due to SQLSTATE 42601 syntax error. | Whether `get_user_role` was discarded by transaction abort or persists is unverified until catalog inspection, but completely mitigated by `CREATE OR REPLACE`. |
| **RLS & Storage Enforcement** | No RLS policies or Storage buckets exist yet on the remote database. | Runtime RLS policy behavior remains unverified until Gate E live testing. |

---

## 8. Deployment Protocol for Phase 6F

When the owner authorizes deployment resumption:
1. **Verification Command:**
   ```powershell
   npx supabase migration list --linked
   ```
   *Expected:* 1–3 applied; 4–6 pending.
2. **Push Command:**
   ```powershell
   npx supabase db push --yes
   ```
   *Expected:* Applies 4 (`security_functions_and_rpc`), 5 (`table_rls_policies`), and 6 (`storage_setup`), exiting with code `0`.
3. **Post-Push Catalog Audit (Gate D):**
   Execute [`supabase/tests/PHASE_5J_CATALOG_AUDIT.sql`](file:///d:/CMIRS-System/my-app/supabase/tests/PHASE_5J_CATALOG_AUDIT.sql) in the Supabase Dashboard SQL Editor to verify all 12 tables, 5 enums, 1 sequence, 27 indexes, 7 triggers, 10 functions, 33 RLS policies, and 1 storage bucket.

---

## 9. Final Preflight Verdict

```text
================================================================================
FINAL VERDICT: READY FOR OWNER DEPLOYMENT APPROVAL
================================================================================
```

**Verdict Rationale:**
1. The reserved keyword defect in Migration 4 has been verified as remediated with zero side effects.
2. All function signatures, `SECURITY DEFINER` settings, search path pins, and grants are verified.
3. Cryptographic checksums are recorded; Migrations 1–3, 5, and 6 remain untouched.
4. Downstream dependencies in Migrations 5 and 6 are verified as 100% consistent with the corrected Migration 4.
5. Idempotent `CREATE OR REPLACE FUNCTION` semantics completely mitigate any risk of leftover partial objects from the initial Migration 4 push attempt.
6. A safe read-only catalog inspection query has been formulated.

---
*Preflight audit complete. All local and remote boundaries preserved. Stopped and awaiting explicit owner authorization to deploy Migrations 4, 5, and 6.*
