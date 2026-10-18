# CMIRS Phase 5B — Local Migration Execution Plan

> **Document:** `docs/database-design/PHASE_5B_LOCAL_EXECUTION_PLAN.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 5B — Local Migration Execution Readiness and Test Run  
> **Role:** PostgreSQL / Supabase Lead QA & Database Engineer  
> **Status:** EXECUTION PLAN DELIVERABLE (PLANNING ONLY)  
> **Execution Status:** **UNEXECUTED — NO DATABASE EXECUTION AUTHORIZED**  

---

## 1. Objective and Authorization Boundary

This document defines the strict, fail-safe execution protocol for applying the six CMIRS migrations and running the 45 verification tests on a **disposable local development instance**.

> [!CAUTION]
> **CRITICAL BOUNDARY ENFORCEMENT**  
> Creating this execution plan **DOES NOT authorize executing migrations, connecting to Supabase, or starting database services**. In strict compliance with owner instructions:
> 1. Remote Supabase projects (`*.supabase.co`, `*.pooler.supabase.com`) are strictly prohibited from connection.
> 2. No SQL commands, migrations, or tests may be executed until the owner reviews this plan and explicitly grants Phase 5B execution sign-off.
> 3. No secrets or connection strings may be printed or logged.
> 4. All test cases in this plan remain designated **`NOT RUN`**.

---

## 2. Environment Inspection Findings & Prerequisites

A static, read-only inspection of the local environment performed in Phase 5B yielded the following findings:

### 2.1 Tooling & Runtime Status
| Tool / Component | Inspected State | Evaluation & Impact |
|---|---|---|
| **Supabase CLI** | `npx supabase --version` = `2.121.0` | **AVAILABLE:** Supabase CLI is available via npm/npx without global installation. |
| **Docker Engine** | `docker: The term 'docker' is not recognized...` | **PREREQUISITE REQUIRED:** Docker Desktop or an OCI container runtime is not currently installed or in PATH on this Windows host. |
| **Local PostgreSQL** | No Windows PostgreSQL service running | **PREREQUISITE REQUIRED:** A local PostgreSQL 15/16 instance on `127.0.0.1` is not currently active. |
| **Project Configuration** | `supabase/config.toml` not yet initialized | **EXPECTED:** `supabase init` has not been run; migrations are stored in `supabase/migrations/`. |

### 2.2 Environmental Prerequisite Resolution Options
Before local execution can be authorized by the owner, one of the following two local runtime options must be provided:
- **Option A (Standard Supabase CLI Stack):** Install and start Docker Desktop for Windows. Once Docker is running, `npx supabase start` will instantiate the full containerized Supabase stack (PostgreSQL 15, GoTrue Auth, Storage API, PostgREST) on `127.0.0.1:54321`.
- **Option B (Standalone Local PostgreSQL):** Install or launch an ephemeral local PostgreSQL 15/16 instance listening on `127.0.0.1:5432` with extensions enabled, allowing `psql` to execute the migration suite and transaction-rollback test harness.

---

## 3. Remote Connection Prevention Protocols (Fail-Fast Guards)

To prevent accidental connections to remote staging or production environments, the execution harness must enforce the following four mandatory safeguards:

```mermaid
graph TD
    A[Start Execution Script] --> B{Check DATABASE_URL}
    B -->|Contains supabase.co or pooler| C[HARD ABORT: Remote Target Detected]
    B -->|Empty or localhost/127.0.0.1| D{Check SUPABASE_PROJECT_REF}
    D -->|Set to Remote Ref| E[HARD ABORT: Remote Project Ref Set]
    D -->|Unset or 'local'| F{Check Port 5432/54322 Binding}
    F -->|Bound to 127.0.0.1| G[ALLOW EXECUTION: Local Disposable Instance]
    F -->|Non-Local IP| H[HARD ABORT: Foreign Network Target]
```

### 3.1 Pre-Execution Fail-Fast Shell Guard
Prior to running any migration command, the operator must execute this environment isolation check:

```powershell
# PowerShell Environment Isolation Guard
$dbUrl = $env:DATABASE_URL
if ($dbUrl -match "supabase\.co" -or $dbUrl -match "pooler\.supabase\.com") {
    Write-Error "CRITICAL SECURITY ABORT: DATABASE_URL points to a remote Supabase project! Execution terminated."
    exit 1
}

if ($env:SUPABASE_PROJECT_REF -and $env:SUPABASE_PROJECT_REF -ne "local") {
    Write-Error "CRITICAL SECURITY ABORT: SUPABASE_PROJECT_REF is set to a remote project ($env:SUPABASE_PROJECT_REF)! Execution terminated."
    exit 1
}

