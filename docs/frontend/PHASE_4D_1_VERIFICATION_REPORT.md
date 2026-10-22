# CMIRS — Phase 4D.1: Final Verification, Supabase Connectivity, and Git Audit

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Baseline:** `d2a3e1d` (== `origin/main`) · **Phase 4D commits:** `ebb84a2`, `23031cd`, `890773a` (HEAD)
**Supersedes:** nothing — extends `docs/frontend/PHASE_4D_REAL_DATA_AUDIT_REPORT.md`

---

## Executive Summary

| # | Outcome | Status |
| --- | --- | --- |
| 1 | Misleading "Live Backend Connected" banner removed from the dashboard **and** the report queue | **Done** |
| 2 | Supabase connectivity verified with live read-only probes | **Done — SUCCESSFUL QUERY WITH ZERO RECORDS** (anon role) |
| 3 | Phase 4D server-action fix verified with Next.js's own runtime guard + headless browser | **Done** |
| 4 | Two remaining test failures investigated | **Explained — legitimate, pre-existing, not fixable in this phase** |
| 5 | Real vs mock data audited across every functional page | **Done — 1 new fabrication removed** |
| 6 | Git state audited | **Done** |
| 7 | **NEW BLOCKER FOUND** — a pre-existing database function defect makes *every* report read fail for `student_personnel` and `technician` | **Diagnosed, not fixed (migration change prohibited)** |

**Headline result:** the Phase 4D submission fix is confirmed good. However, this phase uncovered a **pre-existing remote defect** that defeats the entire real-data effort for two of the five roles, and that defect can only be repaired by a database migration, which this task explicitly prohibits. Details and the exact remediation SQL are in §9.

**Local verification totals:** TypeScript **0 errors** · ESLint **0 errors / 0 warnings** · `next build` **succeeds** · **163 unit tests, 161 pass, 2 fail** (both pre-existing, §4).

---

## 1. Banner Removal

### 1.1 What was removed

The dashboard carried a two-variant banner that asserted a verified backend connection state:

| Element | Text |
| --- | --- |
| Green variant heading | **"Live Backend Connected:"** |
| Green variant body | **"Serving records from Supabase Cloud. PostgreSQL Row Level Security actively enforces your role scope."** |
| Green variant chip | **"Perspective: {role}"** (e.g. *Maintenance Coordinator*) |
| Green variant chip | **"Live RLS Active"** |
| Amber variant | "Database Service Notice: Operational queries experienced a degraded state. Fail-closed security protection active." + "Degraded State" |

**Files changed**

- `app/page.tsx` — removed the whole banner block (both variants) and the now-unused `formatRoleLabel` import from `@/utils/auth/validation`.
- `app/reports/page.tsx` — **the identical banner was found here too** and removed, together with the same unused import.

**Why both variants were removed.** The green banner is a *claim* the server component cannot prove: a query can succeed and still return zero rows, and RLS is enforced inside PostgreSQL, not reported back to the client. The amber variant is the same problem inverted — it asserts a backend state ("degraded", "fail-closed protection active") that is not the same thing as "a query returned an error". The task explicitly forbids replacing the banner with another unverified connection claim, so neither variant was replaced.

**What was preserved.** The honest per-query error notice that already existed below the banner is untouched:

```tsx
{(kpiResult.error || queueResult.error || facilityResult.error) && (
  <div …>
    <ExclamationTriangleIcon … />
    <span>Notice: {kpiResult.error || queueResult.error || facilityResult.error}</span>
  </div>
)}
```

This renders the **actual sanitized error string returned by the DAL** — a fact, not a claim. Role-based permissions, RLS, authentication and the Supabase integration are unchanged; `git diff` shows no change to `proxy.ts`, `utils/supabase/*`, `utils/auth/*`, or any migration.

### 1.2 Additional fabrication removed in the same pass

While auditing the dashboard for the same defect class, one more fabricated claim was found and removed:

| Location | Previous text | Disposition |
| --- | --- | --- |
| `app/page.tsx` (Reporting Guidelines card) | *"Coordinator assessment typically occurs within **2 hours** of report submission during campus operating hours."* | **Removed.** An unmeasurable response-time commitment. Replaced with: *"Reports enter the coordinator triage queue as **Submitted**. A coordinator confirms the priority before a technician is assigned. Response-time targets are not measured by the system, so no turnaround estimate is shown here."* |

### 1.3 Notification bell — fabricated unread indicator removed

`components/layout/header.tsx` rendered a bell button with a **red dot** (`bg-rose-500`) that visually asserted an unread notification. There is no notification backend: the missing migration `20261020000007_notification_lifecycle_rpcs.sql` was never authored and — confirmed by a live read-only probe — the table `notification_command_receipts` **does not exist in the remote database** (HTTP 404 / `PGRST205`). The dot was therefore an invented metric.

**Change:** the red dot was removed and the control is now explicitly disabled with an honest label:

```tsx
<button type="button" disabled aria-disabled="true"
        aria-label="Campus notifications (not yet available)"
        title="Campus Notifications — not yet available">
  <BellIcon size={20} className="w-5 h-5 shrink-0" />
</button>
```

---

## 2. Supabase Connectivity Evidence

