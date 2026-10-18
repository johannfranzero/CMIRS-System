# CMIRS Phase 5A — Preflight Migration Runbook

> **Document:** `docs/database-design/PHASE_5A_PREFLIGHT_RUNBOOK.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 5A — Migration Execution Planning & Test Harness Preparation  
> **Role:** PostgreSQL / Supabase Lead Database & DevOps Engineer  
> **Status:** RUNBOOK DELIVERABLE (PLANNING ONLY)  
> **Execution Status:** **UNEXECUTED — NO DATABASE EXECUTION AUTHORIZED**  

---

## 1. Purpose and Scope

This runbook defines the exact operational procedure for executing and verifying the six CMIRS PostgreSQL database migrations in a future, separately authorized migration session (Phase 5B).

> [!CAUTION]
> **CRITICAL BOUNDARY ENFORCEMENT**  
> Creating this runbook **DOES NOT authorize executing migrations or connecting to any Supabase instance**. No SQL commands may be executed, no database connections may be initiated, and no environment secrets may be read or modified until explicit owner authorization is granted.

---

## 2. Target Environment Confirmation & Secret Protection

### 2.1 Environmental Tiers and Gating
CMIRS migrations must progress through environmental tiers sequentially. Execution against a higher tier is prohibited until the lower tier passes all validation suites:

| Tier | Environment Name | Connection Identifier Format | Gating Prerequisite |
|:---:|---|---|---|
| **Tier 1** | **Local Development** | `http://127.0.0.1:54321` (Docker) | Default execution tier for Phase 5B validation. |
| **Tier 2** | **Staging / Preview** | `https://<staging-ref>.supabase.co` | Authorized only after Tier 1 passes 100% of integration tests. |
| **Tier 3** | **Production** | `https://<prod-ref>.supabase.co` | Gated by final stakeholder and owner sign-off. |

### 2.2 Strict Zero-Credentials Leakage Protocol
1. **Never print secrets to terminal output or log files:** Prohibit commands such as `echo $SUPABASE_SERVICE_ROLE_KEY` or `cat .env.local`.
2. **Environment Variable Scoping:** Reference environment variables exclusively through tool parameter flags or script bindings without echoing their values.
3. **Project Reference Verification:** Verify project identity using the project reference ID (`SUPABASE_PROJECT_REF`), never the database password or API secret keys.
4. **Log Sanitization:** Ensure CI/CD runners or terminal transcript tools redact strings matching Supabase JWT tokens (`ey...`) or PostgreSQL connection URIs containing credentials (`postgres://...:...@...`).

---

## 3. Preflight Diagnostic Inspection (Fresh vs. Existing Database)

Before applying any migration, the operator must execute non-destructive diagnostic queries to determine the target database state.

### 3.1 Diagnostic SQL Audit Script
Run the following read-only SQL inspection script against the target database:

```sql
-- CMIRS Preflight Diagnostic Inspection Script (Read-Only)
-- Purpose: Audit database state before applying Migration Suite 20261018000001-06

BEGIN;

-- 1. Check existing tables in public schema
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- 2. Check existing custom enums and their labels
SELECT 
  t.typname AS enum_name,
  e.enumlabel AS label_name,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;

-- 3. Check existing sequences in public schema
SELECT sequencename 
FROM pg_sequences 
WHERE schemaname = 'public' 
ORDER BY sequencename;

-- 4. Check existing functions and triggers
SELECT 
  routine_name, 
  routine_type, 
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;

-- 5. Check Supabase migration history table
SELECT 
  version, 
  inserted_at 
FROM supabase_migrations.schema_migrations 
ORDER BY version;

-- 6. Check required platform extensions
SELECT 
  extname, 
  extversion 
FROM pg_extension 
WHERE extname IN ('pgcrypto', 'uuid-ossp');

-- 7. Check Supabase Storage configuration
SELECT id, name, public, file_size_limit 
FROM storage.buckets 
WHERE id = 'report-attachments';

COMMIT;
```

### 3.2 Database State Classification & Decision Matrix

| State Classification | Inspection Indicators | Required Operator Action |
|---|---|---|
| **State A: Clean / Fresh Database** | `public` schema contains zero application tables; `pg_enum` contains zero CMIRS enums; `schema_migrations` contains zero CMIRS migration versions. | **PROCEED WITH MIGRATION:** Target is ideal for sequential execution. |
| **State B: Partially Migrated / Dirty** | Some CMIRS tables or enums exist, but not all 6 migrations are recorded in `schema_migrations`; or enum labels conflict with CMIRS data dictionary. | **HARD ABORT:** Do NOT run migrations. Database is in an inconsistent state. Require database reset (`supabase db reset` on local) or manual inspection. |
| **State C: Fully Migrated Database** | All 12 tables exist, all 5 enums have approved labels, and all 6 versions (`20261018000001` through `20261018000006`) exist in `schema_migrations`. | **ABORT — NO ACTION NEEDED:** Migrations are already applied. Proceed directly to post-migration validation. |
| **State D: Unrelated Schema Collisions** | Tables with non-CMIRS names exist in `public`, or pre-existing types share names (`user_role`, `report_status`) with incompatible labels. | **HARD ABORT:** Migration will fail on enum compatibility check. Refactor target database before proceeding. |

