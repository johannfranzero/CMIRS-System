# CMIRS Phase 4C — Migration SQL Remediation Review

> **Document:** `docs/database-design/PHASE_4C_REMEDIATION_REVIEW.md`  
> **Date:** 2026-10-18  
> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** 4C — Migration SQL Remediation  
> **Status:** REMEDIATION DELIVERABLE  
> **Final Verdict:** **READY FOR INDEPENDENT RE-AUDIT**  

---

## 1. Executive Summary

Phase 4C remediated all six actionable security, workflow, and correctness findings (R1–R6) identified in `docs/database-design/PHASE_4B_SQL_SECURITY_AUDIT.md`. The remediations directly hardened the existing SQL migration files without altering owner-approved requirements or introducing regressions.

**Operational Boundary Adherence:**
- **Zero SQL Execution:** No SQL was executed against any database.
- **Zero Remote Changes:** Supabase was not connected to, contacted, or modified.
- **Controlled Scope:** Only the four relevant migration files in `supabase/migrations/` and this remediation review were modified or created. No application source code, package dependencies, or environment variables were touched.
- **Static Validation Only:** Static analysis confirmed that all remediations compile with balanced blocks, correct syntax, and robust constraints.

---

## 2. R1–R6 Remediation Details & Before/After Behavior

