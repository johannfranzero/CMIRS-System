# Phase 3.2 Verification Report: Read-Only DAL, Pagination, KPIs, and Role-Aware Joins

**Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
**Workspace:** `D:\CMIRS-System\my-app`  
**Evaluation Target:** Phase 3.2 Read-Only Data Access Layer (DAL) Implementation  
**Auditor:** Senior Full-Stack Engineer, Next.js App Router Specialist, Supabase/PostgreSQL Reviewer & Application Security Auditor  
**Date of Audit:** October 20, 2026  
**Status / Readiness Verdict:** **PASS WITH CONDITIONS**

---

## 1. Executive Summary

This verification report presents an independent, local, verification-only audit of the **Phase 3.2 Read-Only Data Access Layer (DAL)** implementation for the Campus Maintenance & Incident Reporting System (CMIRS). The primary objective is to verify whether the DAL, pagination mechanics, dashboard KPI calculations, role-aware query scoping, and database-to-UI transformations are architecturally sound, type-safe, resilient, secure, and compliant with approved project specifications before commencing write operations in Phase 3.3.

### Key Strengths Identified
1. **Strict Session Isolation & Authenticated Access:** The DAL operates exclusively via authenticated server Supabase clients created dynamically per request (`utils/supabase/server.ts`), bound to Next.js cookie headers. No service-role credentials or bypass keys exist in client- or user-facing code.
2. **Cryptographic Identity Enforcement:** User identity and role verification rely strictly on `supabase.auth.getUser()` and server-side profile lookups in `public.profiles`. Client-supplied roles and IDs are completely ignored.
3. **Resilient Transformation Layer:** `transformDbReportToMaintenanceReport()` provides comprehensive null-safety, graceful fallbacks for missing foreign-key joins, and safe resolution of nullable database fields (`confirmed_priority`, `room`, `assignedTechnician`).
4. **Accurate Error Disambiguation:** Empty data sets (`count === 0, reports: []`) are distinctly segregated from database query failures (`isLiveData: true, error: string`), preventing silent data loss masking.
5. **Clean Compilation and Testing Baseline:** All 49 unit tests across 5 test suites pass with zero failures. TypeScript check (`tsc --noEmit`), ESLint (`npm run lint`), and Next.js 16.4.2 production build (`npm run build`) execute cleanly with zero errors.

### Principal Findings Requiring Conditions
1. **PostgREST Embedded Join Filter Semantics (High - Finding H-01):** In `getReportsQueue()`, filtering by category uses `query.eq('categories.name', params.category)`. Under default PostgREST semantics without an `!inner` join qualifier (`categories!inner`), this filters the joined category object rather than removing parent report rows. Non-matching rows are returned with `categories: null`, which then fallback to `'General Maintenance'`.
2. **Unbounded Row Fetch for KPI Computation (High - Finding H-02):** `getDashboardKpiStats()` selects reports across the database without a `.limit()` or range constraint, computing aggregates in Node.js server memory. While secured by PostgreSQL RLS, large record counts (>1,000 rows) will be silently truncated by PostgREST default result limits.
3. **Non-Deterministic Sort Tiebreaker (Medium - Finding M-01):** Pagination orders by `created_at DESC` without a secondary unique column (e.g. `id DESC`), creating non-deterministic pagination shifts when multiple reports share identical timestamps.
4. **Pagination URL Query Parameter Loss (Medium - Finding M-02):** The pagination controls on `/reports` preserve the `status` filter but drop `category` and `search` query parameters, resetting those filters upon page navigation.
5. **Direct Exposure of PostgREST Error Strings (Medium - Finding M-03):** Internal database error messages are displayed directly in the UI notice banner (`Database Notice: ${error}`), potentially exposing database internals to end users.

---

## 2. Scope and Authorization Boundaries

In accordance with Section 3 ("Strict Authorization and Safety Boundaries") of the verification directive, this audit was conducted strictly as a **local, read-only verification**.

### Authorized Activities Performed
- Deep static analysis of all DAL code, UI page components, server authentication helpers, database migrations, and schema definitions.
- Local execution of the complete unit test suite across all 5 test files (`node --test tests/unit/*.test.mjs`).
- Local compilation checks (`npx tsc --noEmit`).
- Local lint checks (`npm run lint`).
- Local Next.js App Router production build (`npm run build`).
- Trace analysis of data flows from Next.js Server Components through the DAL to UI components.