Verification script: **`scripts/verify-supabase-connectivity.mjs`** (read-only; no write, insert, update, delete, truncate, or RPC invocation). Reproduce with `node scripts/verify-supabase-connectivity.mjs`.

### 2.1 Configuration (values never printed)

```
--- 1. Environment configuration (values redacted) ---
  [PASS] NEXT_PUBLIC_SUPABASE_URL is defined
  [PASS] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is defined
  [PASS] URL is a well-formed https Supabase project URL — https://<project>.supabase.co
  [PASS] Key is a client-safe publishable/anon key — sb_publishable_* form
  [PASS] Key is NOT a service-role/secret key (server-side privilege check)
  project reference: xyirfifvcntuzceivtho (host only, no credentials)
```

The script asserts the key matches `^sb_publishable_[A-Za-z0-9_-]+$` and **explicitly rejects** `sb_secret_*` / `service_role` keys. Only the key *shape* and *length* are ever reported.

### 2.2 Client initialization

```
--- 2. Application server client factory (utils/supabase/server.ts) ---
  [PASS] createClient() factory is exported
  [PASS] createClient() accepted the configuration and advanced to the cookie/session adapter
         — cookies() is unavailable outside a Next.js request scope (expected outside the runtime)
```

The **unmodified** application module was imported (via a resolve hook that maps the extensionless `next/headers` subpath onto `next/headers.js`, because bare Node ESM cannot resolve the bundler-style specifier). `createClient()` therefore passed its environment check and reached the cookie adapter — i.e. the configuration is accepted and the failure is only that `cookies()` has no request scope outside the Next.js runtime.

`utils/supabase/server.ts` builds the client with `createServerClient(supabaseUrl, supabaseKey, { cookies: { getAll, setAll } })`. `@supabase/ssr` attaches the **current user's session cookie** to every request, and `utils/auth/server.ts` resolves identity with `supabase.auth.getUser()` (a server-side JWT validation, not a client-supplied value). No service-role key appears anywhere in the client bundle or `.env.local`.

### 2.3 DAL table targeting (mocked client, no network)

```
--- 3. Reference-catalog DAL table targeting (mocked client, no network) ---
  [PASS] catalog loader targets 'categories'
  [PASS] catalog loader targets 'locations'
  [PASS] technician loader targets 'profiles'
  [PASS] facility breakdown targets 'reports'
```

### 2.4 Minimal read-only probes against the configured project

```
--- 4. Minimal READ-ONLY probes against the configured project ---
  auth.getSession() (no user cookie in this context)
      classification : SUCCESSFUL QUERY WITH ZERO RECORDS
      detail         : HTTP 200, 0 row(s) returned
  auth.getUser() (no user cookie in this context)
      classification : AUTHENTICATION FAILURE (no session available)
      detail         : HTTP 400, AuthSessionMissingError
  SELECT id FROM categories LIMIT 1
      classification : SUCCESSFUL QUERY WITH ZERO RECORDS
      detail         : HTTP 200, 0 row(s) returned      (latency 371 ms)
  SELECT id FROM locations LIMIT 1
      classification : SUCCESSFUL QUERY WITH ZERO RECORDS
      detail         : HTTP 200, 0 row(s) returned      (latency 311 ms)
  SELECT id FROM reports LIMIT 1
      classification : SUCCESSFUL QUERY WITH ZERO RECORDS
      detail         : HTTP 200, 0 row(s) returned      (latency 126 ms)

--- 4b. Schema object existence probe (read-only SELECT only) ---
  notifications: EXISTS — HTTP 200, 0 row(s) visible to the unauthenticated probe
  notification_command_receipts: NOT AVAILABLE — HTTP 404, code PGRST205

--- 5. Connectivity summary ---
  OVERALL: SUCCESSFUL QUERY WITH ZERO RECORDS — the API answered correctly but no rows are
           visible to the unauthenticated probe.
```

### 2.5 Classification of the actual result

| Classification | Verdict |
| --- | --- |
| Configuration failure | **No** — URL and publishable key present and well-formed |
| Initialization failure | **No** — `createClient()` constructed successfully |
| Network / API failure | **No** — DNS, TLS, and PostgREST all answered; latencies 126–371 ms |
| Authentication failure | **Partially** — `auth.getUser()` returns `AuthSessionMissingError` (HTTP 400) because **no user session exists in this context** |
| RLS / permission denial | **No** — no 403 / 42501 was returned; the `anon` role simply matched no `TO authenticated` policy |
| **Successful query with records** | **Not applicable to the anon probe** |
| **Successful query with zero records** | ✅ **This is the actual classification.** The API answered HTTP 200 for `categories`, `locations`, `reports` and `notifications`; zero rows are visible because every SELECT policy in the schema is `TO authenticated`, so the unauthenticated role sees nothing |

**Interpretation.** Connectivity is proven: the project endpoint is reachable, the publishable key is accepted, PostgREST resolves the tables, and RLS is demonstrably enforced (the anon role is excluded rather than served). The zero-row result is the **expected and correct** RLS behaviour, and it is consistent with the Phase E.2/E.3 evidence that 5 categories, 5 locations, 5 auth users and 5 profiles exist but are invisible without a session.

