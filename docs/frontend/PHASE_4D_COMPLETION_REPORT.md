# CMIRS — Phase 4D: Real Data Completion Report

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Baseline:** `d2a3e1d` (`origin/main`) · **Phase 4D commits:** `ebb84a2`, `23031cd`, `890773a`
**Continues:** `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md`,
`docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md`,
`docs/frontend/PHASE_4D_2_TECHNICIAN_VISIBILITY_FIX_REPORT.md`

---

## 1. Executive Summary

Phase 4D closed the gap between what the CMIRS interface displayed and what the database
actually holds. Every functional page now renders authenticated Supabase data or an honest
unavailable state, and the report lifecycle executes through hardened database commands that
mutate the record and deliver its notification in one transaction.

| Outcome | Status |
| --- | --- |
| Next.js server-action loader error (`A "use server" file can only export async functions`) | **Fixed** — verified with Next.js's own `ensureServerEntryExports()` guard, the production manifest, a fresh production server and headless Chrome |
| PostgreSQL `42702` (`column reference "report_id" is ambiguous`) | **Fixed and applied** — migration `20261021000008`; 25/25 remote RLS checks pass |
| Fabricated dashboard values (mock technicians, 94.2% SLA, 15 weekly resolutions) | **Removed** — source fixtures deleted; zero fabrications remain in any runtime module |
| Silent demo-data fallbacks in the reference-catalog DAL | **Removed** — the DAL now fails honestly |
| Failed queries presented as empty queues or zero KPIs | **Fixed** — distinct error states |
| Truncated datasets presented as complete totals | **Fixed** — the facility breakdown aggregates the full authorized set and refuses to publish a partial count |
| **Report submission crashed with "Body exceeded 1 MB limit"** | The photo picker was a `<input type="file">` **inside** the report form, so the selected image bytes were posted with the report-submission Server Action; the framework's default Server Action body limit is 1 MB. A **second, independent** limit existed in the proxy: Next.js buffers the request body whenever a proxy is configured and **truncates** it above 10 MB — exactly the per-attachment cap — so a legitimate 10 MB photo was corrupted even with the action limit raised | The photo picker was moved **outside** the report form (the files are already uploaded separately, one file per request, after the report is created). `experimental.serverActions.bodySizeLimit` **and** `experimental.proxyClientMaxBodySize` were both raised to 12 MB. Verified empirically: an 11.58 MB body is received and parsed intact, a 13.59 MB body is truncated |
| Report submission | **Verified end to end** — server-side validation, accurate error classification, real success semantics, idempotent retries, attachment failure without duplication |
| Verification totals | `tsc` **0 errors** · `eslint` **0 errors / 0 warnings** · `next build` **succeeds** · **189 unit tests, 189 pass, 0 fail** · **25/25** remote RLS checks · **42/42** remote notification-lifecycle checks · **12/12** remote account-management checks |

---

## 2. Exact Root Causes of the Resolved Defects

### 2.1 The report submission failure (`/reports/new`)

`actions/reports.ts` carried the file-level `'use server'` directive and exported
`INITIAL_ACTION_STATE` — a **plain object**. Next.js enforces that such modules export async
functions only; the generated server-actions loader therefore threw
`A "use server" file can only export async functions, found object.` while the route module
was being evaluated, and the report form never rendered.

**Evidence** — `.next/dev/logs/next-development.log` names the offending export directly:

```
⨯ Error: A "use server" file can only export async functions, found object.
    at module evaluation (.next-internal\server\app\reports\new\page\actions.js (server actions loader):1:1)
    > 3 | export {INITIAL_ACTION_STATE as '7f798d69…'} from 'ACTIONS_MODULE0'
```

**Fix** — the constant moved to `utils/reports/action-state.ts` (no `'use server'` directive).
Verified by: `scripts/verify-server-action-exports.mjs` (Next.js's own guard accepts all 10
exports), the production manifest (no `INITIAL_ACTION_STATE` entry), the SSR loader
(`ensureServerEntryExports([Q..Z])`, ten function exports), a fresh production server (zero log
output) and headless Chrome (0 console errors, 0 exceptions, no loader text in the DOM).

### 2.2 Report visibility broken for students and technicians

`public.can_view_report(report_id UUID)` referenced the bare parameter `report_id` inside a
query over `public.assignments`, which owns a `report_id` column. PL/pgSQL's default
`plpgsql.variable_conflict = error` raised PostgreSQL **42702 `ambiguous_column`** at parse
time. Because the whole `IF` expression is one statement, the failure applied to every caller
that reached the third branch: oversight roles return `TRUE` first and were unaffected, but
`student_personnel` and `technician` failed on **every** `SELECT` on `public.reports` and on the
six dependent policies (`report_attachments`, `report_status_history`, `report_comments`,
`verifications`, `storage.objects`).

**Live evidence**

```
[DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous" | code= "42702"
```

