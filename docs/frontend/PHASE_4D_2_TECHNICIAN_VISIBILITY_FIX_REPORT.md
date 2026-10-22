# CMIRS — Phase 4D.2: Technician Report Visibility Fix and Role-Based Dashboard Verification

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Continues:** `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md` §9.1
**Companion report:** `docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md` (migration authoring)

> ### Status update — 2026-10-21 (later in the same working session)
>
> This document records the state of the work at the moment the technician defect was
> diagnosed. **The database-side repair has since been applied** (`20261021000008`, pushed with
> `npx supabase db push --linked`) and verified against the live project by
> `scripts/remote-rls-verification.sql` (**25/25 PASS**). The notification lifecycle was then
> implemented (migration 007) and the five lifecycle commands now execute through hardened
> command RPCs — see `docs/frontend/PHASE_4F_NOTIFICATIONS_COMPLETION_REPORT.md`. The current
> authoritative record is `docs/FINAL_ACCEPTANCE_REPORT.md`.

---

## 1. Exact Root Cause and Evidence

### 1.1 The message the technician saw

> "The database could not evaluate the report visibility rule, so report data cannot be displayed right now."

That wording is **correct and intentional** — it was introduced in Phase 4D.1 by the
`42702` / `ambiguous_column` branch of `describeDatabaseError()` in `utils/reports/transform.ts`.
The message is not a generic mask: it names a database-side evaluation failure instead of
misreporting it as a permission problem.

### 1.2 Evidence chain

**Step 1 — the error is a PostgreSQL error, not a PostgREST or application error.**

`utils/reports/dal.ts` logs the PostgREST error code and status for every read path. The
running application produced:

```
[DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous" | code= "42702" | status= "unknown"
[DAL] getDashboardKpiStats query error: "column reference \"report_id\" is ambiguous" | code= "42702" | …
[DAL] getCampusFacilityBreakdown query error: "column reference \"report_id\" is ambiguous" | code= "42702" | …
```

Source: `.next/dev/logs/next-development.log` (timestamp `12:19:10`), reproduced against a
freshly built production server. **SQLSTATE 42702 = `ambiguous_column`**, raised by PL/pgSQL.

**Step 2 — the ambiguous reference is inside the RLS policy helper, not in the policy itself.**

The seven RLS expressions that reference the helper are plain SQL policy expressions, where
`report_id` unambiguously denotes the calling table's column:

| Policy | Expression |
| --- | --- |
| `reports_select` | `public.can_view_report(id)` |
| `report_attachments_select` | `deleted_at IS NULL AND public.can_view_report(report_id)` |
| `report_status_history_select` / `_insert` | `public.can_view_report(report_id)` |
| `report_comments_select` | `public.can_view_report(report_id)` |
| `verifications_select` | `public.can_view_report(report_id)` |
| `storage.objects` SELECT | `public.can_view_report(ra.report_id)` |

The ambiguity is **inside** `public.can_view_report(report_id UUID)`
(`supabase/migrations/20261018000004_security_functions_and_rpc.sql`), whose technician branch
reads:

```sql
    SELECT 1 FROM public.assignments a
    WHERE a.report_id = report_id        -- <<< ambiguous: parameter vs assignments.report_id
      AND a.technician_id = auth.uid()
      AND a.status != 'declined'
```

`public.assignments` owns a `report_id` column; the function parameter has the same name.
PL/pgSQL's default `plpgsql.variable_conflict = error` therefore raises
`column reference "report_id" is ambiguous` at parse time. The reporter branch
(`r.id = report_id` over `public.reports`) is **not** ambiguous, because `public.reports`
has no `report_id` column.

**Step 3 — why it only breaks students and technicians.** The whole `IF` condition is parsed
as one statement, so the ambiguous sub-select is parsed for every caller that reaches the
third branch. Oversight roles return `TRUE` in the first branch and never reach it; they are
unaffected. `student_personnel` and `technician` reach it, and because the `reports_select`
policy is `USING (public.can_view_report(id))`, **every `SELECT` on `public.reports` fails for
those two roles** — along with the dependent attachment, status-history, comment, verification
and Storage policies.

**Step 4 — `auth.uid()` and role resolution are NOT implicated.** `public.get_user_role()`
(`SELECT role FROM public.profiles WHERE id = auth.uid()`) takes no parameters and is
unambiguous; the error is raised by the *visibility* helper, after role resolution has
already succeeded. The session, the profile lookup, the assignment relationship and the
report-ownership rule are all correct.

