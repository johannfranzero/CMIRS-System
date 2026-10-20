# Phase 3.2 Remediation Report: Read-Only DAL, Pagination, KPIs, and Role-Aware Joins

**Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
**Workspace:** `D:\CMIRS-System\my-app`  
**Remediation Target:** Verified Findings from `PHASE_3_2_VERIFICATION_REPORT.md`  
**Lead Engineer:** Senior Full-Stack Engineer, Next.js App Router Specialist, Supabase/PostgreSQL Reviewer & Security Auditor  
**Date:** October 20, 2026  
**Final Readiness Verdict:** **PASS**

---

## 1. Executive Summary

This remediation report documents the successful, local-only resolution of all verified findings identified in `PHASE_3_2_VERIFICATION_REPORT.md`. All remediations were executed in strict accordance with the project owner's authorized scope and approved business decisions.

### Key Remediation Accomplishments
1. **Finding 1 (High — Category Filter Correctness):** Fixed PostgREST category filtering in `utils/reports/dal.ts` by updating `SELECT_REPORTS_FIELDS` to enforce an inner join (`categories!inner`), preventing non-matching parent reports from lingering in filtered result sets. The filter now natively supports both direct `category_id` UUID matching and `categories.name` inner-join matching.
2. **Finding 2 (High — KPI Row Limit and Truncation Guard):** Implemented explicit dataset truncation detection via PostgREST `{ count: 'exact' }`. If the total matching records in the database exceed the fetched records, `getDashboardKpiStats()` refuses to silently compute misleading, incomplete counts and returns an explicit, sanitized notice instructing the system that database-level aggregation is required.
3. **Finding 3 (Medium — Deterministic Pagination):** Added a deterministic secondary sort tiebreaker (`.order('created_at', { ascending: false }).order('id', { ascending: false })`) to eliminate pagination drift across identical timestamps.
4. **Finding 4 (Medium — Preserve Filters During Pagination):** Implemented `buildReportsQueueUrl()` to ensure Previous and Next pagination links preserve `status`, `category`, and `search` query parameters, with safe URL encoding for spaces and special characters.
5. **Finding 5 (Medium — Sanitize Database Errors in UI):** Replaced internal technical PostgREST errors with concise, user-friendly messages. Both `app/page.tsx` and `app/reports/page.tsx` now accurately reflect degraded/notice states rather than falsely claiming an active live connection when a query fails.
6. **Finding 6 (Medium — Improve DAL Test Reliability):** Extracted pure domain transformations and helper functions into `utils/reports/transform.ts`, allowing unit tests (`tests/unit/dal-read-queries.test.mjs`) to import directly from the production codebase without code duplication.
7. **Approved Business Decision 1 (Calendar Week in PHT):** Implemented `getPhilippineWeekBounds()`, enforcing calendar weeks in Philippine Standard Time (PST / Asia/Manila, UTC+8) from Monday 12:00 AM to following Monday 12:00 AM exclusive. Aligned `resolvedThisWeek` strictly to the report's `updated_at` resolution timestamp, forbidding fallback substitution to `created_at`.
8. **Approved Business Decision 2 (`completed` Reports as Total Active):** Updated KPI calculation logic so that reports in `completed` status (work finished by technician, pending coordinator inspection) count toward `totalActive`, and only `verified` reports are classified as resolved.

---

## 2. Findings and Resolution Status