Write-Host "ENVIRONMENT GUARD PASSED: Connection target verified as local development tier."
```

---

## 4. Cryptographic Migration Hash Verification

Before applying migrations, verify that the local migration files match the audited SHA-256 checksums exactly:

| Sequence | Migration File Name | SHA-256 Checksum (Full) | Lines | Hash Verification Status |
|:---:|---|---|:---:|:---:|
| **1** | `20261018000001_core_schema.sql` | `3CA8111D309334AD842D1BA65E4D642F23D42EFF02863D528196A80855B63BCF` | 270 | **CONFIRMED MATCH** |
| **2** | `20261018000002_performance_indexes.sql` | `1184B97E1FDC7B42487C8EA4D8B4E767506A1EF9ABA0032AE625ACA1767D01FC` | 54 | **CONFIRMED MATCH** |
| **3** | `20261018000003_triggers.sql` | `858CF347752152A517D6EF68E726EA5401ACEDB57672CD34E43D79C9285B2254` | 181 | **CONFIRMED MATCH** |
| **4** | `20261018000004_security_functions_and_rpc.sql` | `FFD5A221A489AC2BA5C877C78D3887B93A72B7BDD1DEE1EA211BDBB3B8DF7900` | 178 | **CONFIRMED MATCH** |
| **5** | `20261018000005_table_rls_policies.sql` | `76E42398817FF61385B884C2548BDCECFF6FEBED125F115BB024BFBE98B9C42C` | 457 | **CONFIRMED MATCH** |
| **6** | `20261018000006_storage_setup.sql` | `38610E66A59620FFCF11414F533C1B19552514E27209EE01EF1035D0684B20AF` | 160 | **CONFIRMED MATCH** |

*Integrity Check:* Zero hash discrepancies detected. The codebase is cryptographically identical to the Phase 4D/5A baseline.

---

## 5. Architectural Resolutions for Known Design Risks

### 5.1 Trigger T3 Status History Duplication Analysis & Solution
- **The Issue:** Trigger T3 (`record_status_history`) in `20261018000003_triggers.sql` fires `AFTER UPDATE OF status ON public.reports` and unconditionally inserts an audit row with `reason = NULL`. In Phase 5A, it was confirmed that T3 does not evaluate `current_setting('cmirs.skip_status_history', true)`. If application code inserts a reasoned history entry and updates `reports.status`, two rows are created.
- **The Recommended Architectural Solution:**
  1. **Do not rely on session settings:** Setting session variables in pooled connection environments creates cross-transaction state leakage risks.
  2. **Recommended Deduplication Guard (Phase 5 Application Layer):** State transitions should be executed via a dedicated stored procedure (`transition_report_status(report_id, new_status, reason)`).
  3. **Alternative Trigger Patch (for Future Maintenance Migration):**
     If trigger-level deduplication is desired before application release, trigger T3 can be updated to check whether an identical status transition was already inserted within the same transaction:
     ```sql
     IF EXISTS (
       SELECT 1 FROM public.report_status_history
       WHERE report_id = NEW.id
         AND new_status = NEW.status
         AND created_at >= (now() - INTERVAL '2 seconds')
     ) THEN
       RETURN NEW; -- Skip fallback insert: reasoned record already exists
     END IF;
     ```
  4. **Execution Decision:** Trigger T3 remains active in its audited form as an uncompromised audit safety net. No migration SQL modification is required for local execution testing.

### 5.2 Down-Migration Script Safety Review
The emergency rollback script documented in `PHASE_5A_PREFLIGHT_RUNBOOK.md` was reviewed for operational safety:
- **Destructive Scope:** It executes `DROP TABLE ... CASCADE` across all 12 tables and `DELETE FROM storage.buckets`.
- **Irreversibility:** All table data, metadata, and active assignments are permanently destroyed.
- **Protocol:** The down-migration script is **strictly restricted to disposable local test environments** to reset the database if a test fails. It must **NEVER be run against shared, staging, or production instances** without a pre-existing logical backup.

---

## 6. Step-by-Step Local Migration Execution Protocol (When Authorized)

When the owner authorizes execution, the operator must execute the following sequential runbook:

### Step 1: Pre-Execution Environment & Hash Audit
1. Execute the Environment Isolation Guard (Section 3.1) to confirm `127.0.0.1`.
2. Compute local file hashes and confirm match with Section 4.
3. Confirm database is clean using Section 3.1 of `PHASE_5A_PREFLIGHT_RUNBOOK.md`.

### Step 2: Ordered Migration Execution
Execute the migrations sequentially using `ON_ERROR_STOP=1`:
```bash
# Sequential local execution command (local port 54322 on Supabase CLI Docker)
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000001_core_schema.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000002_performance_indexes.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000003_triggers.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000004_security_functions_and_rpc.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000005_table_rls_policies.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000006_storage_setup.sql
```

### Step 3: Immediate Catalog Audit
Verify catalog counts against expected baselines:
```sql
SELECT 'Tables' AS object_type, COUNT(*) AS object_count FROM information_schema.tables WHERE table_schema = 'public'
UNION ALL
SELECT 'Indexes', COUNT(*) FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'Storage Buckets', COUNT(*) FROM storage.buckets WHERE id = 'report-attachments';
```
*Expected:* Tables = 12, Storage Buckets = 1.

### Step 4: Run Transaction-Rollback Test Harness
Execute the local integration test runner:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/database_test_suite.sql
```

### Step 5: Post-Test Cleanup & State Verification
Confirm that the test harness rolled back cleanly and left zero residual mock rows:
```sql
-- Verification that test fixtures were rolled back
SELECT 
  (SELECT COUNT(*) FROM public.profiles WHERE email LIKE '%.test@university.edu') AS test_profiles,
  (SELECT COUNT(*) FROM public.reports WHERE title = 'Leaking pipe') AS test_reports,
  (SELECT COUNT(*) FROM public.categories WHERE name = 'Plumbing Test') AS test_categories;
```
*Expected Output:* `test_profiles = 0`, `test_reports = 0`, `test_categories = 0`.

---

## 7. Recording Actual Test Results

Following authorized execution, the operator must record observed outputs in `docs/database-design/PHASE_5B_LOCAL_TEST_RESULTS_TEMPLATE.md`. No test may be marked `PASSED` unless the actual query execution succeeded and was witnessed by the operator.
