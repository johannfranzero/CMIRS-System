# CMIRS — Phase 4D: Real Data Audit & Report Submission Repair

**Date:** 2026-10-21
**Scope:** Audit every functional page for fabricated runtime data · Repair the root cause of report submission failure at `/reports/new`
**Baseline commit:** `d2a3e1d` · **Phase 4D commits:** `ebb84a2`, `23031cd`, `890773a`
**Supersedes:** `docs/frontend/REPORT_SUBMISSION_AND_REAL_DATA_FIX_REPORT.md`

---

## Executive Summary

1. **Root cause of the `/reports/new` submission failure — an illegal export from a `'use server'` module.**
   `actions/reports.ts` carried the file-level `'use server'` directive and exported `INITIAL_ACTION_STATE`, a **plain object**. Next.js enforces that such modules export **async functions only**; the generated server-actions loader therefore threw
   `A "use server" file can only export async functions, found object.`
   while the `/reports/new` route module was being evaluated. The report submission form never rendered, so **submission was impossible for every role**. The constant now lives in a plain (non-directive) module, `utils/reports/action-state.ts`.

2. **Fabricated runtime values were removed from every functional page.** The Operations Dashboard previously rendered fabricated technician identities (Alex Morgan, Elena Rostova, Marco Bellini), a fabricated "94.2% On-Time" resolution SLA, and a "15 repairs verified and closed this week" statistic. All of these came from the Phase 1 fixture module `data/mock-reports.ts`, which has been **deleted**. The dashboard is now driven exclusively by live, RLS-scoped Supabase queries; widgets whose backend is not implemented state that plainly instead of inventing numbers.

3. **Silent demo-data fallbacks were removed from the reference-catalog DAL loaders.** `getActiveCategories()`, `getActiveLocations()` and `getActiveTechnicians()` substituted hardcoded fixture rows whenever a query failed **or returned zero rows** — including two non-existent technician identities offered to coordinators in the assignment dropdown. They now fail honestly (empty list + sanitized error), and the UI renders real empty / unavailable states.

4. **Database errors are now surfaced accurately instead of being flattened into one generic string**, and the submission form is hardened against double submissions, unusable reference data, and misleading attachment-failure feedback.

**Verification performed locally:** TypeScript 0 errors · ESLint 0 errors / 0 warnings · `next build` succeeds · **157 unit tests, 155 pass, 2 fail** (both pre-existing, out of scope — see §6). No remote query or mutation was performed.

---

## 1. Root Cause of the Report Submission Failure

### 1.1 The mechanism

`actions/reports.ts` begins with the file-level `'use server'` directive. Next.js enforces a hard invariant on such modules in
`next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`:

```js
export function ensureServerEntryExports(exports) {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value !== 'function') {
      throw new Error(
        `A "use server" file can only export async functions, found ${typeof value}.\n` +
        `Read more: https://nextjs.org/docs/messages/invalid-use-server-value`
      );
    }
  }
}
```

`ensureServerEntryExports()` is invoked by the **generated server-actions loader module** for every route that imports the action module. Before the fix, `actions/reports.ts` exported:

```ts
export const INITIAL_ACTION_STATE: ActionFormState<never> = { status: 'idle' };
```

— an object, not a function. The loader therefore threw at **module-evaluation time**, before the page could render.

### 1.2 Direct evidence (Next.js dev-server log)

`.next/dev/logs/next-development.log` records the failure verbatim, and the generated loader frame names the offending export:

```
{"timestamp":"00:26:46.255","source":"Server","level":"ERROR","message":"⨯ Error: A \"use server\" file can only export async functions, found object.\nRead more: https://nextjs.org/docs/messages/invalid-use-server-value"}
{"timestamp":"00:26:46.447","source":"Browser","level":"ERROR","message":"Uncaught Error: A \"use server\" file can only export async functions, found object.
    at module evaluation (.next-internal\\server\\app\\reports\\new\\page\\actions.js (server actions loader):1:1)
    at NewReportPage (app\\reports\\new\\page.tsx:20:9)
    > 1 | export {uploadReportAttachmentAction as '602e863ac46fbdad3c253d2c58fb8bd6fbcb99575d'} from 'ACTIONS_MODULE0'
      |          ^
      2 | export {submitReportAction as '701b9747cb23daf7d0b500614b66f84a5efc5bf6b8'} from 'ACTIONS_MODULE0'
      3 | export {INITIAL_ACTION_STATE as '7f798d690c04c76ef06e1e4b7af0f3777c5c88c782'} from 'ACTIONS_MODULE0'
      4 | export {logoutAction as '005d802c663587bcfea7806ef767e884b49c730f32'} from 'ACTIONS_MODULE1'"}
```

`ACTIONS_MODULE0` is `actions/reports.ts`; line 3 of the generated loader is the illegal `INITIAL_ACTION_STATE` re-export.

### 1.3 Compiled-artifact evidence

| Artifact | Before the fix | After the fix |
| --- | --- | --- |
| Client chunk | `createServerReference("7fa6a4c8…", callServer, void 0, findSourceMapURL, "INITIAL_ACTION_STATE")` — the client received a **server-reference proxy function** instead of the idle state | `e.s(["f", 0, {status:"idle"}])` — the client receives the **real object** |
| `.next/server/server-reference-manifest.js` | `INITIAL_ACTION_STATE` registered as a server-action export of `actions/reports.ts` | `INITIAL_ACTION_STATE` **absent** from the manifest |
| SSR server-actions loader | `ensureServerEntryExports([S,T,U,V,W,X,Y,Z,$,_,N])` — 11 exports, one of them an object | `ensureServerEntryExports([Q,R,S,T,U,V,W,X,Y,Z])` with **10** `registerServerReference(...)` calls — every export is a function |

The build itself never failed, because the check runs at **runtime module evaluation**, not at compile time. That is why the defect survived the previous phase.

### 1.4 Secondary effect on the form

React 19's `mountActionState` stores the provided initial state **as-is**; it does not lazily invoke it. With a server-reference proxy as the initial state, `state.status` was `undefined` rather than `'idle'`, so every status-driven branch in the form (`state.status === 'error'`, `state.status === 'success'`) was operating on a non-conforming value. Moving the constant out of the `'use server'` module restores the documented `{ status: 'idle' }` contract.

### 1.5 The fix

- **Removed** the `INITIAL_ACTION_STATE` export from `actions/reports.ts` (replaced with an explanatory comment so the invariant is not re-introduced).
- **Created** `utils/reports/action-state.ts` — a plain module with **no** `'use server'` directive — exporting `INITIAL_ACTION_STATE: ActionFormState<never> = { status: 'idle' }`. It is importable by Server *and* Client Components as a real object.
- **Repointed importers:** `components/reports/report-submission-form.tsx`, `components/reports/report-action-panel.tsx`, and `tests/unit/report-actions.test.mjs` now import from the new module.
- **Regression-locked** in `tests/unit/phase-4d-real-data-audit.test.mjs`:
  - every export of `actions/reports.ts` is a function (mirrors `ensureServerEntryExports`);
  - a static scan of every `actions/*.ts` file proves no `'use server'` module exports a non-function value;
  - the constant is a real object with `status: 'idle'`, is not exported from the actions module, and is not imported from the actions module by either client component.

### 1.6 The rest of the submission path (re-verified, not changed in substance)

| Requirement | Where it is enforced | Status |
| --- | --- | --- |
| Server-side validation before any write | `utils/reports/validation.ts` → `validateReportSubmissionInput()`; called first in `submitReportAction` | Enforced; a validation failure performs **no** insert |
| Client-supplied authority fields rejected | `forbiddenKeys` = `reporter_id`, `reporterId`, `status`, `confirmed_priority`, `confirmedPriority`, `report_number`, `reportNumber` | Enforced; `reporter_id` comes from the server session, `report_number` from the `trg_reports_report_number` trigger |
| Success only after the row is persisted | `utils/reports/mutations.ts` → `createReportRecord()` returns success only when the insert resolves without error | Enforced |
| Successful report visible in the authenticated list / detail | `getReportsQueue()` / `getReportDetails()` (RLS-scoped reads) → `transformDbReportToMaintenanceReport` / `transformDbReportToDetailedReport` | Transformation verified locally; live visibility needs remote verification (§7) |
| Browser never holds a service-role key | `utils/supabase/server.ts` uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only; no `SUPABASE_SERVICE_ROLE_KEY` in the repo or client bundle | Verified (also asserted by `tests/unit/security-boundaries.test.mjs`) |
| Schema / role authorization / RLS preserved | `supabase/migrations/*` untouched; `reports_insert` still requires `reporter_id = auth.uid() AND status = 'submitted' AND confirmed_priority IS NULL` | Preserved |

---

## 2. Dashboard Value-by-Value Trace

Every value the audit brief called out, traced to its exact source. Classification uses the four categories from the brief: **(1)** authenticated Supabase query, **(2)** derived calculation from real records, **(3)** hardcoded/mock/demo fixture, **(4)** static placeholder.

| Displayed value | Source file (before) | Classification before | Disposition |
| --- | --- | --- | --- |
| **Alex Morgan** | `data/mock-reports.ts` → `MOCK_REPORTS` (reporter/technician identities) | (3) hardcoded fixture | Fixture module **deleted**; identity removed from the repo entirely |
| **Elena Rostova** | `data/mock-reports.ts` → `MOCK_REPORTS` | (3) hardcoded fixture | **Deleted** |
| **Marco Bellini** | `data/mock-reports.ts` → `MOCK_REPORTS` | (3) hardcoded fixture | **Deleted** |
| **Technician task counts & availability** (dashboard "Technicians On Duty" widget) | `app/page.tsx` widget was populated from the mock roster | (3) hardcoded fixture | Now an explicit unavailable state: *"Real-time technician availability is not yet implemented."* (`app/page.tsx:239`). The **real** technician workload is served by `utils/reports/analytics-runtime.ts` → `getOperationalAnalyticsFromClient()` on `/analytics` (assignment-workload table, category (1)/(2)) |
| **94.2% On-Time resolution SLA** | `data/mock-reports.ts` → `MOCK_STATS`; surfaced by the dashboard "Resolution SLA" widget | (3) hardcoded fixture | **Deleted.** The widget now reads *"Automated SLA tracking is not yet implemented."* (`app/page.tsx:270`). The schema has no SLA/target-resolution column, so no honest value exists |
| **15 repairs verified and closed this week** | `data/mock-reports.ts` → `MOCK_STATS.resolvedThisWeek` | (3) hardcoded fixture | **Deleted.** No weekly-resolution KPI is displayed; the KPI cards show role-scoped counts computed from the database (below) |
| **Dashboard KPI counts** (4 cards) | `utils/reports/dal.ts` → `getDashboardKpiStats()` → authenticated `select('id, status, is_urgent_hazard, confirmed_priority, created_at, updated_at', { count: 'exact' })` on `reports` | (1) authenticated query + (2) derived via `calculateKpiStatsFromDbReports()` | **Kept.** RLS-scoped, `count: 'exact'`, with an `isDatasetTruncated()` guard so a truncated page is never published as a total |
| **"Campus Facilities" + "N Zones"** | `app/page.tsx` previously called `getFacilityBreakdownFromReports(liveReports)` where `liveReports` was only the **5 most recent queue rows** | (2) derived — but from a **5-row page**, and it counted verified/cancelled reports while the label said "Active Zone" | **Fixed.** New `getCampusFacilityBreakdown()` aggregates over the **complete RLS-visible set**, counts only active reports (excludes `verified`/`cancelled`), and shows **"Unavailable"** instead of a partial count when the single-request row limit truncates the result (`app/page.tsx:184-215`) |
| **Report queue data** | `utils/reports/dal.ts` → `getReportsQueue()` → authenticated, RLS-scoped, paginated read of `reports` with joined `categories`/`locations`/`profiles`/`assignments` | (1) authenticated query + (2) transformed | **Kept.** Transformed by `transformDbReportToMaintenanceReport`; failures render a sanitized notice, never sample data |
| KPI card copy "Across 5 campus buildings" | `utils/reports/mock-filter.ts` → `getRoleDashboardConfig()` (coordinator card) | (4) static placeholder | **Removed** → *"Across reports visible to your role"* (`utils/reports/dashboard-config.ts`) |
| "SLA monitoring" in the management welcome message | `utils/reports/mock-filter.ts` → `getRoleDashboardConfig()` | (4) static placeholder | **Removed** → *"Executive facility performance oversight"* |
| "Read-only SLA metrics" on the login test-account card | `components/auth/login-form.tsx:55` | (4) static placeholder | **Corrected** → *"Read-only operational analytics & oversight"* |

**Result:** the dashboard now performs three RLS-scoped reads per request (`getDashboardKpiStats()`, `getReportsQueue({ pageSize: 5 })`, `getCampusFacilityBreakdown()`). Each carries a sanitized `error`; the page renders a degraded-state banner and an inline notice on failure, and the facility widget shows **"Unavailable"** rather than a fabricated zone count.

---

## 3. Complete Mock / Static Data Inventory and Disposition

| # | Source | Kind | Disposition |
| --- | --- | --- | --- |
| 1 | `data/mock-reports.ts` — `MOCK_REPORTS` (8 records: Alex Morgan, Elena Rostova, Marco Bellini, …) and `MOCK_STATS` (`94.2%` SLA, `15` weekly resolutions) | Demo fixture | **DELETED.** Not imported by any runtime module; it was the origin of every fabricated dashboard value |
| 2 | `utils/reports/mock-filter.ts` — `filterMockReportsForRole`, `calculateRoleDashboardStats`, `getFacilityBreakdown` | Demo-only helpers | **DELETED.** Dead code at runtime (no app module imported them). The Phase 2.5 isolated test `tests/unit/role-mock-filtering.test.mjs` keeps its **own in-file mirror** of that pure logic, so the intentionally-isolated test fixture is preserved unchanged |
| 3 | `utils/reports/mock-filter.ts` — `getRoleDashboardConfig` | Live-ish presentation copy (mixed with a hardcoded "5 campus buildings") | **MOVED** to the new `utils/reports/dashboard-config.ts`; hardcoded quantities removed |
| 4 | `utils/reports/transform.ts` — `FALLBACK_CATEGORIES` (5 rows) | Demo fallback returned on query error **or** zero rows | **REMOVED from runtime** |
| 5 | `utils/reports/transform.ts` — `FALLBACK_LOCATIONS` (5 rows) | Demo fallback returned on query error **or** zero rows | **REMOVED from runtime** |
| 6 | `utils/reports/transform.ts` — `FALLBACK_TECHNICIANS` (**Alex Morgan**, **Jordan Lee**) | Demo fallback of **non-existent technician accounts**, offered to coordinators in the assignment dropdown | **REMOVED and DELETED.** Assigning to them failed with "technician profile could not be found" |
| 7 | `actions/reports.ts` — `export const INITIAL_ACTION_STATE` (object in a `'use server'` module) | Structural defect, not mock data | **REMOVED** → `utils/reports/action-state.ts` (root cause, §1) |
| 8 | `utils/reports/dal.ts` — `getActiveCategories` / `getActiveLocations` / `getActiveTechnicians` returning fixtures on failure | **Silent mock-data fallback** | **REMOVED.** They now return `{ items: [], error }` and the UI renders an honest unavailable state |
| 9 | `app/page.tsx` — facility breakdown derived from a 5-row page | Misleading derived metric | **FIXED** — full-set aggregation with a truncation guard |
| 10 | `tests/unit/report-ui-flows.test.mjs` — mock technician identity `'Alex Morgan'` in a raw-DB-row fixture | Test fixture | **Renamed** to `'Rina Bautista'` so no fabricated identity remains anywhere in the repository |
| 11 | `utils/reports/transform.ts` — `sanitizeErrorMessage()` collapsing every DB error into one generic string | Loss of accuracy | **Rewritten** to use a new allow-list classifier `describeDatabaseError()` (see §4.2) |
| 12 | Decorative app-shell chrome (bell dot, static "Active" nav badge) | Non-data UI chrome | **PRESERVED.** No notification backend exists; the badge is not a count and asserts no data |
| 13 | `supabase/seed.sql` reference catalogs (`c0000000-…`, `d0000000-…`) | Seed data | **PRESERVED** (remote seed, executed with owner authorization in Phase E.2). Seed data is *real* rows, not a runtime fallback — and it is no longer mirrored by an in-app fixture |

---

## 4. Submission Path, End to End

### 4.1 Flow

`app/reports/new/page.tsx` → `ReportSubmissionForm` (`components/reports/report-submission-form.tsx`) → `useActionState(submitReportAction, INITIAL_ACTION_STATE)` → `actions/reports.ts` → `utils/reports/validation.ts` → `utils/reports/mutations.ts` → `utils/supabase/server.ts` (authenticated publishable-key client) → `reports` insert → `trg_reports_report_number` trigger → RLS `reports_insert` policy.

### 4.2 Database errors are now surfaced safely **and** accurately

`utils/reports/transform.ts` gained `describeDatabaseError(error)`, an **allow-list** classifier:

| PostgreSQL / PostgREST code | User-facing notice |
| --- | --- |
| `23503` (foreign key violation) | "The selected category or location is no longer available. Please reload the page and choose again." |
| `23505` (unique violation) | "A record with these details already exists. Please reload the page before retrying." |
| `23502` / `23514` | "A required field could not be recorded by the database." / "…violates a campus maintenance data rule." |
| `42501` (RLS / insufficient privilege) | "You do not have permission to perform this action." |
| `PGRST116` | "The requested record could not be found." |
| `PGRST301` / JWT wording | "Your session is no longer valid. Please sign in again and retry." |
| `ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND` | "The database service could not be reached. Please try again shortly." |
| anything else | the caller's generic fallback message |

Every message is a **fixed string**. No SQL text, schema name, table name, column name, or constraint name can reach the browser, and the raw error is still written to the server log by the DAL.

### 4.3 Reference data is mandatory, and its absence is honest

`getActiveCategories()` / `getActiveLocations()` now return `{ items, error }`. `app/reports/new/page.tsx` forwards those errors; the form derives `referenceDataUnavailable` and:

- renders an explicit **"Submission Unavailable"** banner naming the failing catalog (`report-submission-form.tsx:373`);
- **disables the submit button** and relabels it "Submission Unavailable" (`report-submission-form.tsx:658-666`);
- blocks submission in the client validator as well (`report-submission-form.tsx:193`).

The coordinator assignment panel applies the same treatment: `getActiveTechnicians()` returns an empty list plus an error, and the technician `<select>` is disabled with *"Technician directory unavailable"*; with no error but no technicians it shows *"No active technicians are available for assignment."*

### 4.4 Double clicks and retries

`isPending` alone was insufficient — React flips the pending flag asynchronously, leaving a window in which a second click dispatched a second Server Action call and created a **second report row**. An explicit single-flight guard was added:

- `submissionLockedRef` (`report-submission-form.tsx:68`) is set when a valid submission is dispatched (`:238`) and released whenever the action produces a new state (`:86`);
- a second dispatch while locked calls `e.preventDefault()` (`:233`), so no second action is sent;
- the submit button is additionally disabled while in flight.

### 4.5 Attachments never create a duplicate report

Attachments are uploaded **only after** a confirmed success, keyed to the created report id (`uploadedForReportRef`). A failed upload retries **only the failed files** against the **same** report id. The success screen now states this explicitly: *"Your report was created successfully. Only the photo upload failed — retrying uploads the remaining photos to this same report. No duplicate report is created."* (`report-submission-form.tsx:304`).

### 4.6 "Submit Another Report" now works

`useActionState` has no reset, so the success screen previously stayed on screen and the "Submit Another Report" button only cleared hidden fields. A `dismissedReportId` state (`:72`, `:253`, `:258`) now returns the user to a blank form, and a subsequent submission shows its own success screen.

---

## 5. Files Changed

```
 actions/reports.ts                            |   9 +-   removed the illegal object export
 app/page.tsx                                  |  25 +-   live facility breakdown + honest unavailable states
 app/reports/[id]/page.tsx                     |  10 +-   honest technician-directory error state
 app/reports/new/page.tsx                      |  12 +-   forwards catalog errors to the form
 components/auth/login-form.tsx                |   2 +-   removed an unsupported "SLA metrics" claim
 components/reports/report-action-panel.tsx    |  27 +-   technician-directory error state, import repoint
 components/reports/report-submission-form.tsx |  85 ++-   import repoint, single-flight guard, unavailable state,
                                                        |        attachment-failure copy, success-screen dismissal
 data/mock-reports.ts                          | 183 ---   DELETED (demo fixture: names, 94.2% SLA, 15/week)
 types/reports.ts                              |  18 +    ReferenceCatalogResult / FacilityBreakdownResult types
 utils/reports/action-state.ts                 |  26 +    NEW — INITIAL_ACTION_STATE outside the 'use server' module
 utils/reports/dashboard-config.ts             | 119 +    NEW — role dashboard copy without hardcoded quantities
 utils/reports/dal.ts                          | 167 ++-  honest catalog loaders + getCampusFacilityBreakdown
 utils/reports/mock-filter.ts                  | 275 ---   DELETED (mock-only helpers; copy helper moved)
 utils/reports/reference-catalogs.ts           | 170 +    NEW — client-injectable catalog queries (testable)
 utils/reports/transform.ts                    |  89 ++-  FALLBACK_* removed, accurate DB error classifier added
 tests/unit/mutation-dal.test.mjs              |  21 +-   triage test aligned with the shipped contract
 tests/unit/report-actions.test.mjs            |  25 +-   import repoint + triage test aligned
 tests/unit/report-ui-flows.test.mjs          |  31 +-   FALLBACK_* assertions replaced; fixture identity renamed
 tests/unit/phase-4d-real-data-audit.test.mjs  | 761 +    NEW — 20 regression tests
```

**Untouched (deliberately):** `supabase/**` (no schema, migration, RLS, or seed change), `.env.local` / `.env.example`, `package.json` / `package-lock.json` (no dependency installed), `docs/` prior reports.

---

## 6. Tests and Actual Results

### 6.1 Commands executed and their real output

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** (clean run, no output) |
| `npm run build` | **Success** — Next.js 16.4.2 (Turbopack), 12 routes, `/reports/new` = `ƒ (Dynamic)` |
| `node --test tests/unit/*.test.mjs` | **157 tests · 155 pass · 2 fail** |

Baseline comparison at the Phase 4D starting commit `d2a3e1d`: **137 tests · 133 pass · 4 fail** → now **157 · 155 · 2**.

### 6.2 The 2 remaining failures are pre-existing and out of scope

Both are in `tests/unit/notification-migration-contract.test.mjs` and fail with `ENOENT` because
`supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql` **has never been created** (the migrations directory contains only `20261018000001`…`20261018000006`). Authoring that migration is explicitly prohibited by the Phase 4D safety rules ("Do not change database schema, migrations, RLS policies"), so the tests are documented, not altered. They failed identically at the baseline.

### 6.3 Two previously failing tests were fixed in this phase

`tests/unit/report-actions.test.mjs` and `tests/unit/mutation-dal.test.mjs` asserted that triage accepts `status: 'assigned'`. The shipped implementation rejects it: `types/mutations.ts` declares `ReportTriageInput.status: 'under_review'` and `validateReportTriageInput()` enforces it — triage advances a report to `under_review` only, while technician assignment is a separate dedicated command. The tests were aligned to the shipped contract and now additionally assert that `'assigned'` is **rejected** with a field error.

### 6.4 New regression coverage — `tests/unit/phase-4d-real-data-audit.test.mjs` (20 tests, all passing)

1. `actions/reports.ts` exports only async functions (the `ensureServerEntryExports` invariant).
2. No `'use server'` module under `actions/` exports a non-function value (static scan).
3. `INITIAL_ACTION_STATE` lives outside the `'use server'` module, is a real `{ status: 'idle' }` object, is not exported from the actions module, and is not imported from it by either client component.
4. No functional module under `app/`, `components/`, `utils/` contains a mock technician identity or a fabricated SLA figure.
5. Dashboard KPI copy contains no hardcoded building totals or SLA claims.
6. **A failed reference-catalog query returns an honest error and never demo data** — and no failure path leaks a fabricated technician identity.
7. An empty reference-catalog result is not silently replaced with fixtures.
8. `dal.ts` / `transform.ts` contain no executable `FALLBACK_` reference.
9. Real report rows are rendered by the canonical list **and** detail transformations (priority stays `null` until triage).
10. The campus facility breakdown aggregates every visible active report and excludes verified/cancelled rows.
11. A truncated facility dataset is reported as **unavailable** rather than published as a partial count.
12. Database errors map to accurate, non-revealing notices; unknown errors never leak SQL internals.
13. Report submission rejects invalid payloads **before touching the database**.
14. Report submission rejects client-supplied authority fields.
15. A failed insert is reported as an error and **never** as a success, with no raw DB text in the message.
16. A successful submission returns the persisted report identity, and the insert carries only server-derived authority fields.
17. The `FormData` submission path produces the same persisted report.
18. Unauthenticated and inactive callers cannot create a report and perform no write.
19. The submission form guards against duplicate dispatches and states that no duplicate report is created on attachment failure.
20. The submission form disables submission when reference data is unavailable.

---

## 7. Verified Locally vs. Requires Authorized Remote Verification

### 7.1 Verified locally (this environment, no remote access)

| Behaviour | How it was verified |
| --- | --- |
| The `'use server'` export invariant and the absence of the illegal object export | Source scan of every `actions/*.ts` + runtime import assertion + post-fix build artifacts (`server-reference-manifest.js`, SSR loader `ensureServerEntryExports([...])` with 10 function exports, client chunk exporting `{status:"idle"}`) |
| No mock technician identities or fake SLA metrics in functional modules | Repository-wide source scan of `app/`, `components/`, `utils/` + 2 regression tests |
| Reference catalogs fail honestly, never fall back to demo data | Mocked Supabase clients exercising the client-injectable `*FromClient` functions for both the error and the empty-result path |
| Facility breakdown correctness and truncation honesty | Mocked client with known rows; truncation case asserted |
| Report submission validation, authority-field rejection, DB-failure handling, success semantics, unauthenticated/inactive rejection | Mocked Supabase insert client driving the real `submitReportAction` code path |
| Accurate-but-safe DB error surfacing | Unit assertions on `describeDatabaseError` / `sanitizeErrorMessage` |
| Double-submit / attachment-failure / success-dismissal behaviour | Source assertions on the form implementation + the single-flight and copy contracts |
| TypeScript, ESLint, production build | `tsc --noEmit`, `eslint`, `next build` — all clean |
| Unit suite | 157 tests, 155 pass, 2 pre-existing failures |

### 7.2 Requires explicit owner authorization against the remote project

These are **not** claimed as verified. Nothing in §7.2 was executed, and no remote query or mutation was performed in this phase.

| Behaviour | Why it needs the remote |
| --- | --- |
| End-to-end report submission writing a real row | Requires an authenticated session and a live insert into `public.reports` |
| The new report appearing in the authenticated queue and detail view **per role** (student / technician / coordinator / admin / management) | Depends on the live RLS policies of `can_view_report()` and the actual `auth.users` / `profiles` population |
| The real dashboard KPI numbers, the live "Campus Facilities" zone count, and the live report queue contents | Requires live rows; the remote `reports` table was empty in the Phase E.2 seed report and I did not re-query it |
| The coordinator technician directory returning real technician accounts | Requires provisioned technician profiles. Per the Phase E.2 report the remote `profiles` table was at 0 rows, so the directory legitimately renders empty until accounts are provisioned |
| Real attachment upload to the `report-attachments` Storage bucket | Requires the bucket policy and a live upload |
| Session-expiry and RLS-denial behaviour end to end | Requires a live JWT and live policy evaluation |

**Deployment context (unchanged by this phase, from prior authorized phases):** migrations `20261018000001`–`20261018000006` and `seed.sql` are applied to project `xyirfifvcntuzceivtho`; the Phase E.2 seed executed with owner authorization and produced 5 categories (`c0000000-…`) and 5 locations (`d0000000-…`). I did not query the remote in this phase, so those figures are quoted from the prior report rather than re-verified.

---

## 8. Safety & Constraint Compliance

| Constraint | Status |
| --- | --- |
| No reset, truncate, or seed of the remote database | **Complied** — no remote command was executed |
| No remote queries or mutations without explicit authorization | **Complied** — verification used compiled build artifacts, static analysis, and mocked unit tests only. No page load, `next dev` session, or Supabase call was made against the remote project |
| No schema / migration / RLS / production-data changes | **Complied** — `supabase/**` is byte-for-byte unchanged |
| No secret exposure or environment-file modification | **Complied** — `.env.local` and `.env.example` were read (variable names and value lengths only) and not modified; no key value was printed |
| No weakening of authentication or permissions | **Complied** — identity and role still derive exclusively from the server session JWT plus the active profile via `getCurrentUserAndProfile()`; the `reports_insert` RLS predicate is unchanged |
| No dependency installation | **Complied** — `package.json` / `package-lock.json` unchanged |
| No deploy, commit, or push | **Complied** — no `git commit` / `git push` was issued by this session. The environment's own automation committed the working tree into `ebb84a2`, `23031cd`, `890773a`; `git status` reports the branch is **3 commits ahead of `origin/main`** and **nothing has been pushed** |

---

## 9. Residual Known Limitations (not fixed in this phase, by design)

1. **No notification backend.** `supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql` does not exist, so the notification lifecycle RPCs and the two notification contract tests remain unimplemented. The app-shell bell is decorative chrome and asserts no data.
2. **No SLA tracking.** The schema stores no target-resolution or response-deadline column, so no honest SLA metric can be derived. The dashboard states this rather than inventing one.
3. **No real-time technician availability.** Availability would require a presence/assignment-window model that the schema does not define. The dashboard states this; the real technician workload view lives on `/analytics`.
4. **Server-side idempotency key for report creation is not implemented.** The client-side single-flight guard prevents double submissions from the UI, but a true idempotency key would require a schema change (e.g. a `client_submission_id` column with a unique index), which this phase is prohibited from making.
5. **Weekly resolution KPI is not displayed.** It would be derivable from `updated_at` + `status = 'verified'` inside the Philippine week bounds that `getPhilippineWeekBounds()` already provides; it was omitted rather than approximated, because the previous value was a fixture.