| Finding ID | Severity | Area | Status | Resolution Summary |
| :--- | :--- | :--- | :--- | :--- |
| **FINDING H-01** | **HIGH** | Category Filtering | **RESOLVED** | Specified `categories!inner` in `SELECT_REPORTS_FIELDS` and added dual-mode filter support (`category_id` for UUIDs, `categories.name` for names). Non-matching reports are strictly excluded. |
| **FINDING H-02** | **HIGH** | KPI Limit & Aggregation | **RESOLVED** | Added `{ count: 'exact' }` and `isDatasetTruncated()` check. Explicitly rejects incomplete aggregations if total matching records exceed fetched rows. |
| **FINDING M-01** | **MEDIUM** | Pagination Determinism | **RESOLVED** | Added `.order('id', { ascending: false })` as a secondary unique sort field following `created_at DESC`. |
| **FINDING M-02** | **MEDIUM** | Pagination URL Preservation | **RESOLVED** | Created and integrated `buildReportsQueueUrl()` in `app/reports/page.tsx`, preserving `status`, `category`, and `search`. |
| **FINDING M-03** | **MEDIUM** | Error Sanitization | **RESOLVED** | Replaced raw PostgREST error reflections with sanitized user notices. Updated live status banners to indicate degraded states when queries fail. |
| **FINDING M-04** | **MEDIUM** | Unit Test Reliability | **RESOLVED** | Extracted pure helpers into `utils/reports/transform.ts` and updated `tests/unit/dal-read-queries.test.mjs` to import directly from production code. |
| **DECISION 1** | **APPROVED** | Calendar Week in PHT | **RESOLVED** | Implemented Monday 12:00 AM to next Monday 12:00 AM UTC+8 calendar week boundaries. Resolution strictly checks `updated_at` (no `created_at` fallback). |
| **DECISION 2** | **APPROVED** | `completed` Reports Active | **RESOLVED** | Updated `calculateKpiStatsFromDbReports()` so `completed` increments `totalActive` and only `verified` increments resolved counts. |

---

## 3. Files Changed and Reason for Each Change

### 1. `utils/reports/transform.ts` (New File)
- **Reason:** Extracted pure transformation, calculation, and URL construction logic to allow clean, direct imports in unit tests without module resolution alias friction.
- **Key Functions:**
  - `getPhilippineWeekBounds(referenceDate)`: Computes exact Monday 00:00:00 to next Monday 00:00:00 UTC+8 calendar week boundaries.
  - `isDateInPhilippineWeek(dateIso, referenceDate)`: Validates whether a timestamp falls within the current Philippine calendar week.
  - `transformDbReportToMaintenanceReport(row)`: Pure null-safe database-to-UI report transformer with active assignment prioritization.
  - `calculateKpiStatsFromDbReports(reports, referenceDate)`: Pure KPI calculator enforcing `completed` as active and resolution timestamps within the Philippine calendar week.
  - `isDatasetTruncated(totalCount, fetchedCount)`: Guard helper detecting whether PostgREST truncated row results.
  - `buildReportsQueueUrl(params)`: Parameter-preserving, URL-encoded pagination link builder.
  - `sanitizeErrorMessage(error, fallback)`: Defense-in-depth sanitization preventing raw SQL leaks.

### 2. `utils/reports/dal.ts` (Modified)
- **Reason:** Integrated inner join semantics for categories, secondary sort tiebreaker, truncation detection, error sanitization, and re-exported pure helpers.
- **Changes:**
  - Updated `SELECT_REPORTS_FIELDS` to `categories!inner (id, name, description)`.
  - Added UUID regex detection in category filtering to filter on indexed `category_id` directly when UUID is passed, and `categories.name` with inner join when category label is passed.
  - Added `.order('id', { ascending: false })` to query ordering.
  - Added `{ count: 'exact' }` and `isDatasetTruncated()` check in `getDashboardKpiStats()`.
  - Replaced raw error strings with sanitized client notices.
  - Re-exported all pure functions from `./transform`.

### 3. `app/reports/page.tsx` (Modified)
- **Reason:** Integrated parameter-preserving pagination and sanitized notice display.
- **Changes:**
  - Imported and used `buildReportsQueueUrl` for `Previous` and `Next` links.
  - Conditioned live backend banner on `!queueResult.error`. Displays "Database Service Notice: Degraded State" when an error is present.
  - Rendered sanitized notice banner.