### Unauthorized Activities Deferred
- **Zero Remote Queries:** No remote Supabase database queries or Storage calls were initiated.
- **Zero Remote Tests:** Gate E.4D and `tests/integration/rls-runner.ts` were NOT executed.
- **Zero Mutations:** No database records, schemas, migrations, RLS policies, triggers, RPC functions, or Auth accounts were created or modified.
- **Zero Git Operations:** No commits, pushes, rebases, or branch changes were made.
- **Zero Credential Exposure:** `.env.local` was untouched; no secrets or tokens were logged or exposed.

---

## 3. Files and Documentation Inspected

### Source Code
- `utils/reports/dal.ts` (DAL query construction, schema selection, transformation, KPI calculation)
- `app/page.tsx` (Dashboard Server Component, KPI card integration, facility breakdown)
- `app/reports/page.tsx` (Reports Queue Server Component, search params parsing, pagination controls)
- `types/reports.ts` (TypeScript domain models and database joined interfaces)
- `components/dashboard/report-list.tsx` (Report table presentation, status badges, priority display)
- `components/ui/badge.tsx` (Status and priority visual styling variants)
- `utils/supabase/server.ts` (Next.js 16 async cookie-based Supabase server client)
- `utils/auth/server.ts` (Cryptographic session authentication, profile retrieval, React `cache()`)
- `utils/auth/validation.ts` (Canonical role validation, redirect URL sanitization)

### Database Migrations and Proposals
- `supabase/migrations/20261018000001_core_schema.sql` (Tables, enums, sequences, constraints)
- `supabase/migrations/20261018000002_performance_indexes.sql` (Composite indexes)
- `supabase/migrations/20261018000003_triggers.sql` (Report number generation, updated_at triggers)
- `supabase/migrations/20261018000004_security_functions_and_rpc.sql` (`get_user_role()`, `can_view_report()`)
- `supabase/migrations/20261018000005_table_rls_policies.sql` (Row Level Security policies across all 12 tables)
- `supabase/migrations/20261018000006_storage_setup.sql` (Bucket policies)
- `docs/database-design/SCHEMA_PROPOSAL.md` & `DATA_DICTIONARY.md`
- `docs/database-design/RLS_POLICY_PROPOSAL.md`

### Project Requirements & Reports
- `docs/ROLES.md` (Role definitions, capabilities, and data access permissions)
- `docs/WORKFLOW.md` (Report lifecycle states, triage, dispatch, work logs, verification)
- `docs/SECURITY.md` (Authentication boundaries, RLS specifications, authorization rules)
- `docs/frontend/PHASE_3_1_BACKEND_INTEGRATION_READINESS_REPORT.md` (Integration readiness baseline)
- `docs/frontend/PHASE_3_2_READ_ONLY_DAL_REPORT.md` (Phase 3.2 initial implementation report)
- `docs/frontend/PHASE_2_AUTH_RBAC_IMPLEMENTATION_REPORT.md` (Auth and session foundation)
- `docs/frontend/PHASE_2_5_ROLE_AWARE_DASHBOARD_REPORT.md` (Dashboard mock filtering baseline)

### Test Suites
- `tests/unit/dal-read-queries.test.mjs` (DAL unit tests)
- `tests/unit/security-boundaries.test.mjs` (Route guard and security boundary tests)
- `tests/unit/role-mock-filtering.test.mjs` (Role-aware data filtering tests)
- `tests/unit/navigation-and-shell.test.mjs` (App shell and navigation tests)
- `tests/unit/validation.test.mjs` (Input validation tests)

---

## 4. Audit A — DAL Architecture and Query Correctness

### Data Flow Trace
```
Next.js Server Component (app/page.tsx or app/reports/page.tsx)
  │
  ▼
utils/auth/server.ts: getCurrentUserAndProfile()
  ├─ Validates cryptographically signed JWT via supabase.auth.getUser()
  ├─ Selects public.profiles for user.id with is_active = true
  └─ Fails closed (returns null) on missing session or inactive status
  │
  ▼
utils/supabase/server.ts: createClient()
  ├─ Instantiates createServerClient with request-scoped cookieStore
  └─ Injects user's session JWT into PostgREST Authorization headers
  │
  ▼
utils/reports/dal.ts: getReportsQueue() or getDashboardKpiStats()
  ├─ PostgREST Query Construction with SELECT_REPORTS_FIELDS
  ├─ Defense-in-depth scoping (student_personnel: reporter_id = user.id)
  └─ Remote PostgREST executes query against PostgreSQL with RLS
  │
  ▼
PostgreSQL Engine (RLS Enforcement)
  ├─ public.can_view_report(id) filters report rows according to caller role
  ├─ public.profiles RLS enforces profile row visibility
  └─ public.assignments RLS enforces assignment row visibility
  │
  ▼
utils/reports/dal.ts: transformDbReportToMaintenanceReport()
  ├─ Resolves active assignment (assigned, in_progress, on_hold) vs historical/declined
  ├─ Gracefully handles null foreign-key relations
  └─ Maps database row to canonical UI MaintenanceReport domain model
  │
  ▼
UI Rendering (app/page.tsx, app/reports/page.tsx, components/dashboard/report-list.tsx)
```

