# CMIRS — Phase 4D: Real Data Audit & Report Submission Repair

**Date:** 2026-10-21
**Scope:** Audit every functional page for fabricated runtime data · Repair the root cause of report submission failure at `/reports/new`
**Supersedes:** `docs/frontend/REPORT_SUBMISSION_AND_REAL_DATA_FIX_REPORT.md`

---

## Executive Summary

1. **Root cause of the `/reports/new` submission failure** was an illegal export. `INITIAL_ACTION_STATE` (a plain object) was exported from `actions/reports.ts`, a module carrying the file-level `'use server'` directive. Next.js only permits async functions to be exported from `'use server'` modules, so the generated server-actions loader threw while the `/reports/new` route module was being evaluated, making report submission impossible. The constant now lives in a plain (non-directive) module, `utils/reports/action-state.ts`.
2. **Fabricated runtime values were removed** from every functional page. The Operations Dashboard previously rendered fake technician identities (Alex Morgan, Elena Rostova, Marco Bellini) and a fabricated "94.2% On-Time" SLA figure. It is now driven entirely by live RLS-scoped Supabase queries, and widgets whose backend is not yet implemented state that plainly rather than inventing numbers.
3. **Silent demo-data fallbacks were removed** from the reference-catalog DAL loaders. `getActiveCategories`, `getActiveLocations`, and `getActiveTechnicians` used to substitute hardcoded fixture rows whenever a query failed or returned zero rows — which surfaced non-existent technician identities to coordinators and caused foreign-key insert failures. They now fail honestly (empty list + sanitized error), and the UI renders real empty / unavailable states.

**Verification (locally performed):** TypeScript compiles with 0 errors, ESLint passes with 0 warnings, `next build` succeeds, and 155/157 unit tests pass. The 2 remaining failures are pre-existing for an unimplemented notification migration and are out of scope (see *Test Results*).

---

## 1. Root Cause: `/reports/new` Submission Failure

### 1.1 The illegal export

`actions/reports.ts` begins with the file-level `'use server'` directive. Next.js enforces a hard rule on such modules through `ensureServerEntryExports()` in `next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`: **every export must be an async function.** Exporting a plain value throws:

```
A "use server" file can only export async functions, found object.
```

Before the fix, `actions/reports.ts` exported `export const INITIAL_ACTION_STATE = { status: 'idle' }`. This is not merely a lint concern — it changed the runtime behavior of the route in two compounding ways:

1. The generated server-actions loader module threw the error above while it was being evaluated. Because `/reports/new` and `/reports/[id]` import actions from this module, the throw happened during route-module evaluation and made the submission path unusable.
2. Even where the object was handed through, React 19 `useActionState`/`mountActionState` stores the provided initial state **as-is** (it does not lazily invoke it). A non-async server reference means the hook receives a server-reference object rather than the intended idle state, so `state.status` is `undefined` instead of `'idle'` and the form's status-driven rendering (`state.status === 'error'`, `'success'`) misbehaves.

### 1.2 Evidence

The compiled artifacts of the pre-fix build recorded the object as a remote server reference under the action-module hash:

| Artifact | Pre-fix evidence |
| --- | --- |
| `.next/static/chunks/*.js` (client) | `createServerReference("7fa6a4c8960ad584a6ee15a5c9a8470d8aed84e422", …)` |
| `.next/server/chunks/ssr/*.js` | `registerServerReference(N, "7fa6a4c8…", null)` |
| `.next/server/server-reference-manifest.js` | entry for `7fa6a4c8…` with `"async": false`, routed to `app/reports/new/page` and `app/reports/[id]/page` |

An in-repo NOTE in `actions/reports.ts` additionally records that the server-actions loader threw `A "use server" file can only export async functions, found object.` while the `/reports/new` route module was evaluated.

After the fix, a fresh `next build` was produced and both client chunks and the server-reference manifest were re-scanned: the stale hash `7fa6a4c8…` **no longer appears anywhere**, confirming the constant is no longer registered as a server reference.

### 1.3 The fix