---

## 4. Platform Prerequisites and Permissions Audit

The target environment must meet all platform requirements before migration execution begins:

1. **PostgreSQL Version:** PostgreSQL 15.x or 16.x (standard on Supabase).
2. **Supabase Auth Service (GoTrue):** Schema `auth` and table `auth.users` must exist. The migration operator role must have permission to create triggers on `auth.users` (`trg_on_auth_user_created`).
3. **Supabase Storage Service:** Schema `storage` and tables `storage.buckets` and `storage.objects` must exist. The helper function `storage.foldername(name text)` must be present in schema `storage`.
4. **Predefined Roles:** System roles `postgres`, `authenticated`, `anon`, and `service_role` must exist with standard Supabase permissions.
5. **Operator Privileges:** The operator connection must use the `postgres` administrative role (or Supabase CLI service account) with `SUPERUSER` or `CREATEROLE` / table ownership rights.

---

## 5. Backup, Snapshot, and Disaster Recovery Procedures

### 5.1 Mandatory Pre-Execution Backup
Before executing Migration 1 on any shared, staging, or production instance:

```bash
# 1. Export full schema and data snapshot using Supabase CLI
supabase db dump --data-only=false -f "backup_cmirs_pre_migration_$(date +%Y%m%d_%H%M%S).sql"

# 2. Verify backup file integrity
test -s "backup_cmirs_pre_migration_$(date +%Y%m%d_%H%M%S).sql" && echo "Backup verified: File exists and is non-empty."
```

### 5.2 Recovery & Down-Migration Procedure
PostgreSQL executes DDL transactions, but Supabase CLI applies individual migration files in separate transactions. If Migration 5 fails, Migrations 1 through 4 remain committed.

If an unrecoverable failure occurs midway, the operator must execute the emergency down-migration script:

```sql
-- CMIRS Emergency Rollback Script (Phase 5B Recovery)
-- Execute ONLY if migration fails midway and database must be reset to pre-migration baseline.

BEGIN;

-- 1. Teardown Storage Setup (Migration 6)
DROP POLICY IF EXISTS "storage_attachments_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_attachments_insert" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'report-attachments';

-- 2. Teardown Table RLS Policies & Grants (Migration 5)
-- Table policies are automatically dropped with tables, but explicit revocation cleans grants:
REVOKE UPDATE (is_read) ON public.notifications FROM authenticated;

-- 3. Teardown Security Functions and RPCs (Migration 4)
DROP FUNCTION IF EXISTS public.decline_assignment(UUID, TEXT);
DROP FUNCTION IF EXISTS public.soft_delete_attachment(UUID);
DROP FUNCTION IF EXISTS public.can_view_report(UUID);
DROP FUNCTION IF EXISTS public.get_user_role();

-- 4. Teardown Triggers and Functions (Migration 3)
DROP TRIGGER IF EXISTS trg_lock_attachment_count ON public.report_attachments;
DROP FUNCTION IF EXISTS public.lock_attachment_count();

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

DROP TRIGGER IF EXISTS trg_reports_status_history ON public.reports;
DROP FUNCTION IF EXISTS public.record_status_history();

DROP TRIGGER IF EXISTS trg_reports_immutable_cols ON public.reports;
DROP FUNCTION IF EXISTS public.prevent_report_immutable_col_update();

DROP TRIGGER IF EXISTS trg_reports_report_number ON public.reports;
DROP FUNCTION IF EXISTS public.generate_report_number();

DROP TRIGGER IF EXISTS trg_reports_updated_at ON public.reports;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
DROP FUNCTION IF EXISTS public.set_updated_at();

-- 5. Teardown Performance Indexes (Migration 2)
-- (Indexes are dropped automatically when parent tables are dropped)

-- 6. Teardown Tables in Reverse Dependency Order (Migration 1)
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.verifications CASCADE;
DROP TABLE IF EXISTS public.work_logs CASCADE;
DROP TABLE IF EXISTS public.report_comments CASCADE;
DROP TABLE IF EXISTS public.report_status_history CASCADE;
DROP TABLE IF EXISTS public.report_attachments CASCADE;
DROP TABLE IF EXISTS public.assignments CASCADE;
DROP TABLE IF EXISTS public.reports CASCADE;
DROP TABLE IF EXISTS public.locations CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.role_change_audit CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 7. Teardown Sequences (Migration 1)
DROP SEQUENCE IF EXISTS public.report_number_seq;

-- 8. Teardown Custom Enums (Migration 1)
DROP TYPE IF EXISTS public.notification_type;
DROP TYPE IF EXISTS public.assignment_status;
DROP TYPE IF EXISTS public.priority_level;
DROP TYPE IF EXISTS public.report_status;
DROP TYPE IF EXISTS public.user_role;

COMMIT;
```