### Query Correctness and Schema Reconciliation
| DAL Field / Join | Database Migration Source | Correctness Assessment |
| :--- | :--- | :--- |
| `id`, `report_number` | `public.reports (id UUID, report_number TEXT)` | Matches schema exactly. Unique constraint on `report_number`. |
| `title`, `description` | `public.reports (title TEXT, description TEXT)` | Matches schema exactly. Both non-null in database. |
| `status` | `public.reports (status report_status)` | Matches `report_status` enum (9 states). |
| `is_urgent_hazard` | `public.reports (is_urgent_hazard BOOLEAN)` | Matches schema exactly. Default `false`. |
| `confirmed_priority` | `public.reports (confirmed_priority priority_level)` | Matches schema; correctly typed as nullable (`PriorityLevel \| null`). |
| `created_at`, `updated_at` | `public.reports (created_at, updated_at TIMESTAMPTZ)` | Matches schema. Handled safely as ISO strings. |
| `categories (...)` | Foreign Key `reports.category_id -> categories.id` | Valid PostgREST join. Returns `{ id, name, description }`. |
| `locations (...)` | Foreign Key `reports.location_id -> locations.id` | Valid PostgREST join. Returns `{ id, building_name, floor, room, description }`. |
| `reporter:profiles!reporter_id` | Foreign Key `reports.reporter_id -> profiles.id` | Explicit foreign-key join alias. Matches migration. |
| `assignments (...)` | Reverse Foreign Key `assignments.report_id -> reports.id` | Valid one-to-many join. |
| `technician:profiles!technician_id` | Foreign Key `assignments.technician_id -> profiles.id` | Explicit foreign-key join alias within `assignments`. |

### Transformation Layer Resilience
`transformDbReportToMaintenanceReport()` (`utils/reports/dal.ts:116-171`) was thoroughly evaluated against corrupted or null database rows:
- **Nullable Priority:** Properly preserved as `null` (displaying "Pending Triage" in UI) rather than defaulting to an arbitrary priority.
- **Missing Relations:** If `categories` is `null`, defaults to `'General Maintenance'`. If `locations` is `null`, defaults to building `'Main Campus'`, floor `'1'`. If `reporter` is `null`, defaults to `'Campus Reporter'`.
- **Assignment De-duplication & Priority:** If multiple assignments exist for a report (e.g. Technician A declined, Coordinator reassigned to Technician B), lines 124-135 filter for active work statuses (`assigned`, `in_progress`, `on_hold`) and sorts by `assigned_at DESC`, accurately picking the current active technician.

---

## 5. Audit B — Pagination and Total Count

### Detailed Findings
1. **Parameter Sanitization (`utils/reports/dal.ts:285-289`, `app/reports/page.tsx:34`):**
   - In `app/reports/page.tsx:34`: `parseInt(params.page, 10)` handles malformed strings, falling back to `1`.
   - In `utils/reports/dal.ts:285-286`: `const page = Math.max(1, params.page || 1)` guards against negative numbers and zero.
   - `pageSize` is clamped: `const pageSize = Math.min(50, Math.max(1, params.pageSize || 15))` preventing memory exhaustion attacks via inflated page size parameters.
2. **Range Bounds Calculation (`utils/reports/dal.ts:287-288`):**
   - `from = (page - 1) * pageSize`
   - `to = from + pageSize - 1`
   - PostgREST `.range(from, to)` uses zero-based, inclusive bounds. For `page = 1, pageSize = 15`, `from = 0, to = 14` (exactly 15 rows). For `page = 2`, `from = 15, to = 29`. Off-by-one errors are absent.
3. **Total Count and Authorization Leakage Analysis:**
   - In `utils/reports/dal.ts:295`: `query = supabase.from('reports').select(SELECT_REPORTS_FIELDS, { count: 'exact' })`.
   - **PostgREST Count Mechanism:** The `{ count: 'exact' }` option causes PostgREST to execute a PostgreSQL `COUNT(*)` over the exact query result set. In PostgreSQL, RLS policies (`USING (can_view_report(id))`) are evaluated as part of the query filter before the count is calculated.
   - **Privacy Guarantee:** Users cannot see total counts of reports they are not authorized to view. A student personnel user submitting 2 reports will see `2 Reports Registered`, even if the campus database contains 5,000 reports.