**Step 5 — the joins and permissions are NOT implicated.** The technician's visibility path
is `reports` → `assignments` on `a.report_id = <report id>`, backed by the existing
`idx_assignments_lookup (report_id, technician_id, status)` index. No join is missing; no
permission was denied (PostgreSQL returned 42702, not 42501).

**Step 6 — the classification was not obscuring anything.** The Phase 4D.1 classifier maps
`42702` and the "is ambiguous" wording to the database-evaluation-failure notice, and that
notice is what the technician saw. The message was accurate; the defect was real.

### 1.3 Security significance

Had the unqualified `report_id` resolved to the **column** (as plain SQL would), the
predicate would have collapsed to `a.report_id = a.report_id` — always true for any
assignment row — letting **any technician view any report that has any assignment**. The
42702 failure is currently *preventing* that bypass. The repair restores the intended
comparison `assignments.report_id = <the report id argument>` and does not widen access.

### 1.4 Attribution

**Pre-existing, not introduced by Phase 4D or 4D.1.** The function was created by migration
`20261018000004` and has never been redefined since; `git log -- supabase/migrations/` shows
no later revision. It was masked in earlier phases because the dashboards rendered mock data
and never executed the RLS-scoped queries.

---

## 2. Files Changed

### 2.1 Database-side (prepared, NOT applied)

| File | Change |
| --- | --- |
| `supabase/migrations/20261021000008_fix_can_view_report_parameter_ambiguity.sql` | **NEW** — additive migration replacing the body of `public.can_view_report` only. Removes the ambiguous reference, preserves all three approved authorization branches verbatim, preserves the `can_view_report(UUID)` signature, `SECURITY DEFINER`, `STABLE`, `search_path` and both privilege statements. Touches no table, policy, role or data. Full analysis in `PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md`. |

### 2.2 Application-side (verified defects, fixed)

| File | Defect | Fix |
| --- | --- | --- |
| `components/dashboard/report-list.tsx` | A failed query rendered the **friendly empty state** ("No work orders currently assigned") — a database failure was presented as a successful empty queue. | New `error` prop. When set, the list renders an explicit failure panel ("Report data could not be loaded", with the sanitized DAL message, a "this is a database query failure, not an empty result" clarification, and a Retry action) and never the empty state. The error branch is evaluated **before** the empty branch. |
| `components/ui/stat-card.tsx` | A failed KPI query rendered `0`, presenting a failure as a real "zero reports" metric. | New `unavailable` prop → renders **"Unavailable"** in an amber, muted style instead of a number. |
| `app/page.tsx` | KPI cards always showed numbers; the report list never received the queue error; the "All Active (N)" tab counted only the 5 rows on the page, implying a complete total. | KPI cards receive `unavailable={Boolean(kpiResult.error)}` (and the "Action required" alert is suppressed while unavailable, so a failure cannot masquerade as "no urgent hazards"). `ReportList` receives `error` and `totalCount`. A caption discloses a truncated page: *"Showing the 5 most recent of N reports visible to your role."* |
| `app/reports/page.tsx` | The report queue page never forwarded the query error to the list. | `ReportList` receives `error={queueResult.error}` and `totalCount={queueResult.totalCount}`. |
| `app/reports/[id]\page.tsx` | A failed visibility query was titled "Report Not Found" — a database failure was presented as an authorization answer. | The heading now distinguishes the two: **"Report Data Unavailable"** for a query failure (with "This is not a statement that the report does not exist"), **"Report Not Found"** for a genuine not-found/access-denied result. |
| `components/dashboard/report-list.tsx` | (count accuracy) The "All Active" tab counted the rows on the current page. | The tab now uses the authoritative server-side total (`totalCount ?? reports.length`). |

### 2.3 Tests

| File | Tests | Purpose |
| --- | --- | --- |
| `tests/unit/sql-function-parameter-ambiguity.test.mjs` | **7** (rewritten) | Statement-scoped `ambiguous_column` detector; effective-definition resolution across the migration set; proof that migration 008 supersedes migration 004; authorization-behaviour preservation; structural PL/pgSQL validation; additive-only validation; RLS call-site compatibility |
| `tests/unit/role-visibility-model.test.mjs` | **9** (new) | Executable access-matrix model; anti-broadening proof against the effective SQL; qualification-predicate preservation; count accuracy; KPI/filter alignment; failed-query-vs-empty-result guarantee |

### 2.4 Deliberately unchanged