### 4. `app/page.tsx` (Modified)
- **Reason:** Prevented UI from falsely claiming complete live connection when errors occur.
- **Changes:**
  - Conditioned live connection banner on `!kpiResult.error && !queueResult.error`. Displays "Database Service Notice: Degraded State" upon query failure.
  - Sanitized notice banner display.

### 5. `tests/unit/dal-read-queries.test.mjs` (Modified)
- **Reason:** Replaced duplicated function bodies with direct production imports from `utils/reports/transform.ts`, and added 9 new targeted test suites covering all findings and approved business decisions.

---

## 4. Important Implementation Decisions

### A. PostgREST Embedded Resource Filtering
By qualifying the join as `categories!inner (id, name, description)` in `SELECT_REPORTS_FIELDS`, PostgREST converts the underlying relation from a `LEFT OUTER JOIN` to an `INNER JOIN`. When a user filters by category (e.g. `query.eq('categories.name', 'Plumbing & Water')`), PostgreSQL filters the parent `reports` rows directly. Because the CMIRS database schema enforces `category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT`, an inner join on categories matches 100% of valid reports when no filter is applied, guaranteeing that unfiltered queues remain completely intact.

### B. Truncation Guard Architecture for KPIs
Rather than attempting to bypass server limits with unbounded row fetches, `getDashboardKpiStats()` requests `{ count: 'exact' }`. If PostgREST's response indicates that total matching records in the database exceed the fetched array length (`count > data.length`), the DAL recognizes that complete Node.js aggregation cannot be guaranteed. To uphold data integrity and avoid misleading metrics, it returns a sanitized notification stating that total records exceed the single-request limit and that database-level aggregation is required.

### C. Philippine Standard Time (PST) Calendar Week Boundary
Philippine Standard Time is fixed at UTC+8 with no daylight saving time adjustments. To guarantee that calendar week boundaries are calculated identically regardless of server location or local timezone settings, `getPhilippineWeekBounds()` adds an explicit 8-hour millisecond offset (`8 * 3600 * 1000`) before evaluating UTC day-of-week and dates. It then calculates the exact UTC instant of Monday 00:00:00.000 Manila time and the following Monday 00:00:00.000 Manila time.

---

## 5. Tests Added and Modified

The test suite in `tests/unit/dal-read-queries.test.mjs` was expanded from 9 tests to 18 targeted tests, with all pure function duplicates removed in favor of direct production imports.

| Test Case Name | Target Requirement | Status |
| :--- | :--- | :--- |
| `Finding 1 & Schema: Verified column selection enforces categories!inner join semantics` | Finding 1 (Inner join syntax) | **PASS** |
| `Finding 1: Category filter excludes non-matching reports and handles UUIDs and names` | Finding 1 (Dual-mode category filter) | **PASS** |
| `Finding 2: Dataset truncation detection prevents silent undercounting of KPI metrics` | Finding 2 (Truncation detection) | **PASS** |
| `Finding 2: Large dataset KPI aggregation calculates correctly when complete data is provided` | Finding 2 (Large dataset boundary) | **PASS** |
| `Finding 3: Deterministic pagination sort applies created_at DESC and id DESC tiebreaker` | Finding 3 (Secondary sort tiebreaker) | **PASS** |
| `Finding 4: Pagination URL builder preserves status, category, and search filters with encoding` | Finding 4 (Parameter preservation & URL encoding) | **PASS** |
| `Finding 5: Database errors are sanitized and never expose raw SQL or internal details` | Finding 5 (Error sanitization & raw leak prevention) | **PASS** |
| `Approved Business Decision 1: Calendar Week in Philippine Standard Time (PST / UTC+8)` | Business Decision 1 (PHT Monday boundary calculation) | **PASS** |
| `Approved Business Decision 1: Never substitutes created_at for resolution timestamp` | Business Decision 1 (Strict updated_at verification) | **PASS** |
| `Approved Business Decision 2: completed reports count as Total Active, NOT resolved` | Business Decision 2 (completed is active, verified is resolved) | **PASS** |
| `DAL Transformer: Accurately maps joined database row to MaintenanceReport` | DAL Transformation mapping | **PASS** |
| `DAL Transformer: Handles nullable confirmed_priority as null (Pending Triage)` | Nullable triage priority | **PASS** |
| `DAL Transformer: Active assignment priority over historical declined/reassigned rows` | Assignment deduplication & priority | **PASS** |
| `DAL Transformer: Gracefully falls back when relations are missing or null` | Relation fallback safety | **PASS** |
| `DAL Facility Breakdown: Accurately groups report counts by campus facility` | Facility breakdown aggregation | **PASS** |
| `Pagination: Computes bounds and limits correctly` | Page range calculation | **PASS** |
| `Security Guard: Avoidance of service-role credentials in client/user-facing code` | Service-role key avoidance | **PASS** |
| `Read-Only Scope: DAL contains strictly read-only operations` | Read-only mutation avoidance | **PASS** |