---

## 6. Migration Sequence & Cryptographic Hash Inventory

Before applying migrations, verify that the local migration files match the audited SHA-256 checksums exactly:

| Sequence | Migration File Name | SHA-256 Checksum (Full) | Lines | Purpose |
|:---:|---|---|:---:|---|
| **1** | `20261018000001_core_schema.sql` | `3CA8111D309334AD842D1BA65E4D642F23D42EFF02863D528196A80855B63BCF` | 270 | Extensions, 5 Enums, Sequence, 12 Base Tables, Constraints |
| **2** | `20261018000002_performance_indexes.sql` | `1184B97E1FDC7B42487C8EA4D8B4E767506A1EF9ABA0032AE625ACA1767D01FC` | 54 | 24 Performance, Filter, and RLS Compound Indexes |
| **3** | `20261018000003_triggers.sql` | `858CF347752152A517D6EF68E726EA5401ACEDB57672CD34E43D79C9285B2254` | 181 | Triggers T1–T5, Sequence Formatter, Immutable Column Guard |
| **4** | `20261018000004_security_functions_and_rpc.sql` | `FFD5A221A489AC2BA5C877C78D3887B93A72B7BDD1DEE1EA211BDBB3B8DF7900` | 178 | Security Definer Helpers & RPCs (`can_view_report`, `soft_delete`) |
| **5** | `20261018000005_table_rls_policies.sql` | `76E42398817FF61385B884C2548BDCECFF6FEBED125F115BB024BFBE98B9C42C` | 457 | Row Level Security Policies on all 12 Tables & Column Grants |
| **6** | `20261018000006_storage_setup.sql` | `38610E66A59620FFCF11414F533C1B19552514E27209EE01EF1035D0684B20AF` | 160 | Storage Bucket `report-attachments` & Safe RLS Policies |

### Verification Command (PowerShell / Linux)
```powershell
# PowerShell verification
Get-FileHash -Algorithm SHA256 (Get-ChildItem -Path supabase/migrations/*.sql) | Format-Table -AutoSize
```
```bash
# Bash verification
sha256sum supabase/migrations/*.sql
```

---

## 7. Execution Runbook (When Authorized in Phase 5B)

When Phase 5B execution authorization is formally received, execute following this exact protocol:

### Step 1: Preflight Verification
1. Run Diagnostic Script (Section 3.1) and confirm **State A (Clean)**.
2. Confirm SHA-256 checksums match Section 6.
3. Confirm backup snapshot is taken and non-empty (Section 5.1).

### Step 2: Sequential Application via Supabase CLI
```bash
# If using Supabase Local CLI:
supabase migration up

# If executing via direct psql connection (wrapped with failure stop):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000001_core_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000002_performance_indexes.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000003_triggers.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000004_security_functions_and_rpc.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000005_table_rls_policies.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261018000006_storage_setup.sql
```

### Step 3: Immediate Post-Execution Catalog Audit
Immediately following application, verify catalog counts:
```sql
-- Verification Query
SELECT 'Tables' AS object_type, COUNT(*) AS object_count FROM information_schema.tables WHERE table_schema = 'public'
UNION ALL
SELECT 'Indexes', COUNT(*) FROM pg_indexes WHERE schemaname = 'public'
UNION ALL
SELECT 'Triggers', COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public'
UNION ALL
SELECT 'Functions', COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public'
UNION ALL
SELECT 'Policies', COUNT(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL
SELECT 'Storage Buckets', COUNT(*) FROM storage.buckets WHERE id = 'report-attachments';
```
**Expected Counts:**
- Tables: `12`
- Custom Enums: `5`
- Storage Bucket: `1` (`report-attachments`, private)
- Triggers on public: `5` (plus 1 on `auth.users`)

---

## 8. Abort Conditions and Emergency Response

Execution must be aborted immediately upon encountering any of the following conditions:
1. **Checksum Mismatch:** Local migration file SHA-256 hash does not match Section 6.
2. **Schema Incompatibility:** Diagnostic query detects conflicting pre-existing enums or tables.
3. **Execution Failure:** Any migration script exits with non-zero code or SQL error.
4. **Platform Missing Feature:** `storage.foldername` or `auth.users` trigger creation fails due to permissions.

**Immediate Abort Action:**
1. Stop execution of subsequent migration files.
2. Capture terminal error output to a private incident log (redacting credentials).
3. If executed on a non-ephemeral database, execute the Recovery Script (Section 5.2).
4. Do NOT attempt ad-hoc SQL fixes on the live database.
5. Notify the lead database architect and project owner.