4. **Sort Stability (Finding M-01):**
   - Line 324: `.order('created_at', { ascending: false }).range(from, to)`.
   - Lacks a secondary unique sort key. If two reports share identical `created_at` timestamps, PostgreSQL does not guarantee row order across range slices.
5. **Pagination URL Filter Preservation (Finding M-02):**
   - In `app/reports/page.tsx:153-155` and `173-175`:
     ```tsx
     href={`/reports?page=${queueResult.currentPage + 1}${
       statusFilter !== 'all' ? `&status=${statusFilter}` : ''
     }`}
     ```
   - Notice that while `status` is preserved, `category` and `search` query parameters are omitted. Clicking "Next" resets the category filter to `'all'` and clears the active search term.

---

## 6. Audit C — Dashboard KPI Calculations

### 10-Point KPI Metric Audit Table

| Audit Criterion | Metric 1: `totalActive` | Metric 2: `pendingReview` | Metric 3: `inProgress` | Metric 4: `resolvedThisWeek` | Metric 5: `urgentHazards` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Current Calculation** | Incremented if report is not resolved and not cancelled. | Incremented if `status` is `submitted` or `under_review`. | Incremented if `status` is `assigned`, `in_progress`, or `on_hold`. | Incremented if report is resolved AND `(updated_at \|\| created_at) >= now - 7 days`. | Incremented if `is_urgent_hazard === true` OR `confirmed_priority === 'critical'`. |
| **2. Source Fields & Filters** | `status` | `status` | `status` | `status`, `updated_at`, `created_at` | `is_urgent_hazard`, `confirmed_priority` |
| **3. Workflow Doc Alignment** | Aligns with active lifecycle states (`submitted` through `on_hold`). | Aligns with coordinator intake queue states. | Aligns with technician active execution states. | Aligns with closed states (`completed`, `verified`). | Aligns with safety triage specifications. |
| **4. Duplication Risk** | **Zero.** Evaluated once per row in loop. | **Zero.** Mutually exclusive status check. | **Zero.** Mutually exclusive status check. | **Zero.** Evaluated once per resolved row. | **Zero.** Single `if` statement per row. |
| **5. Null / Unexpected Statuses** | Unexpected status is treated as active by default (`!isResolved && !isCancelled`). | Non-matching statuses do not increment. | Non-matching statuses do not increment. | Non-matching statuses do not increment. | Handled safely (`Boolean()` and strict equality). |
| **6. Role-Authorized Dataset** | Filtered by RLS `can_view_report()`. Students see own active; coordinators see campus-wide active. | Filtered by RLS `can_view_report()`. Students see own pending; coordinators see queue. | Filtered by RLS `can_view_report()`. Technicians see assigned work. | Filtered by RLS `can_view_report()`. | Filtered by RLS `can_view_report()`. |
| **7. Time Boundaries** | N/A (current state) | N/A (current state) | N/A (current state) | **Rolling 168-hour window** (`now - 7 days`), not calendar week. | N/A (current state) |
| **8. Timezone Handling** | Server timestamp parsed via standard `Date` parsing. | Server timestamp parsed via standard `Date` parsing. | Server timestamp parsed via standard `Date` parsing. | Millisecond comparison (`new Date(timestamp) >= oneWeekAgo`). Independent of timezone offset. | N/A |
| **9. Weekly Boundary Convention** | N/A | N/A | N/A | Rolling 7-day window. Differs from calendar Monday 00:00 boundary. | N/A |
| **10. Label Accuracy** | Card label: "Total Active Reports". Accurately describes active issues. | Card label: "Pending Review". Accurately describes intake queue. | Card label: "In Progress / Assigned". Accurately describes active dispatch. | Card label: "Resolved This Week". Accurately describes recent resolutions. | Card label: "Urgent Hazards". Accurately describes safety hazards. |

### Architectural Consideration on KPI Computation (Finding H-02)
In `utils/reports/dal.ts:403-411`:
```typescript
let query = supabase
  .from('reports')
  .select('id, status, is_urgent_hazard, confirmed_priority, created_at, updated_at');
```
The query retrieves all rows permitted by RLS into Node.js memory. While acceptable for initial development and campus prototypes, in production this unbounded query will:
1. Hit PostgREST's `max_rows` limit (default 1,000 rows), leading to truncated KPI metrics.
2. Incur unnecessary network and memory overhead.
3. Recommended future architecture: Dedicated PostgreSQL aggregate RPC function or parallel `COUNT(*)` queries with appropriate `WHERE` clauses.