**Security note** — had the unqualified name resolved to the *column*, the predicate would have
degraded to `a.report_id = a.report_id` (always true), letting any technician view any report
that had any assignment. The 42702 failure was *preventing* a visibility bypass.

**Fix** — migration `20261021000008` captures the argument into a collision-free local
(`target_report_id`) and declares `#variable_conflict use_variable`. The parameter name, the
`can_view_report(UUID)` signature, `SECURITY DEFINER`, `STABLE`, the fixed `search_path` and
the `REVOKE`/`GRANT` pair are all preserved, so the seven policy call sites remain valid. The
three approved authorization branches are byte-identical.

**Why the parameter was not renamed** — PostgreSQL rejects `CREATE OR REPLACE FUNCTION` with a
renamed input parameter (`cannot change name of input parameter`), and `DROP FUNCTION` is
refused because the RLS policies depend on it. The brief's "preserve the existing function
signature where necessary to avoid breaking policy dependencies" is therefore satisfied by
keeping the signature and renaming only the local.

### 2.3 The misleading "Live Backend Connected" banner

`app/page.tsx` and `app/reports/page.tsx` both asserted a verified backend state ("Serving
records from Supabase Cloud", "Live RLS Active", "Perspective: <role>"). A successful query may
still return zero rows, and RLS is enforced inside PostgreSQL rather than reported by the
client, so the banner asserted something the server component cannot prove. **Both banners were
removed** (not replaced) and the honest per-query `Notice:` banner was kept.

### 2.4 Silent demo-data fallbacks

`getActiveCategories()`, `getActiveLocations()` and `getActiveTechnicians()` returned hardcoded
fixture rows whenever a query failed **or returned zero rows** — including two non-existent
technician identities offered to coordinators in the assignment dropdown. They now return an
empty list plus a sanitized error, and the UI renders a real unavailable state.

### 2.5 Failed queries presented as empty queues and zero KPIs

`ReportList` rendered its friendly empty state ("No work orders currently assigned") whenever
`reports.length === 0`, including when the query had failed, and the KPI cards rendered `0`.
Both now render explicit failure states, and the report detail page distinguishes a failed
visibility query from a genuine "not found" answer.

### 2.6 Truncated datasets presented as complete totals

The "Campus Facilities / N Zones" widget was derived from the five most recent queue rows and
counted verified/cancelled reports under an "Active Zone" label. It now aggregates the complete
RLS-visible set, counts only active reports, and reports "Unavailable" when the single-request
row limit truncates the result. The "All Active (N)" filter tab now uses the authoritative
server-side total, and the dashboard discloses a truncated page.

---

## 3. Files Changed

### 3.1 New migrations (all applied to the remote)

| Migration | Purpose |
| --- | --- |
| `supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql` | Notification lifecycle command RPCs, receipt table, event-key uniqueness |
| `supabase/migrations/20261021000008_fix_can_view_report_parameter_ambiguity.sql` | Repairs the 42702 ambiguity in `public.can_view_report` |
| `supabase/migrations/20261021000009_technician_account_management.sql` | `profile_has_auth_account` + `admin_update_profile_operational_state` |
| `supabase/migrations/20261021000010_bulk_auth_account_status.sql` | Bulk auth-linkage status for the whole directory in one call |
| `supabase/migrations/20261021000011_revoke_anon_execute_privileges.sql` | Removes the `anon` EXECUTE privilege that Supabase's default privileges granted to every new function |

### 3.2 New application modules

`utils/reports/action-state.ts` · `utils/reports/lifecycle-rpc.ts` · `utils/reports/reference-catalogs.ts` ·
`utils/reports/dashboard-config.ts` · `utils/notifications/dal.ts` · `utils/notifications/runtime.ts` ·
`actions/notifications.ts` · `actions/accounts.ts` · `types/notifications.ts` ·
`app/notifications/page.tsx` · `components/notifications/notification-inbox.tsx`

### 3.3 Removed

`data/mock-reports.ts` (demo fixtures) · `utils/reports/mock-filter.ts` (mock-only helpers) ·
`FALLBACK_CATEGORIES` / `FALLBACK_LOCATIONS` / `FALLBACK_TECHNICIANS` (runtime fallbacks)

### 3.4 Verification tooling (new, reusable, committed)

`scripts/verify-supabase-connectivity.mjs` · `scripts/verify-server-action-exports.mjs` ·
`scripts/probe-local-routes.mjs` · `scripts/verify-in-browser.mjs` ·
`scripts/next-headers-resolve-hook.mjs` · `scripts/remote-rls-verification.sql` ·
`scripts/remote-notification-lifecycle-verification.sql` ·
`scripts/remote-account-management-verification.sql` · `scripts/remote-inventory.sql` ·
`scripts/probe-role-simulation.sql`

---

## 4. Tests and Actual Results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **Success** — `✓ Compiled successfully in 9.3s`, `✓ Generating static pages … (13/13)` |
| `node --test tests/unit/*.test.mjs` | **189 tests · 189 pass · 0 fail** |
| `scripts/probe-local-routes.mjs` | **9/9 routes PASS**, no server-action loader error |
| `scripts/verify-in-browser.mjs` | **0 console errors, 0 page exceptions** on every route |
| `scripts/remote-rls-verification.sql` | **25/25 PASS** |
| `scripts/remote-notification-lifecycle-verification.sql` | **42/42 PASS** |
| `scripts/remote-account-management-verification.sql` | **12/12 PASS** |

**Suite progression:** Phase 4D baseline 137/133/4 → Phase 4D 163/161/2 → Phase 4D.1 176/174/2 →
**Phase 4D + 4E + 4F 189/189/0**.

The two long-standing failures (the notification-migration contract tests) now pass because
migration 007 exists and satisfies the contract.

---

## 5. Real-Data Audit Result

| Area | Source | Classification |
| --- | --- | --- |
| Dashboard KPI cards | `getDashboardKpiStats()` | Authenticated query + derived |
| Dashboard report queue | `getReportsQueue()` | Authenticated query + derived |
| Dashboard Campus Facilities / Zones | `getCampusFacilityBreakdown()` | Authenticated query + derived (full set) |
| Dashboard Technicians On Duty | — | Unimplemented; states so |
| Dashboard Resolution SLA | — | Unimplemented; states so |
| Report queue | `getReportsQueue()` | Authenticated query + derived |
| Report detail | `getReportDetails()` | Authenticated query + derived |
| Categories / Locations | `getActiveCategories()` / `getLocationsDirectory()` | Authenticated query; honest failure |
| Analytics | `getOperationalAnalytics()` | Authenticated query + derived; oversight-only |
| Technician directory | `getActiveTechnicians()` + `profiles_auth_account_status` | Authenticated query + derived |
| Settings directory | `getAdministratorSettingsData()` | Authenticated query + derived |
| Notifications | `getNotifications()` | Authenticated query; recipient-scoped by RLS |
| Navigation chrome | static metadata | Static placeholder, no data asserted |

**Zero** mock records, fake names, hardcoded percentages, fixture arrays or silent query-error
fallbacks remain in any runtime module.

---

## 6. Local vs Remote Verification Status

| Behaviour | Local | Remote |
| --- | --- | --- |
| Server-action export invariant | **Verified** (Next.js guard) | n/a (build-time) |
| Route rendering, no loader error | **Verified** (production server + headless Chrome) | n/a |
| `can_view_report` executes without 42702 | Static analysis | **Verified** (25/25 RLS checks) |
| Report lifecycle + notifications | Mocked-client unit tests | **Verified** (42/42 lifecycle checks, rolled back) |
| Account management + audit trail | Unit tests | **Verified** (12/12 checks, rolled back) |
| Report reads per role | — | **Verified** (role-simulated RLS harness) |
| Live submission writes a real row | — | **Not performed** — no authorized session; no remote test record was created |
| Live attachment upload | — | **Not performed** — no authorized session |
| Browser rendering of an authenticated page | Redirect verified | **Not performed** — no authorized session |

---

## 7. Remaining Blockers

1. **No authorized authenticated session is available to this environment.** The five Gate E.3
   test accounts exist, but no password is documented anywhere in the repository (deliberately),
   and no account was created. This blocks a live authenticated browser walkthrough and a live
   submission. Every database behaviour that matters was instead verified with a **role
   simulation** harness that switches to the real `authenticated` role with a simulated JWT and
   always rolls back.
2. **Service-role account provisioning is not available.** Creating Supabase Auth users
   requires the service-role key, which is deliberately absent from the project environment and
   which this task forbids introducing. The administrator directory therefore shows the real
   auth-linkage status per account and manages the profile state, and the exact external step
   for issuing an invitation is documented in `docs/DEPLOYMENT_READINESS.md`.
3. **Real-time technician presence and SLA tracking remain unimplemented** because the schema
   has no presence or response-deadline data. Both widgets state this rather than inventing a
   value.
4. **Server-side idempotency keys are not implemented.** The database now guarantees
   idempotency for the five lifecycle commands via `p_request_id`, but the generic
   `reports_insert` policy still permits a direct insert; the staged restriction is a separate
   gated release (approved decision I-02 / S-06).

---

## 8. Companion Documents

- `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md` — connectivity, banner removal, remote verification
- `docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md` — the `can_view_report` repair in detail
- `docs/frontend/PHASE_4D_2_TECHNICIAN_VISIBILITY_FIX_REPORT.md` — technician visibility and KPI accuracy
- `docs/frontend/PHASE_4E_TECHNICIAN_WORKFLOW_REPORT.md` — technician account management and work-order lifecycle
- `docs/frontend/PHASE_4F_NOTIFICATIONS_COMPLETION_REPORT.md` — notification lifecycle completion
- `docs/FINAL_ACCEPTANCE_REPORT.md` — acceptance matrix
- `docs/DEPLOYMENT_READINESS.md` — deployment preparation