- **Removed** the `INITIAL_ACTION_STATE` export from `actions/reports.ts`.
- **Created** `utils/reports/action-state.ts`, a plain module with **no** `'use server'` directive, exporting `INITIAL_ACTION_STATE: ActionFormState<never> = { status: 'idle' }`. It can therefore be imported by both Server and Client Components as a real object.
- **Repointed importers:** `components/reports/report-submission-form.tsx`, `components/reports/report-action-panel.tsx`, and the unit tests now import from `@/utils/reports/action-state`, not from the actions module.
- **Regression-locked** by `tests/unit/phase-4d-real-data-audit.test.mjs`, which asserts the constant lives outside the `'use server'` module, is a real object with `status: 'idle'`, that the actions module no longer exports it, and that the two client components do not import it from the actions module.

### 1.4 Why submission now succeeds only after a real save

The existing submission path (unchanged by this phase, and re-verified) already enforces the required guarantees:

- `createReportRecord` inserts with `reporter_id` taken from the server session (`auth.uid()`), `status: 'submitted'`, and `confirmed_priority: null`. The `report_number` is generated by the `trg_reports_report_number` database trigger, not the client.
- Server-side validation (`validateReportSubmissionInput`) runs before any insert; a validation failure returns a field-error state and performs no write.
- The success state is returned **only** after the insert resolves without database error. Attachment uploads happen client-side **after** a confirmed success (via `useEffect`), so an attachment failure never rolls back or duplicates the report row.
- Double-submission is guarded by the `isPending` single-flight lock on the submit button.
- The browser only ever holds the publishable/anon key; no service-role key is present in the client bundle or `.env.local`.

---

## 2. Fabricated Runtime Data — Audit & Disposition

Every functional page was audited. Disposition of each fabricated value:

| Value | Previous location | Disposition |
| --- | --- | --- |
| Alex Morgan / Jordan Lee (technicians) | Dashboard "Technicians On Duty"; `FALLBACK_TECHNICIANS` | **Removed.** Widget now states real-time technician availability is not yet implemented; DAL no longer returns fixtures. |
| Elena Rostova / Marco Bellini | Dashboard; `data/mock-reports.ts` | **Removed from runtime.** `data/mock-reports.ts` is an unused, documented fixture module (self-referenced only) and is intentionally preserved as a test fixture. |
| "94.2% On-Time" SLA metric | Dashboard "Resolution SLA" | **Removed.** Widget now states automated SLA tracking is not yet implemented. |
| "Across 5 campus buildings" (coordinator KPI card) | `utils/reports/dashboard-config.ts` / `mock-filter.ts` | **Removed.** KPI descriptions are now role-relative and derived (e.g., "Across reports visible to your role"). |
| Static "Active" navigation badges, decorative bell dot | App shell / header | **Preserved** as intentional non-data chrome (no notification backend exists; the dot is decorative, not a count). |

### 2.1 Dashboard is now fully live-query driven

`app/page.tsx` renders exclusively from three RLS-scoped DAL reads executed per request:

- `getDashboardKpiStats()` → the four KPI numbers.
- `getReportsQueue({ pageSize: 5 })` → the visible report queue.
- `getCampusFacilityBreakdown()` → the per-building facility breakdown.

Each result carries a sanitized `error`. The page renders an honest **degraded-state banner** and inline notice when any query fails, and the facility widget shows **"Unavailable"** rather than a fabricated zone count. Widgets whose backend is not implemented (Technicians On Duty, Resolution SLA) show explicit "not yet implemented" copy. The campus facility breakdown aggregates over the complete RLS-visible set and reports `isTruncated` instead of publishing a partial count when the single-request row limit is hit.

### 2.2 Silent demo-data fallbacks removed from the DAL

`utils/reports/dal.ts` previously returned fixture arrays on query failure **and** on zero rows:

| Loader | Previous behavior | New behavior |
| --- | --- | --- |
| `getActiveCategories` | returned `FALLBACK_CATEGORIES` on error/empty | empty list + sanitized error; injectable `getActiveCategoriesFromClient` for testing |
| `getActiveLocations` | returned `FALLBACK_LOCATIONS` on error/empty | empty list + sanitized error; injectable `getActiveLocationsFromClient` |
| `getActiveTechnicians` | returned `FALLBACK_TECHNICIANS` on error/empty (coordinator/admin only) | empty list + sanitized error; injectable `getActiveTechniciansFromClient` |

The `FALLBACK_*` constants are no longer referenced by executable code in `dal.ts` or `transform.ts` (only in Phase 4D doc comments). The remote database currently has **zero** `profiles` rows, so the technician query legitimately returns an empty list — previously this made coordinators see fabricated assignable identities that would fail with "technician profile could not be found" on assignment. Now the assignment panel honestly reports **"No active technicians are available for assignment."**