`supabase/migrations/2026101800000{1..6}*.sql` (all prior migrations, including the RLS policy
file and the storage policy) · any RLS policy · `.env.local` / `.env.example` ·
`package.json` / `package-lock.json` (no dependency installed) · `proxy.ts`,
`utils/supabase/*`, `utils/auth/*` · the `can_view_report` parameter name and function
signature.

---

## 3. Tests and Actual Results

```
$ node --test --test-reporter=tap tests/unit/sql-function-parameter-ambiguity.test.mjs
# tests 7    # pass 7    # fail 0

$ node --test --test-reporter=tap tests/unit/role-visibility-model.test.mjs
# tests 9    # pass 9    # fail 0
```

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **Success** — `✓ Compiled successfully in 5.4s`, `✓ Generating static pages … (12/12)` |
| `node --test tests/unit/*.test.mjs` | **176 tests · 174 pass · 2 fail** |
| `node scripts/probe-local-routes.mjs http://localhost:3101` | **9/9 routes PASS** — all protected routes 307 → `/login`; `/login` HTTP 200 with a rendered form; **no** server-action loader error in any response |
| `node scripts/verify-in-browser.mjs http://localhost:3101` | `/reports/new` and `/login`: **0 console errors, 0 page exceptions**, no loader error in the DOM |

**Progression:** Phase 4D baseline 137/133/4 → Phase 4D 163/161/2 → **Phase 4D.2 176/174/2**.

### 3.1 The two remaining failures (pre-existing, unrelated)

`notification lifecycle migration defines five hardened atomic command RPCs` and
`notification migration protects receipts, prevents generic inserts, and preserves direct-write policies`
— both fail with
`ENOENT: no such file or directory, open '…\supabase\migrations\20261020000007_notification_lifecycle_rpcs.sql'`.
That migration was never authored (Phase 4C is a design-only plan) and was never applied to the
remote database either (a live read-only probe returns HTTP 404 / `PGRST205` for
`notification_command_receipts`). The tests are a forward-looking specification and were left
exactly as written — not skipped, weakened, or deleted.

---

## 4. Role Visibility Findings

### 4.1 The five role dashboards, data source by data source

| Role | Dashboard data | Source | Status |
| --- | --- | --- | --- |
| `student_personnel` | 4 KPI cards | `getDashboardKpiStats()` → RLS-scoped `select(..., { count: 'exact' })` on `reports`, **plus** an application-level `.eq('reporter_id', user.id)` filter (defence in depth) | Authenticated query + derived | **Broken by 42702**; repaired by migration 008 |
| `student_personnel` | Report queue | `getReportsQueue()` → same reporter filter, paginated | Authenticated query + derived | Broken by 42702 |
| `technician` | 4 KPI cards ("Assigned Tasks", …) | `getDashboardKpiStats()` — **no** application-level filter; the RLS policy is the authorization boundary, which restricts the technician to reports they hold a qualifying assignment on | Authenticated query + derived | **Broken by 42702**; repaired by migration 008 |
| `technician` | "Technicians On Duty" widget | No backend supports real-time presence | **Unimplemented** — the widget states so | Not a defect |
| `technician` | "Resolution SLA" widget | The schema has no response-deadline column | **Unimplemented** — the widget states so | Not a defect |
| `coordinator` | KPI cards, queue, facility breakdown | `getDashboardKpiStats()` / `getReportsQueue()` / `getCampusFacilityBreakdown()`; `can_view_report` returns `TRUE` in the first branch | Authenticated query + derived | **Unaffected** by 42702 (worked throughout) |
| `administrator` | As above | As above | Authenticated query + derived | Unaffected |
| `management` | As above + analytics | `getOperationalAnalytics()` (oversight roles only) | Authenticated query + derived | Unaffected |
| all roles | Report detail | `getReportDetails()` → `transformDbReportToDetailedReport`; student reporter filter + a final role re-check | Authenticated query + derived | Broken for students/technicians by 42702 |

### 4.2 The intended access matrix (executable model, asserted)

| Viewer | Target | Assignment | Result | Enforced by |
| --- | --- | --- | --- | --- |
| Reporter (owner) | own report | — | may view | `can_view_report` branch 2 + `reports_select` |
| Another student | someone else's report | — | **may not view** | branch 2 + branch 3 both fail → `FALSE` |
| Technician | assigned report | `assigned` / `in_progress` / `on_hold` / `completed` | may view | branch 3 (`a.status != 'declined'`) |
| Technician | assigned report | `declined` | **may not view** | branch 3 excludes declined |
| Technician | report assigned to another technician | — | **may not view** | `a.technician_id = auth.uid()` |
| Technician | report they are assigned to, reported by someone else | `assigned` | may view | branch 3 |
| `coordinator` / `administrator` / `management` | any report | — | may view | branch 1 |
| Reporter who is also a technician | own report | — | may view | branch 2 applies regardless of role |
| Unauthenticated (`anon`) | any report | — | **may not view** | no `TO authenticated` policy matches; the live probe returns 0 rows, not an error |