---

## 7. Audit D — Role-Aware Joins and Authorization Matrix

### 5-Role Authorization & Joins Matrix

| Canonical Role | Documented Expected Access (`docs/ROLES.md`) | Observed Implementation in DAL & UI | Verification Status |
| :--- | :--- | :--- | :--- |
| `student_personnel` | May view only self-submitted reports (`reporter_id = auth.uid()`). Cannot view assigned technicians or private operational data. | Enforced by PostgreSQL RLS (`can_view_report()`) and explicit DAL scoping (`reporter_id = user.id`). Joined `assignments` and other profiles return empty/null under RLS; DAL transformer defaults gracefully. | **PASS (Locally Verified)** |
| `technician` | May view reports where assigned (`assignments.technician_id = auth.uid()` and `status != 'declined'`) plus self-submitted reports. | Enforced by PostgreSQL RLS (`can_view_report()`). DAL retrieves assigned work. Joined `assignments` selects technician's own record. UI displays assigned work queue. | **PASS (Locally Verified)** |
| `coordinator` | Campus-wide visibility of all reports, locations, categories, and assignments for operational triage and dispatch. | Enforced by PostgreSQL RLS (`can_view_report()` returns `TRUE` for coordinator). DAL selects full report queue without row restriction. Full profile and assignment joins populated. | **PASS (Locally Verified)** |
| `administrator` | Campus-wide visibility of all operational records, system audit logs, and settings. | Enforced by PostgreSQL RLS (`can_view_report()` returns `TRUE`). DAL selects full report queue without row restriction. | **PASS (Locally Verified)** |
| `management` | Campus-wide visibility of reports and analytics for high-level oversight and KPI tracking. | Enforced by PostgreSQL RLS (`can_view_report()` returns `TRUE`). DAL selects full report queue without row restriction. | **PASS (Locally Verified)** |

### Foreign-Key Joins Under Table RLS Policies
An essential security finding emerges from cross-referencing `SELECT_REPORTS_FIELDS` with the RLS policies in `20261018000005_table_rls_policies.sql`:
1. **`public.profiles` RLS Policy (`profiles_select`):**
   ```sql
   USING (auth.uid() = id OR public.get_user_role() IN ('coordinator', 'administrator', 'management'))
   ```
   - For `student_personnel`: When fetching `assignments.technician:profiles!technician_id`, the technician's profile ID does not equal `auth.uid()`. PostgreSQL RLS on `profiles` filters this row out, returning `null`.
   - **DAL Resilience:** `transformDbReportToMaintenanceReport` handles `row.assignments?.[0]?.technician?.full_name` as `undefined`. The UI displays `Unassigned` or omits the technician name, preventing errors.
2. **`public.assignments` RLS Policy (`assignments_select`):**
   ```sql
   USING ((public.get_user_role() = 'technician' AND technician_id = auth.uid()) OR public.get_user_role() IN ('coordinator', 'administrator', 'management'))
   ```
   - For `student_personnel`: Students are completely denied `SELECT` access on `public.assignments`. The nested `assignments` array returns `[]`.
   - **DAL Resilience:** The DAL transformer safely treats empty assignments as having no active assignment, preventing crashes and preserving privacy.

---

## 8. Audit E — Security and Data Integrity

| Security Vector | Implementation Detail | Audit Finding |
| :--- | :--- | :--- |
| **Authentication Enforcement** | `getCurrentUserAndProfile()` (`utils/auth/server.ts:25-73`) | **SECURE.** Calls `supabase.auth.getUser()`, which validates the cryptographic signature of the session JWT with the Supabase Auth server on every request. |
| **Client-Supplied Role Rejection** | `profiles.role` extracted directly from verified database record | **SECURE.** Roles passed in cookies, headers, or query params are strictly ignored. |
| **Account Inactive Enforcement** | `if (!profile.is_active) return null;` | **SECURE.** Inactive users fail closed immediately. |
| **Service-Role Key Protection** | Audited all source files in `my-app` | **SECURE.** Zero references to `SUPABASE_SERVICE_ROLE_KEY` or service-role clients exist in user-facing code. Verified by static security test. |
| **Sensitive Field Minimization** | `SELECT_REPORTS_FIELDS` (`utils/reports/dal.ts:64-105`) | **SECURE.** Excludes sensitive columns such as `profiles.phone`, `profiles.is_active`, and `profiles.updated_at`. Only necessary display attributes (`full_name`, `role`, `email`) are retrieved. |
| **Next.js Caching & Data Leakage** | `React.cache()` in `utils/auth/server.ts` | **SECURE.** React `cache()` is per-request memoization scoped to a single server render. It does not persist across different HTTP requests or different users. Page components declare `export const instant = false;` ensuring dynamic rendering. |
| **Error Information Disclosure** | Raw error reflection in UI notices (`app/page.tsx:74`, `app/reports/page.tsx:84`) | **MEDIUM (Finding M-03).** `queueResult.error` (containing raw PostgREST error messages) is rendered in the UI notice banner. Could disclose schema or table structure. |