### 2.3 Consumers render honest empty / unavailable states

- `app/reports/new/page.tsx` passes `categoriesError` / `locationsError` from the DAL to the form; `report-submission-form.tsx` sets `referenceDataUnavailable` and **disables submit** with a clear reload message rather than letting a user submit against missing reference data.
- `components/reports/report-action-panel.tsx` renders the empty technician list state.
- `app/page.tsx` and `app/reports/page.tsx` render sanitized query-error notices.
- `data/mock-reports.ts` is retained as a **documented, unused test fixture** (intentional per the audit rules). `utils/reports/transform.ts` retains `FALLBACK_*` only as documented fixtures consumed by fixture-integrity unit tests, not by any runtime path.

---

## 3. Safety & Constraint Compliance

| Constraint | Status |
| --- | --- |
| No remote DB queries/mutations without explicit authorization | **Complied.** No `next dev`/runtime page loads against the remote project were performed; verification used compiled artifacts, static analysis, and mocked unit tests only. |
| No schema / migration / RLS changes | **Complied.** No migration files were created or altered. |
| No production data changes | **Complied.** No seed or data mutations executed in this phase. |
| No secret exposure / env changes | **Complied.** `.env.local` contains only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; no service-role key anywhere. |
| No weakening of auth | **Complied.** Role and identity still derive exclusively from the server session JWT + active profile via `getCurrentUserAndProfile()`. |
| No dependency installs, deploy, commit, or push | **Complied.** No installs; changes left uncommitted. |

---

## 4. Test Results

**Command:** `node --test tests/unit/*.test.mjs`
**Result:** 157 tests — **155 pass, 2 fail** (pre-existing, out of scope).

The 2 failures are both in `tests/unit/notification-migration-contract.test.mjs` and fail with `ENOENT` because `supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql` has never been created. Creating that migration is explicitly prohibited for this phase; these tests are documented, not altered.

**Regression coverage added** in `tests/unit/phase-4d-real-data-audit.test.mjs`:

1. `INITIAL_ACTION_STATE` lives outside the `'use server'` module, is a real `{ status: 'idle' }` object, is not exported from `actions/reports.ts`, and is not imported from the actions module by the two client components.
2. No functional (app/components/utils) module contains mock technician identities or fabricated SLA figures.
3. Dashboard KPI copy contains no hardcoded building totals or SLA claims (coordinator and management configs).
4. Failed reference-catalog queries return an honest error and never leak a fabricated technician identity.
5. Empty reference-catalog results are not silently replaced with fixtures.
6. `dal.ts` / `transform.ts` contain no executable `FALLBACK_` references.
7. Real report rows render through the canonical list/detail transformations; priority stays `null` until triage.
8. The campus facility breakdown aggregates every visible active report and reports truncation as unavailable.

**Other checks:** `npx tsc --noEmit` → 0 errors. `npx eslint` → 0 warnings. `npx next build` → succeeds; post-build scan confirms the stale `7fa6a4c8…` server-reference hash is absent from client chunks and the server-reference manifest.

---

## 5. Verified vs. Pending

| Area | Status |
| --- | --- |
| `'use server'` export hygiene (source + compiled artifacts) | **Locally verified** |
| No fabricated dashboard/functional values | **Locally verified** (source scan + regression tests) |
| DAL fails honestly, no demo-data fallback | **Locally verified** (mocked client tests) |
| Submission validation / failure / success handling | **Locally verified** (mocked unit tests + type/build checks) |
| TypeScript / ESLint / build | **Locally verified** |
| **Live report submission against remote Supabase `xyirfifvcntuzceivtho`** | **PENDING — requires explicit owner authorization.** Not performed; not claimed as verified. |

### Deployed-database context (from prior phases, unchanged here)

Migrations 1/3/4/5, `seed.sql`, and RLS/trigger consistency were confirmed in Phase 6F, and the Phase E2 seed executed with owner authorization: 5 categories (`c0000000-…`) and 5 locations (`d0000000-…`) are verified. `auth.users` / `profiles` remain at 0 rows (Gate E.3 provisioning was never performed). The submission path's database prerequisites are therefore in place remotely; end-to-end submission against the live project remains unverified pending authorization.