### 4.3 Access is not broadened

Two independent tests assert this:

1. The **model test** encodes the matrix above and asserts every row.
2. The **SQL test** parses the *effective* function definition and asserts that the technician
   branch compares `a.report_id` with the local assigned from the function argument, and
   explicitly asserts that it does **not** contain `a.report_id = a.report_id` — the
   self-comparison that would grant every technician access to every report with an assignment.
   It also asserts the branch count is exactly three, so no fourth visibility path can be
   introduced.

### 4.4 Related policies that were also broken

Because `can_view_report` backs them, the 42702 failure also broke, for students and
technicians: reading `report_attachments`, `report_status_history`, `report_comments` and
`verifications`, and downloading attachments from the `report-attachments` Storage bucket
(`storage.objects` SELECT policy). All are repaired by the same single function replacement,
with no policy change.

### 4.5 Defense in depth retained

- The DAL still applies an application-level `.eq('reporter_id', user.id)` for
  `student_personnel` in `getReportsQueue`, `getDashboardKpiStats`,
  `getCampusFacilityBreakdown` and `getReportDetails`, in addition to RLS.
- `getReportDetails` still performs a final role re-check after the transformation.
- Technicians are **not** filtered in by the application — RLS remains the single authorization
  boundary for their work orders, exactly as designed.

---

## 5. KPI Accuracy Findings

### 5.1 KPI derivation — verified correct

`calculateKpiStatsFromDbReports()` in `utils/reports/transform.ts`:

| KPI | Rule | Verified |
| --- | --- | --- |
| `totalActive` | not `verified` and not `cancelled` (`completed` stays active pending verification) | ✅ matches the approved business decision |
| `pendingReview` | `submitted` OR `under_review` | ✅ identical to the "Pending Review" filter tab |
| `inProgress` | `assigned` OR `in_progress` OR `on_hold` | ✅ identical to the "In Progress" filter tab |
| `resolvedThisWeek` | `verified` **and** `updated_at` inside the Philippine calendar week (never `created_at`) | ✅ |
| `urgentHazards` | `is_urgent_hazard === true` **OR** `confirmed_priority === 'critical'` | ✅ identical to the "Urgent & Critical" filter tab |

A new test asserts that each KPI status set is byte-identical to the corresponding UI filter,
so the two cannot drift apart.

### 5.2 Counts come from the complete authorized dataset

| Count | Before | After |
| --- | --- | --- |
| KPI cards | `count: 'exact'` over the RLS-scoped set, with an `isDatasetTruncated()` guard that refuses to publish a partial total | Unchanged (correct) |
| Campus Facilities / "N Zones" | Fixed in Phase 4D: aggregates the **complete** RLS-visible set, counts only active reports, reports "Unavailable" on truncation | Unchanged (correct) |
| "All Active (N)" filter tab | **Counted only the rows on the current page** — on the dashboard that is 5, so a truncated page was presented as a complete total | **Now uses the authoritative server-side `totalCount`**, and the dashboard adds *"Showing the 5 most recent of N reports visible to your role."* |

### 5.3 Failure states are now distinguishable from empty states

| Situation | Before | After |
| --- | --- | --- |
| KPI query failed | `0` on every card | **"Unavailable"** on every card |
| Queue query failed | friendly empty state ("No work orders currently assigned") | **"Report data could not be loaded"** + the sanitized error + "This is a database query failure, not an empty result" + Retry |
| Detail query failed | "Report Not Found" | **"Report Data Unavailable"** + "This is not a statement that the report does not exist" |
| Genuinely empty result | empty state | empty state (unchanged) — and it now only appears when the query actually succeeded |
| Dataset truncated | partial numbers published | refusal to publish + explicit error (already in place from Phase 4D) |

### 5.4 No fabricated values remain

Re-verified across the whole functional UI (`app/`, `components/`, `utils/`): no mock
technician identities, no hardcoded SLA percentages, no demo records, no fake weekly-resolution
figures. The only "Technicians On Duty" and "Resolution SLA" widgets are honest
unimplemented-state cards.