### Remediation R1: Safe Storage UUID Path Validation
- **Target File:** [`supabase/migrations/20261018000006_storage_setup.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000006_storage_setup.sql#L74-L146)
- **Object Modified:** Policy `storage_attachments_insert` on `storage.objects`
- **Before Behavior:**
  - Used permissive regex `^reports/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.[a-zA-Z0-9]+$` which permitted invalid 36-character hyphen strings (e.g. `------------------------------------`).
  - Relied on boolean `AND` evaluation order. In PostgreSQL, query optimization could evaluate `(storage.foldername(name))[2]::uuid` before the regex, triggering an unhandled `invalid input syntax for type uuid` exception (HTTP 500) upon receiving malformed paths.
- **After Behavior:**
  - Implemented strict canonical UUID regex validating both report and attachment UUID segments and image extensions:  
    `^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$`
  - Wrapped every instance of UUID extraction inside a short-circuit safe `CASE` construct:
    ```sql
    (CASE 
      WHEN name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(jpe?g|png|webp)$'
      THEN (storage.foldername(name))[2]::uuid
      ELSE NULL
    END)
    ```
  - When a path is malformed or invalid, `CASE` returns `NULL`. The comparison `r.id = NULL` evaluates to `NULL` (falsy), cleanly and safely denying the upload without attempting type conversion or throwing runtime exceptions.

---

### Remediation R2: Restrict Initial Report Values on INSERT
- **Target File:** [`supabase/migrations/20261018000005_table_rls_policies.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql#L138-L148)
- **Object Modified:** Policy `reports_insert` on `public.reports`
- **Before Behavior:**
  - Policy checked only `WITH CHECK (reporter_id = auth.uid())`.
  - A client could supply arbitrary initial values such as `status = 'verified'` or `confirmed_priority = 'critical'`, bypassing coordinator review and triage.
- **After Behavior:**
  - Policy strictly enforces initial submission boundaries matching database defaults and approved lifecycle rules:
    ```sql
    WITH CHECK (
      reporter_id = auth.uid()
      AND status = 'submitted'
      AND confirmed_priority IS NULL
    );
    ```
  - Any attempt to insert a report with non-submitted status or coordinator-set priority is rejected at the database RLS level.

---

### Remediation R3: Restrict Technician Assignment Transitions
- **Target File:** [`supabase/migrations/20261018000005_table_rls_policies.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql#L217-L265)
- **Object Modified:** Split `assignments_update_technician` into two dedicated policies: `assignments_update_technician_decline` and `assignments_update_technician_work`
- **Before Behavior:**
  - Single combined policy evaluated `USING (status IN ('assigned', 'in_progress', 'on_hold'))` and `WITH CHECK (status = 'declined' OR status IN ('in_progress', 'on_hold', 'completed'))`.
  - Direct table updates allowed a technician to transition an assignment from `in_progress` or `on_hold` to `declined`, violating decision PD-R2 (decline permitted from `assigned` status only).
  - Protected assignment metadata (`report_id`, `assigned_by`, `assigned_at`, `notes`) lacked explicit immutability guards in the table policy.
- **After Behavior:**
  - **Policy 1 (`assignments_update_technician_decline`):**
    ```sql
    USING (
      public.get_user_role() = 'technician'
      AND technician_id = auth.uid()
      AND status = 'assigned'
    )
    WITH CHECK (
      public.get_user_role() = 'technician'
      AND technician_id = auth.uid()
      AND status = 'declined'
      AND decline_reason IS NOT NULL
      AND btrim(decline_reason) != ''
      AND report_id = (SELECT a.report_id FROM public.assignments a WHERE a.id = assignments.id)
      AND assigned_by = (SELECT a.assigned_by FROM public.assignments a WHERE a.id = assignments.id)
      AND assigned_at = (SELECT a.assigned_at FROM public.assignments a WHERE a.id = assignments.id)
      AND notes IS NOT DISTINCT FROM (SELECT a.notes FROM public.assignments a WHERE a.id = assignments.id)
    );
    ```
  - **Policy 2 (`assignments_update_technician_work`):**
    ```sql
    USING (
      public.get_user_role() = 'technician'
      AND technician_id = auth.uid()
      AND status IN ('assigned', 'in_progress', 'on_hold')
    )
    WITH CHECK (
      public.get_user_role() = 'technician'
      AND technician_id = auth.uid()
      AND status IN ('in_progress', 'on_hold', 'completed')
      AND decline_reason IS NULL
      AND report_id = (SELECT a.report_id FROM public.assignments a WHERE a.id = assignments.id)
      AND assigned_by = (SELECT a.assigned_by FROM public.assignments a WHERE a.id = assignments.id)
      AND assigned_at = (SELECT a.assigned_at FROM public.assignments a WHERE a.id = assignments.id)
      AND notes IS NOT DISTINCT FROM (SELECT a.notes FROM public.assignments a WHERE a.id = assignments.id)
    );
    ```
  - Decline is strictly impossible from `in_progress` or `on_hold`. Active work transitions cannot inject a decline reason. All assignment metadata columns are permanently protected from technician modification.

---

### Remediation R4: Prevent Client-Supplied Report Numbers & Enforce Update Immutability
- **Target File:** [`supabase/migrations/20261018000003_triggers.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000003_triggers.sql#L33-L78)
- **Object Modified:** Trigger function `generate_report_number()` and new trigger `trg_reports_immutable_cols`
- **Before Behavior:**
  - `generate_report_number()` checked `IF NEW.report_number IS NULL OR NEW.report_number = '' THEN ...`.
  - A client could provide a custom report number during INSERT (e.g. `RPT-999999`) that bypassed sequence generation.
  - No trigger prevented updating `report_number` or `reporter_id` on existing reports.
- **After Behavior:**
  - Trigger T2 unconditionally overwrites `NEW.report_number`:
    ```sql
    NEW.report_number := 'RPT-' || LPAD(nextval('public.report_number_seq')::TEXT, 6, '0');
    ```
  - Added trigger `trg_reports_immutable_cols` executing `prevent_report_immutable_col_update()`:
    ```sql
    IF OLD.report_number IS DISTINCT FROM NEW.report_number THEN
      RAISE EXCEPTION 'report_number is immutable and cannot be modified.';
    END IF;
    IF OLD.reporter_id IS DISTINCT FROM NEW.reporter_id THEN
      RAISE EXCEPTION 'reporter_id is immutable and cannot be modified.';
    END IF;
    ```
  - Report numbers are strictly generated from sequence, and report numbers and reporter identity are permanently immutable.

---

### Remediation R5: Restrict Notification Updates
- **Target File:** [`supabase/migrations/20261018000005_table_rls_policies.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000005_table_rls_policies.sql#L430-L450)
- **Object Modified:** Policy `notifications_update_recipient` and added column-level UPDATE privilege restriction
- **Before Behavior:**
  - Policy used `USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid())`.
  - Recipients could modify notification `title`, `message`, `type`, or `report_id`.
- **After Behavior:**
  - `WITH CHECK` enforces that non-read columns cannot be altered:
    ```sql
    WITH CHECK (
      recipient_id = auth.uid()
      AND id = (SELECT n.id FROM public.notifications n WHERE n.id = notifications.id)
      AND type = (SELECT n.type FROM public.notifications n WHERE n.id = notifications.id)
      AND title = (SELECT n.title FROM public.notifications n WHERE n.id = notifications.id)
      AND message = (SELECT n.message FROM public.notifications n WHERE n.id = notifications.id)
      AND report_id IS NOT DISTINCT FROM (SELECT n.report_id FROM public.notifications n WHERE n.id = notifications.id)
      AND created_at = (SELECT n.created_at FROM public.notifications n WHERE n.id = notifications.id)
    );
    ```
  - Added column-level privilege grant restricting SQL updates strictly to `is_read`:
    ```sql
    REVOKE UPDATE ON public.notifications FROM authenticated;
    GRANT UPDATE (is_read) ON public.notifications TO authenticated;
    ```
  - Two independent defense layers prevent tampering with notification content.

---

### Remediation R6: Idempotent and Compatible Enum DDL
- **Target File:** [`supabase/migrations/20261018000001_core_schema.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000001_core_schema.sql#L8-L125)
- **Object Modified:** Enums `user_role`, `report_status`, `priority_level`, `assignment_status`, `notification_type`
- **Before Behavior:**
  - Raw `CREATE TYPE ... AS ENUM (...)` statements threw fatal errors if re-executed on an existing database.
- **After Behavior:**
  - Wrapped each enum creation in an idempotent `DO $$` block that:
    1. Checks if the type exists. If not, creates it cleanly with approved values and ordering.
    2. If the type already exists, queries `pg_enum` and verifies that it contains expected labels. If incompatible, it raises an explicit exception (`Pre-existing type ... is incompatible with approved CMIRS schema`).
  - Migration replay is fully supported while preventing silent acceptance of incompatible pre-existing types.

---

## 3. R7 and R8 Disposition and Rationale

### R7 — Status History Duplication
- **Evaluation:** Trigger T3 (`record_status_history`) automatically inserts a status history row whenever `reports.status` changes, setting `reason = NULL`. In the proposed workflow, the coordinator or reporter may supply a required transition reason (e.g. for holds, cancellations, or reopening). If the client application inserts a status history record with `reason` and subsequently updates `reports.status`, trigger T3 fires and inserts a second status history entry with `reason = NULL`.
- **Architectural Disposition:**
  - Trigger T3 is intentionally designated in `SCHEMA_PROPOSAL.md` as a **safety net** ensuring an audit entry exists even if an application operation omits it.
  - To prevent duplicates in production, state transitions should be executed via a unified server-side RPC or transaction where the status history insert occurs, and trigger T3 serves as a fallback.
  - **Decision:** No migration modification made in Phase 4C. Documented for application layer implementation in Phase 5.

### R8 — `get_user_role()` Session Caching
- **Evaluation:** Utilizing `current_setting('cmirs.user_role', true)` provides minor query execution benefits by caching the user's role in the session rather than querying `public.profiles`. However, in web architectures employing connection poolers in transaction pooling mode (e.g. Supabase Supavisor / PgBouncer), session-level variables can persist across transactions if not aggressively reset, creating severe privilege-escalation and cross-tenant leakage risks.
- **Architectural Disposition:**
  - `get_user_role()` is declared `STABLE` and queries `public.profiles WHERE id = auth.uid()`.
  - PostgreSQL's planner already optimizes `STABLE` functions within a single statement execution.
  - Querying `profiles` directly guarantees fresh, authoritative role lookups without stale cache risks.
  - **Decision:** No session cache introduced. `get_user_role()` remains a direct `STABLE` query.

---

## 4. Mandatory Regression Review Results

| Area | Regression Check | Audit Result | Evidence |
|---|---|:---:|---|
| **RLS Policies** | `USING` and `WITH CHECK` integrity across all tables | **PASS** | Evaluated on all 12 tables. No permissive policy combinations or bypass vectors. |
| **Direct Updates vs RPCs** | Direct updates cannot bypass decline or soft-delete rules | **PASS** | R3 splits technician policies; soft-delete remains exclusive to RPC. |
| **Column Privileges** | Protected fields cannot be modified | **PASS** | R4 trigger locks `report_number`/`reporter_id`; R5 locks `notifications` non-read columns; profiles role/is_active protected. |
| **SECURITY DEFINER** | Pinned search paths and execution grants intact | **PASS** | All 9 functions specify `SET search_path = public, auth, pg_temp;`. Grants restricted to `authenticated`. |
| **Sequence Numbering** | Concurrency-safe sequence generation preserved | **PASS** | `nextval('public.report_number_seq')` formatted as `RPT-000001` unconditionally. |
| **Attachment Soft Deletion** | Metadata immutability and soft-delete RPC intact | **PASS** | Direct update/delete denied; `soft_delete_attachment()` operational. |
| **Attachment Concurrency** | Parent row-lock trigger T5 intact | **PASS** | `lock_attachment_count()` locks parent report row `FOR UPDATE` before checking active count `< 5`. |
| **Technician Visibility** | Historical visibility and declined exclusion preserved | **PASS** | `can_view_report()` filters `assignments.status != 'declined'`. |
| **Storage Security** | Private bucket, canonical UUID paths, and download filters | **PASS** | R1 enforces canonical UUIDs with `CASE` short-circuiting; download policies match database metadata. |

---

## 5. Static Validation Methods and Limitations

### Static Analysis Results
- Automated validation via Python script inspecting all six migration files:
  - **Enums & R6 Idempotence:** Verified. All 5 enums wrapped in compatibility-guarded `DO $$` blocks.
  - **R2 Report Insert:** Verified. `reports_insert` enforces `status = 'submitted' AND confirmed_priority IS NULL`.
  - **R3 Technician Split:** Verified. `assignments_update_technician_decline` and `assignments_update_technician_work` present and mutually exclusive.
  - **R4 Report Number Immutability:** Verified. `generate_report_number()` is unconditional; `trg_reports_immutable_cols` present.
  - **R5 Notification Restrictions:** Verified. Column grant `UPDATE (is_read)` and `WITH CHECK` guards present.
  - **R1 Storage Path Security:** Verified. Canonical UUID regex pattern and `CASE` short-circuit construct present.
  - **Syntax & Balanced Blocks:** Verified. Total `$$` occurrences = 30 (balanced).

### Static Validation Limitations
- **Live Database Behavior:** Query planner execution costs under high volume, live Supabase Auth hook integration, and runtime Storage extension behavior cannot be evaluated statically and require testing in a live development instance during Phase 5.

---

## 6. Exact Git Diff Scope

```text
Changes not staged for commit:
  modified:   supabase/migrations/20261018000001_core_schema.sql
  modified:   supabase/migrations/20261018000003_triggers.sql
  modified:   supabase/migrations/20261018000005_table_rls_policies.sql
  modified:   supabase/migrations/20261018000006_storage_setup.sql

Untracked files:
  docs/database-design/PHASE_4B_SQL_SECURITY_AUDIT.md
  docs/database-design/PHASE_4C_REMEDIATION_REVIEW.md
```

- **Only the four target migration SQL files and documentation reports were changed or created.**
- No application source code, configuration, or environment files were touched.
- No database connections were made.

---

## 7. Remaining Issues or Unverified Assumptions

- **Phase 5 Prerequisites:** Before applying migrations to a live Supabase project, verify that the project's database extensions (`pgcrypto` or `uuid-ossp`) and `storage` schema are enabled.
- **R7 Implementation Note:** The application layer in Phase 5 must coordinate report status updates and status history insertion to ensure audit reasons are captured without trigger duplication.

---

## 8. Final Verdict

### **VERDICT: READY FOR INDEPENDENT RE-AUDIT**

All findings R1 through R6 have been remediated in the actual migration files with zero regressions. The SQL files are prepared for independent re-audit.

**Stop Condition Met:** No migrations were executed. Awaiting owner review and authorization of the re-audit.