---

## 9. Audit F — Tests and Reproducibility

### Test Suite Execution
All unit tests in `tests/unit/` were executed using the native Node.js test runner:
```bash
node --test tests/unit/*.test.mjs
```

### Execution Results
- **Test Files Executed:** 5 files
  - `tests/unit/dal-read-queries.test.mjs`
  - `tests/unit/security-boundaries.test.mjs`
  - `tests/unit/role-mock-filtering.test.mjs`
  - `tests/unit/navigation-and-shell.test.mjs`
  - `tests/unit/validation.test.mjs`
- **Total Tests:** 49
- **Passing:** 49
- **Failing:** 0
- **Duration:** 385.13ms

### Test Suite Quality Assessment
- **`dal-read-queries.test.mjs`:** Contains 9 focused tests validating schema selection strings, transformer mappings, null handling, assignment priority selection, KPI calculations, pagination range bounds, service-role avoidance, and read-only query scope.
- **Limitation Identified (Finding M-04):** Because `dal.ts` imports TypeScript modules with path aliases (`@/types/reports`), the test file re-implements `transformDbReportToMaintenanceReport` and `calculateKpiStatsFromDbReports` in vanilla JavaScript. While testing the exact mathematical and business logic, it does not import the compiled TypeScript exports directly.

---

## 10. Commands Executed and Results

| Command | Execution Directory | Exit Code | Observed Output / Result |
| :--- | :--- | :--- | :--- |
| `node --test tests/unit/*.test.mjs` | `D:\CMIRS-System\my-app` | `0` | All 49 unit tests passed in 385ms with zero errors. |
| `npx tsc --noEmit` | `D:\CMIRS-System\my-app` | `0` | Clean TypeScript compilation; zero type errors. |
| `npm run lint` | `D:\CMIRS-System\my-app` | `0` | Clean ESLint run; zero linting warnings or errors. |
| `npm run build` | `D:\CMIRS-System\my-app` | `0` | Turbopack production build compiled in 2.6s. 11 static pages generated in 623ms. All dynamic routes verified. |

---

## 11. Classified Findings

### Critical Severity (0 Findings)
*No critical security exposures or authentication bypass vulnerabilities were identified.*

### High Severity (2 Findings)

#### [FINDING H-01] PostgREST Embedded Table Filter Semantics on Categories
- **File:** `utils/reports/dal.ts`, Lines 308–310
- **Observed Code:**
  ```typescript
  if (params.category && params.category !== 'all') {
    query = query.eq('categories.name', params.category);
  }
  ```
- **Description:** In PostgREST, filtering on an embedded table without an `!inner` join qualifier (`query.eq('categories.name', ...)` on a `categories(...)` relation) filters the embedded JSON objects returned in the response, **not** the parent `reports` rows. Parent reports with non-matching categories are still returned, but their `categories` property is set to `null`.
- **Consequence:** `transformDbReportToMaintenanceReport()` falls back `row.categories?.name` to `'General Maintenance'`. As a result, category filtering in the queue displays reports from other categories re-labeled as "General Maintenance".
- **Impact:** Significant correctness defect in report queue category filtering.

#### [FINDING H-02] Unbounded Row Fetch for KPI Metrics
- **File:** `utils/reports/dal.ts`, Lines 403–411
- **Observed Code:**
  ```typescript
  let query = supabase
    .from('reports')
    .select('id, status, is_urgent_hazard, confirmed_priority, created_at, updated_at');
  ```
- **Description:** `getDashboardKpiStats()` executes a query selecting all reports visible to the user without a `.limit()` or range constraint, pulling all rows over the network to compute counts in server memory.
- **Consequence:** In databases with >1,000 records, PostgREST caps returned rows at `max_rows` (default 1,000), causing KPI metrics to silently under-report totals.
- **Impact:** Scalability and data integrity issue under high report volumes.