---

## 6. Verification Status — Local vs Authorized Remote

### 6.1 Verified locally

| Behaviour | Evidence |
| --- | --- |
| The 42702 error is a PostgreSQL `ambiguous_column` raised inside the policy helper | Server log with the PostgREST error code `42702`; static analysis of the migration set |
| The repair removes the ambiguity | Statement-scoped static detector: the effective definition has zero ambiguous references; the historical definition still has exactly one (proving the detector is not silently broken) |
| The repair does not broaden access | Executable access-matrix model + SQL-level anti-broadening assertions (no `a.report_id = a.report_id`; exactly three branches) |
| The repair is additive and preserves privileges | Automated scan of the executable migration SQL; assertions on `SECURITY DEFINER`, `STABLE`, `search_path`, `REVOKE`, `GRANT` and the signature |
| The migration is structurally valid PL/pgSQL | Balanced dollar quoting, directive placement, block structure, declaration-before-use — all automated |
| A failed query is never shown as an empty result | Source assertions on the list, the KPI cards, the dashboard and the detail page |
| KPI mapping matches the UI filters | Byte-level assertion of each status set in both places |
| The application still builds and serves | `tsc` 0 errors, `eslint` 0/0, `next build` succeeds, 9/9 routes PASS, headless Chrome: 0 console errors, 0 exceptions |
| The unit suite | 176 tests, 174 pass, 2 pre-existing failures |

### 6.2 NOT verified against the remote environment

| Behaviour | Blocker |
| --- | --- |
| The repaired function actually stops raising 42702 in PostgreSQL | **Migration 008 is prepared but not applied.** Applying it requires explicit owner authorization and the remote DB password. |
| A technician sees exactly their assigned work orders on the live dashboard | Requires the applied migration **and** an authenticated technician session |
| A technician cannot read an unassigned report on the live system | Same |
| A student sees exactly their own reports on the live dashboard | Same |
| A coordinator retains full visibility | Same |
| A live report submission appears for its authorized owner | Requires an authorized session; no remote records were created |
| Unauthorized reports remain inaccessible on the live system | Same |

**No remote write, insert, update, delete, truncate, seed, RPC invocation, or migration
application was performed in this phase.** All remote observations were read-only, and the
authenticated requests visible in the server logs were produced by another session's browser,
not by this phase.

---

## 7. Remaining Database-Side Blocker

### 7.1 The blocker

**`public.can_view_report()` still raises PostgreSQL `42702` in the remote database**, because
migration `20261021000008_fix_can_view_report_parameter_ambiguity.sql` has been **prepared and
locally validated but deliberately not applied**. Until it is applied with owner authorization,
every `SELECT` on `public.reports` continues to fail for `student_personnel` and `technician`,
and the dependent `report_attachments`, `report_status_history`, `report_comments`,
`verifications` and `storage.objects` policies remain unusable for those roles.

### 7.2 The exact remedy

```powershell
# Owner-authorized, in the linked project:
npx supabase db push --dry-run   # must list exactly 20261021000008_fix_can_view_report_parameter_ambiguity.sql
npx supabase db push
```

Then verify with `pg_get_functiondef('public.can_view_report(uuid)'::regprocedure)` and by
signing in as each of the five test roles. The full command list, prerequisites and rollback
procedure are in `docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md` §5.

### 7.3 Other outstanding database-side items (not introduced here, not fixed here)

| Item | State |
| --- | --- |
| `20261020000007_notification_lifecycle_rpcs.sql` | Never authored; never applied (`notification_command_receipts` → HTTP 404 / `PGRST205`). The two failing tests are its specification. The application is honest about it — the notification bell is disabled and labelled. |
| Real-time technician presence | No schema support. The dashboard states this instead of inventing a number. |
| SLA / response-time tracking | No response-deadline column. The dashboard states this. |
| Server-side idempotency for report creation | Would require a schema change; the client-side single-flight guard prevents double submissions from the UI. |
| Schema drift guard for the remote project | The remote has migrations 001–006 applied; 007 and 008 are pending. A `supabase migration list` reconciliation is recommended after the owner authorizes the pushes. |

### 7.4 What is *not* a blocker

- The Phase 4D server-action loader error is fully resolved and independently verified
  (Next.js's own `ensureServerEntryExports()` guard, the production manifest, a fresh
  production server, and headless Chrome).
- The application now degrades honestly while the database defect is outstanding: no fabricated
  metrics, no false empty queues, no misleading authorization answers.