---

## 6. Actual Validation Results

All checks were executed locally from `D:\CMIRS-System\my-app`.

| Verification Check | Exact Command | Exit Code | Observed Output / Result |
| :--- | :--- | :--- | :--- |
| **Unit Test Suite** | `node --test tests/unit/*.test.mjs` | `0` | **58/58 passing tests** across 5 test suites (381.9ms). 0 failures, 0 skipped. |
| **TypeScript Compilation** | `npx tsc --noEmit` | `0` | Zero type errors. 100% type-safe across all App Router routes and components. |
| **ESLint Validation** | `npm run lint` | `0` | Zero ESLint warnings or errors. |
| **Production Build** | `npm run build` | `0` | Turbopack compiled successfully in 3.6s. 11 static pages generated in 699ms. All dynamic routes verified. |

---

## 7. Business Decisions & Unresolved Issues

### Approved Business Decisions Implemented
1. **`resolvedThisWeek` Calendar Week:** Implemented strictly as Monday 12:00 AM through following Monday 12:00 AM (exclusive) in Philippine Standard Time (UTC+8).
2. **Resolution Timestamp Integrity:** Implemented using `updated_at` on `verified` reports without substituting `created_at`.
3. **`completed` Status Lifecycle:** Implemented as active (`totalActive`), pending verification before resolution.

### Unresolved Issues / Future Migration Notes
1. **Long-Term Database Aggregation RPC:** The current KPI truncation guard safely prevents misleading counts when visible reports exceed 1,000 rows. For Phase 3.3 or Phase 4 deployment with massive historical data, a dedicated database RPC function (e.g. `get_dashboard_kpi_counts()`) should be scheduled in a future migration to execute server-side `COUNT(*)` aggregates in PostgreSQL.

---

## 8. Final Readiness Verdict

### **FINAL READINESS VERDICT: PASS**

All conditions set forth in `PHASE_3_2_VERIFICATION_REPORT.md` and authorized in the owner directive have been completely remediated and locally verified. The Data Access Layer is robust, deterministic, filter-resilient, secure, and ready to serve as the foundation for Phase 3.3.

---

## 9. Explicit Confirmation of Authorization Boundaries

In accordance with Section "Authorization Scope" of the remediation directive, we confirm:
- **Zero remote Supabase operations** occurred.
- **Zero remote integration tests** (including Gate E.4D or `rls-runner.ts`) were executed.
- **Zero database, schema, migration, RPC, trigger, RLS policy, Storage, seed-data, or Auth account changes** were made.
- **Zero service-role keys** were used or introduced.
- **Zero Phase 3.3 write mutations** were implemented.
- **Zero dependency modifications** occurred.
- **Zero Git commits, pushes, or resets** occurred.
- **`.env.local` was untouched**, and no credentials were exposed.
- All modifications were strictly confined to authorized local TypeScript/TSX and unit test files.