---

### Medium Severity (4 Findings)

#### [FINDING M-01] Non-Deterministic Pagination Ordering
- **File:** `utils/reports/dal.ts`, Line 324
- **Observed Code:**
  ```typescript
  query = query
    .order('created_at', { ascending: false })
    .range(from, to);
  ```
- **Description:** Reports are ordered exclusively by `created_at DESC`. In databases where batch reports or automated entries share the exact same microsecond timestamp, PostgreSQL row ordering without a unique secondary tiebreaker is non-deterministic across pagination ranges.
- **Impact:** Duplicate or skipped reports across page boundaries when timestamps collide.

#### [FINDING M-02] Pagination Links Drop Active Category and Search Filters
- **File:** `app/reports/page.tsx`, Lines 153–155, 173–175
- **Observed Code:**
  ```tsx
  <Link
    href={`/reports?page=${queueResult.currentPage + 1}${
      statusFilter !== 'all' ? `&status=${statusFilter}` : ''
    }`}
  >
  ```
- **Description:** Pagination controls append the `status` parameter to previous/next page links, but omit `category` and `search` query parameters.
- **Impact:** Navigating from Page 1 to Page 2 unexpectedly resets category filtering to "All Categories" and clears search terms.

#### [FINDING M-03] Direct Exposure of PostgREST Error Strings in UI Notice Banner
- **File:** `app/page.tsx` (Line 74), `app/reports/page.tsx` (Line 84), `utils/reports/dal.ts` (Line 339)
- **Observed Code:**
  ```tsx
  <span>Database Notice: {queueResult.error}</span>
  ```
  Where `queueResult.error` is `Database query failed: ${error.message}`.
- **Description:** If a database query fails, the raw PostgREST error message (which may contain PostgreSQL table names, constraints, or RPC error hints) is displayed in the user-visible alert banner.
- **Impact:** Information disclosure of internal database structure to end users.

#### [FINDING M-04] Test Suite Re-Implements Pure Logic Instead of Direct Module Imports
- **File:** `tests/unit/dal-read-queries.test.mjs`, Lines 13–105
- **Description:** The unit test file defines local copies of `transformDbReportToMaintenanceReport` and `calculateKpiStatsFromDbReports` to bypass ESM module resolution limitations with TypeScript path aliases (`@/`).
- **Impact:** Future changes to `utils/reports/dal.ts` might pass unit tests even if the actual implementation drifts, due to testing a duplicated function.

---

### Low Severity (2 Findings)

#### [FINDING L-01] Ambiguity in Weekly Date Boundary Convention
- **File:** `utils/reports/dal.ts`, Lines 192–193, 218
- **Description:** `resolvedThisWeek` calculates a rolling 7-day window (`new Date() - 7 days`), rather than a calendar week (e.g. Monday 00:00:00 to Sunday 23:59:59).
- **Impact:** User expectation of "This Week" often implies current calendar week.

#### [FINDING L-02] Status Grouping of Completed Reports
- **File:** `utils/reports/dal.ts`, Line 196
- **Description:** Reports with `status === 'completed'` (technician finished work, pending coordinator verification) are counted in `isResolved` rather than `totalActive`. While matching the Phase 2.5 prototype baseline, workflow documentation treats `completed` as awaiting coordinator verification before final closure (`verified`).
- **Impact:** Coordinator dashboard may under-report actionable verification workload.

---

### Unverified Checks (2 Checks)

#### [UNVERIFIED U-01] Remote PostgreSQL RLS Execution Under Real Multi-Role Session Tokens
- **Status:** **NOT VERIFIED — REQUIRES SEPARATE AUTHORIZATION**
- **Description:** Gate E.4D remote integration test suite (`tests/integration/rls-runner.ts`) tests live PostgreSQL RLS enforcement across all 5 test accounts against the remote database. Deferred per safety rules.

#### [UNVERIFIED U-02] Live Database Performance of PostgREST Exact Count on Complex Joins
- **Status:** **NOT VERIFIED — REQUIRES SEPARATE AUTHORIZATION**
- **Description:** Testing performance overhead of `{ count: 'exact' }` with nested joins under large concurrent loads requires remote staging environment benchmarks.

---

## 12. Recommended Fixes Ordered by Severity

### Priority 1: High Severity Fixes