**An authenticated read was NOT performed** — no credentials are documented in the repository (by deliberate design; the E.3 report states "Zero passwords, tokens, or service-role keys were printed, logged, or committed"), and no account was created or signed into. See §8.

---

## 3. Report Page and Submission Verification

### 3.1 The Phase 4D root cause is confirmed fixed

**Proof A — Next.js's own runtime guard.** `scripts/verify-server-action-exports.mjs` imports Next.js's `ensureServerEntryExports()` (the exact function that produced `A "use server" file can only export async functions, found object.`) and runs it against the **real exports** of every `'use server'` module:

```
--- Next.js runtime guard: ensureServerEntryExports() ---
  [PASS] actions/auth.ts exports only async functions (2 function export(s))
  [PASS] actions/reports.ts — ensureServerEntryExports() accepted 10 export(s):
         assignTechnicianAction, createAttachmentViewUrlAction, createWorkLogAction,
         declineAssignmentAction, softDeleteReportAttachmentAction, submitReportAction,
         transitionReportStatusAction, triageReportAction, uploadReportAttachmentAction,
         verifyReportAction
  RESULT: PASS — no "use server" module violates the async-function export rule.
```

`INITIAL_ACTION_STATE` is **not** among the exports, and `actions/reports.ts` contains no `export const/let/var` at all.

**Proof B — compiled production bundle.** The post-fix `next build` shows the server-actions loader validating only function exports, and the client chunk exporting a real object instead of a server-reference proxy:

| Artifact | Post-fix content |
| --- | --- |
| `.next/server/server-reference-manifest.js` | `INITIAL_ACTION_STATE` **absent** |
| SSR server-actions loader | `ensureServerEntryExports([Q,R,S,T,U,V,W,X,Y,Z])` + 10 `registerServerReference(...)` calls |
| Client chunk | `e.s(["f", 0, {status:"idle"}])` — the real idle-state object |

**Proof C — live HTTP against a fresh production server.** `npx next start -p 3100` (built from the current source) served every route with **zero** server-log output and no loader error:

```
  [PASS] /                    — HTTP 307 -> /login?next=/
  [PASS] /reports             — HTTP 307 -> /login?next=/reports
  [PASS] /reports/new         — HTTP 307 -> /login?next=/reports/new
  [PASS] /reports/<uuid>      — HTTP 307 -> /login?next=/reports/3333…
  [PASS] /analytics           — HTTP 307 -> /login?next=/analytics
  [PASS] /locations            — HTTP 307 -> /login?next=/locations
  [PASS] /settings             — HTTP 307 -> /login?next=/settings
  [PASS] /login (public)      — HTTP 200, HTML text/html, form=true, password-field=true
  [PASS] /unauthorized        — HTTP 307 -> /login?next=/unauthorized
```

**Proof D — real browser (headless Chrome over the DevTools Protocol).** `scripts/verify-in-browser.mjs` drives the locally installed Chrome with Node built-ins only (`fetch` + global `WebSocket`); no npm dependency was installed.

```
  /reports/new
      final URL        : http://localhost:3100/login?next=%2Freports%2Fnew
      title            : Sign In — CMIRS
      forms/inputs/selects : 1 / 7 / 0
      console errors   : 0
      page exceptions  : 0
      server-action loader error in DOM : false
  /login
      console errors   : 0
      page exceptions  : 0
      server-action loader error in DOM : false
  /reports
      console errors   : 0
      page exceptions  : 0
      server-action loader error in DOM : false
```