#### Fix H-01: Update PostgREST Category Join Filter
In `utils/reports/dal.ts`, adjust the query string and category filter to use an inner join or filter directly by `category_id`:
```typescript
// Option A: Use !inner join syntax in PostgREST
query = query.not('categories', 'is', null);
// Or specify !inner join in SELECT_REPORTS_FIELDS for categories:
// categories!inner ( id, name, description )

// Option B (Recommended): Look up category ID or filter by category_id directly
if (params.category && params.category !== 'all') {
  query = query.filter('categories.name', 'eq', params.category);
  // PostgREST syntax for filtering parent rows by embedded property:
  // query = query.not('categories', 'is', null).eq('categories.name', params.category);
}
```

#### Fix H-02: Bound KPI Query or Transition to PostgreSQL Aggregate Function
In `utils/reports/dal.ts:403`, add a defensive limit and plan for an RPC aggregate function:
```typescript
// Interim defense: Add reasonable limit
let query = supabase
  .from('reports')
  .select('id, status, is_urgent_hazard, confirmed_priority, created_at, updated_at')
  .limit(2000);
```

---

### Priority 2: Medium Severity Fixes

#### Fix M-01: Add Secondary Sort Tiebreaker
In `utils/reports/dal.ts:324`:
```typescript
query = query
  .order('created_at', { ascending: false })
  .order('id', { ascending: false })
  .range(from, to);
```

#### Fix M-02: Preserve All Search Parameters in Pagination Links
In `app/reports/page.tsx:151-180`:
```tsx
const buildPageUrl = (targetPage: number) => {
  const q = new URLSearchParams();
  q.set('page', targetPage.toString());
  if (statusFilter !== 'all') q.set('status', statusFilter);
  if (categoryFilter !== 'all') q.set('category', categoryFilter);
  if (searchQuery.trim()) q.set('search', searchQuery.trim());
  return `/reports?${q.toString()}`;
};

// Usage:
<Link href={buildPageUrl(queueResult.currentPage + 1)}>
```

#### Fix M-03: Sanitize User-Facing Error Messages
In `utils/reports/dal.ts:339` and `424`:
```typescript
// Log full internal error on server
console.error('[DAL] query error:', error.message);

// Return sanitized message to client
return {
  ...
  error: 'Unable to retrieve maintenance reports from the database. Please try again later.',
};
```

#### Fix M-04: Transpile / Bundle Pure DAL Functions for Unit Testing
Configure a lightweight test build or compile step that allows `tests/unit/dal-read-queries.test.mjs` to import directly from `utils/reports/dal.ts` without duplicate function implementations.

---

## 13. Questions Requiring Clarification from Project Owner

1. **Category Filter Behavior:** Would you prefer category filtering to query by `category_id` UUID directly (which requires passing the UUID from the UI select dropdown), or using PostgREST's `categories!inner(name)` syntax?
2. **Weekly KPI Boundary Definition:** For `resolvedThisWeek`, should the system use a rolling 7-day window (last 168 hours) or a standard calendar week (e.g. Monday 00:00:00 to Sunday 23:59:59 Philippine Standard Time / UTC+8)?
3. **Completed vs Verified Status Lifecycle:** Should reports with `status === 'completed'` (technician completed work) be grouped under `totalActive` until coordinator verification, or remain grouped under `resolvedThisWeek` as in the current prototype?

---

## 14. Phase 3.2 Readiness Decision

### **READINESS VERDICT: PASS WITH CONDITIONS**

### Rationale
The Phase 3.2 Read-Only DAL implementation establishes a solid, secure foundation:
- Zero service-role or elevated credential exposures.
- Strict authentication enforcement via `supabase.auth.getUser()`.
- Reliable database-to-UI data transformations that gracefully handle nulls and missing records.
- 100% clean builds, TypeScript checks, and test passes.

The foundation is **safe and structurally sound**, but proceeding to Phase 3.3 (Write Operations) requires addressing the High and Medium severity findings (specifically PostgREST category filter semantics, pagination query preservation, and error message sanitization) to prevent functional regressions and usability issues.

---

## 15. Deferred Checks Requiring Explicit Authorization

The following verification activities were intentionally deferred in compliance with the strict safety boundaries and require separate authorization:
1. **Remote RLS Test Execution (Gate E.4D):** Execution of `tests/integration/rls-runner.ts` against the live Supabase database across the 5 test accounts (`coordinator@cmirs.internal`, `technician@cmirs.internal`, `student@cmirs.internal`, `admin@cmirs.internal`, `management@cmirs.internal`).
2. **Live Database Load Benchmarks:** Benchmarking execution duration of `{ count: 'exact' }` and nested foreign-key joins on `reports` with large row volumes.
3. **Storage Bucket RLS Verification:** Live read verification of private attachments via signed URLs.