**Note on a historical dev-log artifact.** `.next/dev/logs/next-development.log` still contains 12 occurrences of the loader error. Their timestamps are `00:26`, `00:32` and `11:35`. The `11:35` entries are **not** a current defect: their stack frame is `at Module.eval (actions/reports.ts:644:44)` pointing at `const mutationContext: MutationContext = { user, supabase: context?.supabase };`, which is **line 644 of the pre-Phase-4D file** (`git show d2a3e1d:actions/reports.ts`), whereas line 644 of the current file is a comment. The long-running dev server on port 3000 (started before the fix, and still holding another session's authenticated browser) retained a stale module graph and re-evaluated the old module. The freshly built production server (Proof C) and the headless browser (Proof D) show no such error. **A dev-server restart is required for that long-running instance to pick up the fix.**

**Proof E — authenticated render against the fresh production server.** During the Proof C/D run, the
production server on port 3100 received an **authenticated** request for `/` from a browser session
already present in the environment (the Supabase auth cookie is scoped to `localhost`, so it is valid
on every local port). The server log for that request contains **only** DAL query diagnostics and
**no** loader error, no page exception, and no 500:

```
▲ Next.js 16.4.2
- Local:         http://localhost:3100
✓ Ready in 356ms
[DAL] getDashboardKpiStats query error: column reference "report_id" is ambiguous | code= 42702 | status= unknown
[DAL] getReportsQueue query error: column reference "report_id" is ambiguous | code= 42702 | status= unknown
[DAL] getCampusFacilityBreakdown query error: column reference "report_id" is ambiguous
```

This is the strongest available proof that the Phase 4D fix works in a real, authenticated render:
the `/` route module and its server-actions loader were evaluated without throwing, and the **only**
remaining failure is the pre-existing database defect described in §9.1. It also confirms the role
of the requesting session: oversight roles return early from `can_view_report()` and would not
produce these errors, so the session is `student_personnel` or `technician`.


### 3.2 Submission path re-traced

`app/reports/new/page.tsx` → `ReportSubmissionForm` → `useActionState(submitReportAction, INITIAL_ACTION_STATE)` → `actions/reports.ts` → `utils/reports/validation.ts` → `utils/reports/mutations.ts` → `utils/supabase/server.ts` → `reports` insert → `trg_reports_report_number` trigger → RLS `reports_insert` policy.

| Requirement | Enforcement point | Status |
| --- | --- | --- |
| Server-side validation enforced | `validateReportSubmissionInput()` before any write; forbidden authority fields (`reporter_id`, `status`, `confirmed_priority`, `report_number`) rejected | Enforced, regression-tested |
| Database errors surfaced safely and accurately | `describeDatabaseError()` allow-list classifier + `sanitizeErrorMessage()`; raw SQL never reaches the browser; raw error still logged server-side | **Improved in this phase** (§3.3) |
| Success only after the report is saved | `createReportRecord()` returns success only when the insert resolves without error | Enforced, regression-tested |
| Successful report appears in the authenticated list / detail | `getReportsQueue()` / `getReportDetails()` (RLS-scoped) → `transformDbReportToMaintenanceReport` / `transformDbReportToDetailedReport` | Transformation verified locally; **live visibility blocked by §9** |
| Attachment failure handled without a duplicate report | Attachments upload only after a confirmed success, keyed to the created report id; retry re-uploads only the failed files; the UI states "No duplicate report is created" | Enforced |
| Double clicks and retries handled safely | Explicit `submissionLockedRef` single-flight guard + disabled submit button | Enforced |
| Browser never uses a service-role key | Only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the script explicitly rejects secret keys | Verified |

### 3.3 Database errors are now surfaced *accurately*, not just safely

While investigating §9, the DAL was observed returning a generic notice for a **database-side function failure**, which is materially different from a permission problem. Two changes were made:

1. **DAL error logging** now includes the PostgREST `code` and HTTP `status` alongside the message (`getReportsQueue`, `getDashboardKpiStats`, `getReportDetails`). This is what made the §9 diagnosis possible.
2. **`describeDatabaseError()`** gained an allow-listed rule for `42702` / `ambiguous_column` style failures, and the DAL now returns `describeDatabaseError(error) ?? <generic>` instead of a hardcoded generic string. A failing RLS *policy helper* is now reported as a database evaluation failure rather than "You do not have permission to perform this action."

```
The database could not evaluate the report visibility rule, so report data cannot be
displayed right now. Please contact the system administrator.
```

`utils/reports/analytics-runtime.ts` received the same treatment for consistency.

### 3.4 Live persistence

**Live persistence remains UNVERIFIED.** A controlled submission would require either an authorized
test session (no credentials exist in the repository by design) or creating remote test records
(explicitly prohibited). No report was created remotely in this phase. The submission path is
verified by unit tests against a mocked Supabase insert client, by the Next.js runtime guard, and
by browser-level route verification — not by a live write.

---

## 4. Remaining Test Failures and Their Causes

### 4.1 Suite results

| Run | Tests | Pass | Fail |
| --- | --- | --- | --- |
| Phase 4D baseline (`d2a3e1d`) | 137 | 133 | 4 |
| Phase 4D.1 (current) | **163** | **161** | **2** |

### 4.2 The two remaining failures — investigated, legitimate, not fixable here

```
not ok 69 - notification lifecycle migration defines five hardened atomic command RPCs
not ok 70 - notification migration protects receipts, prevents generic inserts, and preserves direct-write policies
  error: "ENOENT: no such file or directory, open
   'D:\\CMIRS-System\\my-app\\supabase\\migrations\\20261020000007_notification_lifecycle_rpcs.sql'"
```

**Root cause.** `tests/unit/notification-migration-contract.test.mjs` reads
`supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql`. That file **does not exist** —
the migrations directory contains only `20261018000001` … `20261018000006`. The failure is `ENOENT`,
i.e. a missing input file, not a broken assertion.

**Why this is a legitimate remaining failure.**

- The migration is a **known, documented, not-yet-built deliverable**. The Phase 4C document series
  (`PHASE_4C_NOTIFICATIONS_READINESS_PLAN.md` … `PHASE_4C_6_OWNER_DECISION_SUMMARY.md`) is explicitly
  a *read-only audit and proposed plan*: "no notification implementation has started." The two tests
  are the **forward-looking specification** of that planned migration.
- The task instructions state: *"Do not invent or apply the missing migration. Do not weaken tests
  simply to make them pass."* The test was therefore **left exactly as written** — not skipped, not
  weakened, not deleted.
- The defect is **not only in the repository**: a live read-only probe (§2.4) shows
  `notification_command_receipts` returns **HTTP 404 / `PGRST205`** in the remote database, i.e.
  migration 007 was never applied remotely either. The missing file is therefore a genuinely
  unimplemented feature, not a repository-tracking gap.
- The application is consistent with this: the notification bell is now honestly disabled (§1.3) and
  no notification write path is attempted.

**How to clear it:** implement migration `20261020000007` per
`docs/frontend/PHASE_4C_2_NOTIFICATION_BACKEND_SPEC.md` and apply it with owner authorization.
Both tests then pass unchanged. No local code change is required or appropriate.

### 4.3 Local defects that were fixed

- **Two pre-existing triage test failures** (present at the Phase 4D baseline) were corrected in
  Phase 4D: the tests asserted that triage accepts `status: 'assigned'`, while the shipped contract
  (`types/mutations.ts` → `ReportTriageInput.status: 'under_review'`) rejects it. The tests now
  assert the shipped contract *and* assert that `'assigned'` is rejected.

---

## 5. Mock-Data Audit

Every functional page was inspected and each runtime data source classified.

| Page / area | Data source | Classification |
| --- | --- | --- |
| **Dashboard** — 4 KPI cards | `getDashboardKpiStats()` → authenticated `select(..., { count: 'exact' })` on `reports`, RLS-scoped, truncation-guarded | **Authenticated Supabase query** + **derived calculation** |
| **Dashboard** — report queue | `getReportsQueue({ pageSize: 5 })` → authenticated, RLS-scoped, paginated | **Authenticated query** + **derived** (`transformDbReportToMaintenanceReport`) |
| **Dashboard** — Campus Facilities / "N Zones" | `getCampusFacilityBreakdown()` → aggregates the **complete** RLS-visible set; active rows only; reports truncation instead of publishing a partial count | **Authenticated query** + **derived** |
| **Dashboard** — "Technicians On Duty" | No backend supports real-time presence | **Unimplemented backend functionality** — renders "Real-time technician availability is not yet implemented." |
| **Dashboard** — "Resolution SLA" | No SLA/response-deadline column exists in the schema | **Unimplemented backend functionality** — renders "Automated SLA tracking is not yet implemented." |
| **Dashboard** — "Reporting Guidelines" | Static guidance copy | **Static placeholder** (text) — but the fabricated "within 2 hours" commitment was **removed** in §1.2 |
| **Dashboard** — "Report Lifecycle" | Static process description (Submitted → Triage → Assigned → Verification) | **Static placeholder** (accurate, not a metric) |
| **Report queue** (`/reports`) | `getReportsQueue()` with search/status/category filters | **Authenticated query** + **derived** |
| **Report detail** (`/reports/[id]`) | `getReportDetails()` → `transformDbReportToDetailedReport` | **Authenticated query** + **derived** |
| **Report detail** — technician assignment control | `getActiveTechnicians()` → `profiles` where `role='technician' AND is_active` | **Authenticated query**; empty list + honest notice when unavailable |
| **Categories** (report form) | `getActiveCategories()` → `categories` where `is_active` | **Authenticated query**; empty + honest notice on failure (no fixture fallback) |
| **Locations** (`/locations`) | `getLocationsDirectory()` → `locations` | **Authenticated query** + honest error state |
| **Analytics** (`/analytics`) | `getOperationalAnalytics()` → `getOperationalAnalyticsFromClient()` (oversight roles only) | **Authenticated query** + **derived**; explicit "not available for this session" for other roles |
| **Technician workload** (analytics table) | Derived from the same RLS-visible report set (`assignments` join) | **Authenticated query** + **derived** |
| **Settings** (`/settings`) | `getAdministratorSettingsData()` → `profiles` directory + `role_change_audit` | **Authenticated query** + **derived**; honest error states |
| **Notification UI** (header bell) | No backend | **Unimplemented** — control now disabled and labelled accordingly (§1.3) |
| **Navigation chrome** (sidebar dot, "Preview" badge, `badge: 'Active'` tooltip) | Static navigation metadata, not a count or a record | **Static placeholder** — preserved; it asserts no data |
| **Login page test-account list** | Five real accounts provisioned in Gate E.3 (`test-student@`, `test-coord@`, `test-tech@`, `test-admin@`, `test-mgmt@cmirs.internal`); **no passwords** are present | **Static placeholder** (real account identifiers, no credentials, no metrics) |

**No mock or demo records were added anywhere, and no new fixtures were invented.**

### 5.1 Removed mock data (cumulative, Phase 4D + 4D.1)

| Source | Disposition |
| --- | --- |
| `data/mock-reports.ts` — `MOCK_REPORTS` (Alex Morgan, Elena Rostova, Marco Bellini), `MOCK_STATS` (94.2% SLA, 15 repairs/week) | **Deleted** (commit `ebb84a2`) |
| `utils/reports/mock-filter.ts` — mock-only filter/statistics helpers | **Deleted** (commit `ebb84a2`); the isolated Phase 2.5 test keeps its own in-file mirror |
| `FALLBACK_CATEGORIES` / `FALLBACK_LOCATIONS` / `FALLBACK_TECHNICIANS` (incl. two non-existent technician accounts) | **Removed from runtime**; the DAL now fails honestly |
| "Live Backend Connected / Live RLS Active" banner | **Removed** from the dashboard and the report queue (§1.1) |
| "within 2 hours" coordinator response claim | **Removed** (§1.2) |
| Fabricated red unread dot on the notification bell | **Removed** (§1.3) |
| "Across 5 campus buildings", "SLA monitoring", "Read-only SLA metrics" | **Removed** in Phase 4D |

### 5.2 Regression coverage added in this phase

- `tests/unit/phase-4d-real-data-audit.test.mjs` — +3 tests: no functional module asserts an
  unverified backend connection state; the dashboard and report queue still render their real error
  notices; a failing RLS policy helper is classified as a database evaluation failure rather than a
  permission denial.
- `tests/unit/sql-function-parameter-ambiguity.test.mjs` — **new file, 3 tests**: a static detector
  for the PL/pgSQL `ambiguous_column` (42702) defect class, self-tested against a synthetic
  function, and applied to every function in the migration set.

---

## 6. Files Changed

### 6.1 Phase 4D.1 working-tree changes (uncommitted, on top of `890773a`)

```
 app/page.tsx                                 | 43 +++-----------   banner + fabricated SLA claim removed
 app/reports/page.tsx                         | 37 +-----------   identical banner removed
 components/layout/header.tsx                 | 15 ++++--        fabricated unread dot removed
 utils/reports/dal.ts                         | 39 +++++++--      accurate error classification + code/status logging
 utils/reports/transform.ts                   | 15 ++++-         42702 / policy-helper classification
 utils/reports/analytics-runtime.ts           |  5 +-            accurate error classification
 tests/unit/phase-4d-real-data-audit.test.mjs | 84 +++++++++++   +3 regression tests
```

### 6.2 New files (untracked)

```
 scripts/verify-supabase-connectivity.mjs     read-only connectivity + configuration verification
 scripts/verify-server-action-exports.mjs      Next.js ensureServerEntryExports() guard check
 scripts/probe-local-routes.mjs                local HTTP route probe
 scripts/verify-in-browser.mjs                 headless Chrome DevTools Protocol verification
 scripts/next-headers-resolve-hook.mjs         Node ESM resolve hook (verification only)
 tests/unit/sql-function-parameter-ambiguity.test.mjs   static 42702 defect detector (3 tests)
```

### 6.3 Deliberately NOT changed

`supabase/**` (no schema, migration, or RLS change) · `.env.local` / `.env.example` ·
`package.json` / `package-lock.json` (no dependency installed) · `proxy.ts`, `utils/supabase/*`,
`utils/auth/*` · every prior phase report.

---

## 7. Git Audit Findings

### 7.1 Branch and history

```
$ git status --short --branch
## main...origin/main [ahead 3]
 M app/page.tsx
 M app/reports/page.tsx
 M components/layout/header.tsx
AM docs/frontend/PHASE_4D_REAL_DATA_AUDIT_REPORT.md
 M tests/unit/phase-4d-real-data-audit.test.mjs
 M utils/reports/dal.ts
 M utils/reports/transform.ts
?? scripts/
?? tests/unit/sql-function-parameter-ambiguity.test.mjs

$ git log -5 --oneline --decorate
890773a (HEAD -> main) feat: add report transformation utilities, auth login form, mutation types, and unit tests
23031cd feat: add report detail view and supporting actions for facility management system
ebb84a2 feat: implement reports data access layer and UI flows with server actions and components
d2a3e1d (origin/main, origin/HEAD) fix: resolve report submission validation bugs and remove mock dashboard data
16bde00 fix(reports): resolve triage ReferenceError, remove dashboard mock data, and add action tests
```

- The branch is **3 commits ahead of `origin/main`** and **nothing has been pushed**.
- `origin/main` is still `d2a3e1d` — the Phase 4D work is local only.
- No commit, amend, reset, rebase, or history rewrite was performed in this phase.

### 7.2 Contents of the three Phase 4D commits

| Commit | Files | Substance |
| --- | --- | --- |
| `ebb84a2` | `data/mock-reports.ts` (−183), `utils/reports/mock-filter.ts` (−275) | Deletion of the demo fixture module and the mock-only helper module |
| `23031cd` | 16 files (714 insertions / 131 deletions) | `INITIAL_ACTION_STATE` moved out of the `'use server'` module; `utils/reports/action-state.ts`, `dashboard-config.ts`, `reference-catalogs.ts` added; DAL rewritten to fail honestly; `getCampusFacilityBreakdown` added; form/action-panel/page updates; 3 test files updated |
| `890773a` | 4 files (762 insertions / 16 deletions) | `components/auth/login-form.tsx` copy fix; `types/mutations.ts` — removal of a duplicate `INITIAL_ACTION_STATE` definition; `utils/reports/transform.ts` — 2 unused imports dropped; `tests/unit/phase-4d-real-data-audit.test.mjs` added (761 lines) |

### 7.3 Diff review

`git diff` and `git diff --cached` were reviewed in full. The only staged content is
`docs/frontend/PHASE_4D_REAL_DATA_AUDIT_REPORT.md`; the unstaged content is the Phase 4D.1 work
listed in §6.1. No stray binary, build artefact, `.env`, or IDE file is staged or tracked.

### 7.4 Secret scan of the Phase 4D commits

Scanned `git diff d2a3e1d 890773a` for credential patterns (counts only, no values printed):

| Pattern | Matches |
| --- | --- |
| `sb_secret_[A-Za-z0-9_-]+` | 0 |
| `sb_publishable_[A-Za-z0-9_-]+` | 0 |
| `service_role` | 0 |
| `SUPABASE_SERVICE_ROLE` | 0 |
| JWT-shaped strings (`eyJ…`) | 0 |
| `password = "…"` | 0 |
| `.env` paths | 0 |

**Files touched by the three commits:** 19 — all under `actions/`, `app/`, `components/`,
`utils/`, `types/`, `tests/`, `data/`. **Zero** files under `supabase/` or any `.env` file.

### 7.5 Repository hygiene observations (no action taken)

- `docs/frontend/PHASE_4D_REAL_DATA_AUDIT_REPORT.md` is staged with a stale blob while the working
  tree holds the corrected version; `git add` would refresh it. Not performed here, because this
  phase must not commit.
- The environment's own automation created `ebb84a2` / `23031cd` / `890773a` from the Phase 4D
  working tree. This phase did not issue any `git commit`.
- A long-running `next dev` instance (PID 3580, port 3000) predates the Phase 4D fix and holds a
  stale module graph (§3.1). It is owned by another session and was deliberately **not** terminated.

---

## 8. Local vs Remote Verification Status

### 8.1 Verified locally

| Behaviour | Evidence |
| --- | --- |
| The `'use server'` export invariant holds | Next.js's own `ensureServerEntryExports()` accepts all 10 exports of `actions/reports.ts` (`scripts/verify-server-action-exports.mjs`) |
| `/reports/new` loads without the server-action loader error | Fresh production server: HTTP 307 → `/login`, zero server-log output; headless Chrome: 0 console errors, 0 exceptions, no loader text in the DOM |
| The dashboard renders in an **authenticated** context without the loader error | Fresh production server served an authenticated `/` request; the only log output is the §9.1 DAL diagnostic — no loader error, no exception, no 500 (Proof E) |
| Supabase configuration and client initialization | `scripts/verify-supabase-connectivity.mjs` §1–§2 |
| The API endpoint is reachable and the publishable key is accepted | Read-only probes: HTTP 200 for `categories`, `locations`, `reports`, `notifications` |
| RLS is enforced for unauthenticated access | `anon` role receives 0 rows, not an error — every SELECT policy is `TO authenticated` |
| The server client uses the current user's session | `createServerClient` + cookie adapter in `utils/supabase/server.ts`; `getUser()` in `utils/auth/server.ts` |
| The DAL targets the intended tables | Mocked-client table recording + existing `tests/unit/dal-read-queries.test.mjs` |
| Reference catalogs never fall back to demo data | Mocked-client tests for the error path and the empty path |
| Submission validation, failure handling, success semantics | Mocked Supabase insert client driving the real `submitReportAction` |
| Database errors are surfaced safely and accurately | Unit assertions on `describeDatabaseError` / `sanitizeErrorMessage`, including the new `42702` class |
| No fabricated values remain in functional modules | Repository-wide source scan + regression tests |
| TypeScript / ESLint / production build | `tsc --noEmit` 0 errors · `eslint` 0 errors, 0 warnings · `next build` succeeds |
| Unit suite | 163 tests, 161 pass, 2 pre-existing failures |

### 8.2 Requires authorized remote verification (NOT performed)

| Behaviour | Blocker |
| --- | --- |
| **Report reads for `student_personnel` and `technician`** | **Pre-existing database defect** — `public.can_view_report()` raises PostgreSQL `42702` (§9.1) |
| A live report submission writing a real row | No authorized session; creating remote test records is prohibited |
| The new report appearing in the authenticated list / detail per role | Depends on the §9.1 fix and on live RLS evaluation |
| Live dashboard KPI numbers and the live facility zone count | Blocked by §9.1 for students/technicians; observable for oversight roles |
| The coordinator technician directory returning real accounts | Requires provisioned technician profiles; the directory legitimately renders empty until then |
| Real attachment upload to the `report-attachments` bucket | Requires the live bucket policy and an authenticated session |
| Session-expiry and RLS-denial behaviour end to end | Requires a live JWT and live policy evaluation |
| Notification lifecycle RPCs | Migration `20261020000007` was never authored or applied (§4.2) |

### 8.3 What was deliberately NOT done

No remote write, insert, update, delete, truncate, seed, or RPC invocation · no service-role key
use · no RLS bypass · no schema, migration, or RLS-policy change · no environment-file
modification · no dependency installation · no deployment · no commit, push, amend, reset, or
rebase · no fabricated records, metrics, or success claims.

---

## 9. Exact Remaining Blockers

### 9.1 BLOCKER 1 (highest impact) — `public.can_view_report()` raises PostgreSQL `42702` (`ambiguous_column`)

**Status: diagnosed with live remote evidence; NOT fixed, because the repair is a migration.**

**Live evidence** (captured from the running application in `.next/dev/logs/next-development.log`,
timestamp `12:19:10`, after the DAL was instrumented to log the PostgREST code and status):

```
[DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous" | code= "42702" | status= "unknown"
[DAL] getDashboardKpiStats query error: "column reference \"report_id\" is ambiguous" | code= "42702" | …
[DAL] getCampusFacilityBreakdown query error: "column reference \"report_id\" is ambiguous" | code= "42702" | …
```

**Root cause.** `supabase/migrations/20261018000004_security_functions_and_rpc.sql`, function
`public.can_view_report(report_id UUID)`:

```sql
  -- 3. Technician with qualifying assignment (all statuses EXCEPT declined, APPROVED OD-NEW-4)
  IF caller_role = 'technician' AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = report_id        -- <-- ambiguous
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
  ) THEN
```

`public.assignments` has a `report_id` column (`20261018000001_core_schema.sql:191`) and the
function parameter is also named `report_id`. PL/pgSQL's default `variable_conflict = error` raises
**`column reference "report_id" is ambiguous`** (PostgreSQL code **42702**) when the name could
denote either the parameter or a column of a table in the FROM clause. `public.reports` has **no**
`report_id` column, so the earlier reporter check (`r.id = report_id`) is unambiguous — the failure
is in the technician branch.

**Why it affects every role that is not an oversight role.** The whole `IF` condition is one SQL
statement, so the sub-select is parsed for every caller. Oversight roles
(`coordinator`, `administrator`, `management`) return `TRUE` in the first branch and never reach the
ambiguous statement, so their reads work. For `student_personnel` and `technician` the function
raises, and because the `reports_select` RLS policy is
`USING (public.can_view_report(id))`, **every `SELECT` on `public.reports` fails** — dashboard KPIs,
report queue, facility breakdown, and report detail. This is the exact defect class the new
`tests/unit/sql-function-parameter-ambiguity.test.mjs` detects statically, and the detector confirms
that `public.can_view_report` is the **only** affected function in the migration set.

**Remediation (proposed — requires owner authorization; NOT applied here).** Rename the parameter so
it no longer collides with the column name. This is a database function change and therefore a
migration:

```sql
-- PROPOSED migration 20261021000008_can_view_report_parameter_rename.sql
-- Requires owner authorization. Not created, not applied.
CREATE OR REPLACE FUNCTION public.can_view_report(p_report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  caller_role user_role;
BEGIN
  caller_role := public.get_user_role();

  IF caller_role IN ('coordinator','administrator','management') THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reports r
    WHERE r.id = p_report_id
      AND r.reporter_id = auth.uid()
  ) THEN
    RETURN TRUE;
  END IF;

  IF caller_role = 'technician' AND EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = p_report_id
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_report(UUID) TO authenticated;
```

(The `REVOKE`/`GRANT` pair mirrors the original migration exactly, so no privilege is widened.)
Applying it requires a new migration file, which this phase is explicitly prohibited from creating.
Once applied, `tests/unit/sql-function-parameter-ambiguity.test.mjs` will report
"No ambiguous function detected" and its expected-set assertion must be updated to `[]` — the test
is written to prompt exactly that.

**Application-side mitigation already in place.** The DAL now returns an accurate notice
("The database could not evaluate the report visibility rule…") instead of a misleading permission
message, and the dashboard/report queue render it in the existing "Notice:" banner. The application
degrades honestly; it does not fabricate data.

### 9.2 BLOCKER 2 — no authenticated session is *controllable* from this phase

`auth.getUser()` returns `AuthSessionMissingError` (HTTP 400) for this phase's own context. The five
Gate E.3 test accounts exist but **no password is documented anywhere in the repository**
(deliberate: "Zero passwords, tokens, or service-role keys were printed, logged, or committed").

An authenticated browser session *does* exist in the shared environment (Proof E shows its requests
reaching the production server), but its cookie jar is not accessible to this phase, and using it
would be indistinguishable from acting on another participant's session. Consequently:

- an **authenticated read** could not be executed *by this phase* (the anon probe proves
  connectivity and RLS, but not row visibility for a signed-in role);
- a **live submission** could not be performed;
- the **per-role visibility** of a submitted report in the queue and detail view remains unverified.

**To clear it:** the owner supplies credentials for an existing test account (no account creation
needed), and the verification scripts are re-run with that session. Live persistence must then be
confirmed by reading the created row back through the authenticated DAL.

### 9.3 BLOCKER 3 — notification lifecycle migration `20261020000007` was never authored

See §4.2. The two failing tests are the specification of that migration; the feature is unimplemented
in the repository **and** in the remote database (`notification_command_receipts` → HTTP 404 /
`PGRST205`). The application is honest about this (the bell is disabled and labelled).

### 9.4 BLOCKER 4 — the long-running dev server holds a stale module graph

The `next dev` instance on port 3000 (PID 3580) predates the Phase 4D fix and re-evaluated the old
`actions/reports.ts` at 11:35, which is why the dev log still shows loader errors at that timestamp.
The current production build and the fresh production server are clean (§3.1). A dev-server restart
clears the stale graph. The instance was **not** terminated because it carries another session's
authenticated browser session.

### 9.5 Non-blockers, recorded for completeness

- The `Technicians On Duty` and `Resolution SLA` dashboard widgets remain unimplemented because the
  schema has no presence or response-deadline data. They state this; they are not defects.
- Server-side idempotency for report creation is not implemented (it would require a schema
  change). The client-side single-flight guard prevents double submissions from the UI.
