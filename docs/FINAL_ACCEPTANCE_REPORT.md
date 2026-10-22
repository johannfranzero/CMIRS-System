# CMIRS — Final Acceptance Report

**Project:** Campus Maintenance & Incident Reporting System
**Project root:** `D:\CMIRS-System\my-app`
**Date:** 2026-10-21
**Baseline:** `d2a3e1d` (`origin/main`) · **Branch:** `main`, 3 commits ahead of `origin/main`, nothing pushed

---

## 1. Final Acceptance Decision

> ## PARTIALLY COMPLETE
>
> Every functional workflow is implemented, every defect with a confirmed root cause has been
> repaired, and every database behaviour has been **verified against the live Supabase project**
> (79/79 remote checks across three role-simulation harnesses, all rolled back). The
> application builds cleanly, type-checks cleanly, lints cleanly, and **189/189 unit tests pass**.
>
> The system is **not** labelled COMPLETE because the acceptance criteria for a fully
> authenticated end-to-end walkthrough require an authorized session that is not available in
> this environment, and because account **invitation** (creating a new Supabase Auth user)
> requires the service-role key, which is deliberately absent. Both are documented below with
> the exact external steps required. Everything else is verified, not assumed.

---

## 2. Requirements Coverage Matrix

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | **Authentication** — session-based sign-in, server-verified profile | **PASS** | `proxy.ts` refreshes the session on every request; `getCurrentUserAndProfile()` derives the identity from `supabase.auth.getUser()`; 9/9 routes redirect unauthenticated requests to `/login` |
| 2 | **Role access** — five canonical roles with distinct capabilities | **PASS** | 25/25 remote RLS checks across administrator, coordinator, technician, student_personnel, management, an unrelated authenticated user, and `anon` |
| 3 | **Report submission** — validated, persisted, retrievable | **PASS** | 42/42 remote lifecycle checks; server-side validation; 189 unit tests |
| 4 | **Report visibility / RLS** — role-scoped reads | **PASS** | 25/25 remote RLS checks; the 42702 defect that broke students and technicians is repaired and applied |
| 5 | **Technician account provisioning** | **BLOCKED** | The directory, the real auth-linkage status, and administrator account management are **PASS**. Creating a new Supabase Auth user requires the service-role key, which is absent — documented in `docs/DEPLOYMENT_READINESS.md` §6 |
| 6 | **Coordinator assignment** — assign, reassign, history | **PASS** | 42/42 remote checks, including the P-05 no-op rejection and the atomic assignment |
| 7 | **Technician progress and completion** — start, hold, complete | **PASS** | 42/42 remote checks; the assignment follows the report state |
| 8 | **Coordinator verification and closure** | **PASS** | 42/42 remote checks; separation of duties enforced; `verified_at`/`verified_by` recorded |
| 9 | **Attachments** — upload, registration, partial failure | **PARTIALLY COMPLETE** | The upload path, MIME/size limits, the 5-per-report cap and the "no duplicate report" failure handling are **PASS** in code and unit tests. A live bucket upload is **UNVERIFIED** (no authorized session) |
| 10 | **Locations and reference data** | **PASS** | Live, RLS-scoped, with honest empty/unavailable states; the silent fixture fallback is gone |
| 11 | **Analytics accuracy** | **PASS** | The KPI status sets are byte-identical to the UI filters (asserted by a test); the facility breakdown aggregates the complete authorized set and refuses to publish a truncated count |
| 12 | **Notification lifecycle** | **PASS** | 42/42 remote checks; genuine persisted, recipient-scoped, read/unread state, real unread count; migration 007 applied |
| 13 | **Responsive UI and accessibility** | **PASS (reviewed, not device-tested)** | The existing design system and Tailwind conventions are preserved; labelled controls, `aria-live` result counts, `aria-expanded` disclosure, focus-visible rings, mobile navigation and mobile-safe forms. No physical device test was performed |
| 14 | **Automated tests** | **PASS** | 189/189 unit tests; 79/79 remote database checks; 9/9 route probes; 0 console errors in headless Chrome |
| 15 | **Production build** | **PASS** | `✓ Compiled successfully in 9.3s`, 13/13 static pages |
| 16 | **Deployment readiness** | **PASS (documented, not deployed)** | `docs/DEPLOYMENT_READINESS.md` — environment variables, migration order, storage bucket, redirect configuration, recovery steps |

---

## 3. Completed Features

| Area | What is now implemented |
| --- | --- |
| **Dashboards** | Five role-specific dashboards, every KPI derived from RLS-scoped records, with unavailable states instead of zeros when a query fails |
| **Report submission** | Server-side validation, trigger-generated tracking numbers, idempotent retries, accurate error classification, genuine success semantics, attachment upload with per-file failure handling |
| **Report queue & detail** | Live, paginated, searchable, filterable; status history, work logs, verification records and attachments rendered from real rows |
| **Assignment lifecycle** | Coordinator triage → assignment/reassignment → technician start/hold/complete → coordinator verification/rework, each step atomic and each step delivering its notifications |
| **Account management** | Real user directory with an auth-linkage status per account; administrator role and activation management with an audit trail |
| **Notifications** | Persisted inbox, recipient-scoped reads, read/unread persistence, a real unread badge, per-report links, honest empty and error states |
| **Analytics** | Operational analytics for oversight roles, derived from the complete authorized dataset |
| **Locations** | Live campus location directory with the completeness guard |
| **Settings** | Administrator account directory, account-state management, and the role-change audit history |

---

## 4. Exact Root Causes of the Resolved Defects

| Defect | Root cause | Fix | Status |
| --- | --- | --- | --- |
| Report submission impossible | `actions/reports.ts` exported a plain object (`INITIAL_ACTION_STATE`) from a file-level `'use server'` module; Next.js's `ensureServerEntryExports()` throws `A "use server" file can only export async functions, found object.` while the route module is evaluated | Moved the constant to `utils/reports/action-state.ts` | **Fixed and verified** |
| Report submission crashed with "Body exceeded 1 MB limit" | The photo picker was a file control **inside** the report form, so the selected image bytes were posted with the report-submission Server Action; the framework's default Server Action body limit is 1 MB. A **second, independent** limit existed in the proxy: Next.js buffers the request body whenever a proxy is configured and **truncates** it above 10 MB — exactly the per-attachment cap — so a legitimate 10 MB photo was corrupted even after the action limit was raised | The photo picker was moved **outside** the report form (the files are already uploaded separately, one per request). `experimental.serverActions.bodySizeLimit` **and** `experimental.proxyClientMaxBodySize` were both raised to 12 MB. Verified empirically: an 11.58 MB body is received and parsed intact, a 13.59 MB body is truncated | **Fixed and verified** |
| Student/technician dashboards empty | `public.can_view_report(report_id UUID)` referenced its parameter inside a query over `public.assignments`, which owns a `report_id` column → PostgreSQL **42702 `ambiguous_column`** | Migration 008: collision-free local + `#variable_conflict use_variable`; signature, attributes and privileges preserved | **Fixed, applied, verified** |
| "Live Backend Connected" banner | The banner asserted a verified backend state the server component cannot prove | Removed from the dashboard **and** the report queue; not replaced | **Fixed** |
| Fabricated technicians / 94.2% SLA / 15 weekly resolutions | Phase 1 fixture module `data/mock-reports.ts` | Deleted; zero fabrications remain in any runtime module | **Fixed** |
| Reference catalogs served demo rows | `getActiveCategories()` / `getActiveLocations()` / `getActiveTechnicians()` returned fixtures on error **or** zero rows | Fail honestly; honest unavailable states | **Fixed** |
| Database failure shown as an empty queue / zero KPIs | `ReportList` and `StatCard` had no error input | Explicit error states; "Unavailable" instead of `0` | **Fixed** |
| Facility counts described one page | Derived from the 5 most recent queue rows | Full authorized-set aggregation with a truncation guard | **Fixed** |
| Notifications did not exist | Migration 007 was never authored nor applied | Authored, applied, integrated, verified | **Fixed** |
| `anon` could execute every new function | Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE to `anon` for new functions; `REVOKE … FROM PUBLIC` does not remove it | Migration 011 revokes the `anon` privilege from every project function | **Fixed and verified** |
| Technician account directory could not distinguish a working account | The directory showed `profiles` rows only | `profile_has_auth_account` + a bulk status function; the UI shows Confirmed / No login account / Unknown | **Fixed** |
| Administrators could not manage accounts | The settings page was read-only | `admin_update_profile_operational_state` + an administrator UI with an audit trail | **Fixed** |

---

## 5. Files Created and Modified

**Migrations (5, all applied):** `20261020000007_notification_lifecycle_rpcs.sql` ·
`20261021000008_fix_can_view_report_parameter_ambiguity.sql` ·
`20261021000009_technician_account_management.sql` ·
`20261021000010_bulk_auth_account_status.sql` ·
`20261021000011_revoke_anon_execute_privileges.sql`

**New application modules (12):** `utils/reports/action-state.ts` · `utils/reports/lifecycle-rpc.ts` ·
`utils/reports/reference-catalogs.ts` · `utils/reports/dashboard-config.ts` ·
`utils/notifications/dal.ts` · `utils/notifications/runtime.ts` · `actions/notifications.ts` ·
`actions/accounts.ts` · `types/notifications.ts` · `app/notifications/page.tsx` ·
`components/notifications/notification-inbox.tsx` · `utils/reports/mutations.ts` (rewritten)

**Modified application modules (23):** `actions/reports.ts` · `app/page.tsx` · `app/reports/page.tsx` ·
`app/reports/[id]/page.tsx` · `app/settings/page.tsx` · `components/dashboard/report-list.tsx` ·
`components/layout/app-shell.tsx` · `components/layout/app-shell-client.tsx` ·
`components/layout/header.tsx` · `components/reports/report-action-panel.tsx` ·
`components/reports/report-submission-form.tsx` · `components/settings/user-directory.tsx` ·
`components/ui/stat-card.tsx` · `config/navigation.ts` · `types/settings.ts` ·
`utils/reports/analytics-runtime.ts` · `utils/reports/dal.ts` · `utils/reports/transform.ts` ·
`utils/settings/runtime.ts` · `utils/settings/transform.ts` · `app/settings/page.tsx` ·
`types/notifications.ts`

**Deleted (2):** `data/mock-reports.ts` · `utils/reports/mock-filter.ts`

**New test files (3):** `tests/unit/sql-function-parameter-ambiguity.test.mjs` (7) ·
`tests/unit/role-visibility-model.test.mjs` (9) · `tests/unit/phase-4c-notifications.test.mjs` (9)

**Updated test files (4):** `tests/unit/report-actions.test.mjs` · `tests/unit/mutation-dal.test.mjs` ·
`tests/unit/phase-4d-real-data-audit.test.mjs` · `tests/unit/settings.test.mjs`

**New verification tooling (10):** `scripts/verify-supabase-connectivity.mjs` ·
`scripts/verify-server-action-exports.mjs` · `scripts/probe-local-routes.mjs` ·
`scripts/verify-in-browser.mjs` · `scripts/next-headers-resolve-hook.mjs` ·
`scripts/remote-rls-verification.sql` · `scripts/remote-notification-lifecycle-verification.sql` ·
`scripts/remote-account-management-verification.sql` · `scripts/remote-inventory.sql` ·
`scripts/probe-role-simulation.sql`

---

## 6. Database Migrations — Status

| Version | File | Status |
| --- | --- | --- |
| `20261018000001`–`20261018000006` | core schema, indexes, triggers, security functions, RLS policies, storage | Applied (pre-existing) |
| `20261020000007` | `notification_lifecycle_rpcs.sql` | **Applied** — verified by 2/2 contract tests and 42/42 lifecycle checks |
| `20261021000008` | `fix_can_view_report_parameter_ambiguity.sql` | **Applied** — verified by 25/25 RLS checks |
| `20261021000009` | `technician_account_management.sql` | **Applied** — verified by 12/12 account-management checks |
| `20261021000010` | `bulk_auth_account_status.sql` | **Applied** — verified by AM-01…AM-03 |
| `20261021000011` | `revoke_anon_execute_privileges.sql` | **Applied** — verified by AM-11, AM-12 |

**Migration order matters:** 007 was authored before 008 but applied after it, so it was pushed
with `--include-all`. It is additive and independent of 008, and the applied ledger now shows a
consistent 001 → 011 sequence.

---

## 7. Security and RLS Findings

| Area | Finding | Resolution |
| --- | --- | --- |
| `SECURITY DEFINER` functions | Seven new privileged functions | All have a fixed `search_path = public, auth, pg_temp`, derive the actor from `auth.uid()` only, and re-check the role and state internally |
| `search_path` mutability | Every new function pins it | Verified in the contract tests |
| `anon` EXECUTE on new functions | **Supabase's default privileges granted it** | Migration 011 revokes it; verified (`permission denied for function …`) |
| Generic notification writes | Possible before migration 007 | `REVOKE INSERT, DELETE ON public.notifications FROM authenticated` |
| Command receipt exposure | Possible before migration 007 | `REVOKE ALL … FROM anon, authenticated` |
| Service-role key in browser code | **None** | The repository references only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Privilege escalation | Administrators cannot alter their own account; non-administrators are refused; a role change requires a reason and is audited | AM-04, AM-05, AM-06, AM-08 |
| Report visibility broadening | The repair restores the intended comparison instead of the self-comparison | 25/25 RLS checks; a source-level test asserts `a.report_id = a.report_id` is absent |
| Duplicate submissions | Possible via a double click or a retry | A client single-flight lock **and** server-side idempotency through the command receipts; N-09…N-12 |
| Error leakage | Raw SQL could reach the browser | A fixed allow-list classifier; a test asserts no SQL, table or constraint name leaks |
| Dynamic SQL | None in the application | — |

---

## 8. Test Commands and Actual Results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **Success** — `✓ Compiled successfully in 9.3s`, `✓ Generating static pages … (13/13)` |
| `node --test tests/unit/*.test.mjs` | **189 tests · 189 pass · 0 fail** |
| `npx supabase db query --linked --file scripts/remote-rls-verification.sql` | **25/25 PASS** |
| `npx supabase db query --linked --file scripts/remote-notification-lifecycle-verification.sql` | **42/42 PASS** |
| `npx supabase db query --linked --file scripts/remote-account-management-verification.sql` | **12/12 PASS** |
| `node scripts/probe-local-routes.mjs http://localhost:3102` | **9/9 PASS** — no server-action loader error |
| `node scripts/verify-in-browser.mjs http://localhost:3102 …` | **0 console errors, 0 page exceptions** on every route |
| `node scripts/verify-server-action-exports.mjs` | **PASS** — Next.js's own guard accepts all 10 exports |
| `node scripts/verify-supabase-connectivity.mjs` | **PASS** — configuration, client init, DAL table targets |
| `node scripts/verify-server-action-body-limit.mjs` | **PASS** — an 11.58 MB body is received and parsed intact; a 13.59 MB body is truncated, proving the 12 MB threshold is in force |

**Suite progression:** baseline 137/133/4 → 163/161/2 → 176/174/2 → **189/189/0**.

---

## 9. Local vs Remote Verification Status

### 9.1 Verified locally
The whole application path against mocked Supabase clients (189 unit tests); the visibility
model as an executable matrix; the SQL defect class with a static detector; the Next.js
server-action export invariant; the production build; the type check; the lint; the route
responses and the browser console.

### 9.2 Verified against the remote
Every database behaviour, using a **role simulation** that switches to the real `authenticated`
(or `anon`) role with a simulated JWT inside a transaction that is **always rolled back**:
visibility per role (25), the complete report lifecycle with notifications and idempotency (42),
and account management with the audit trail (12).

### 9.3 Not verified
| Behaviour | Blocker |
| --- | --- |
| A live submission creating a persistent report row | No authorized session; creating remote test records is out of scope |
| A live attachment upload | Same |
| The authenticated UI rendering real data in a browser | Same |
| A live notification surviving a session | Same |
| A live role change committed to the remote | The harness proves the command; the transaction is rolled back by design |
| Physical-device responsive testing | No device available |

---

## 10. Remaining Blockers and Required Owner Actions

| # | Blocker | Required owner action |
| --- | --- | --- |
| 1 | **No authorized authenticated session.** The five Gate E.3 accounts exist but no password is documented anywhere (by deliberate design), and no account was created. | Supply the credentials for one existing test account (through a secret channel, never in chat or in source) and re-run `scripts/verify-in-browser.mjs` and the three remote harnesses with a live session to close the 9.3 items. |
| 2 | **Auth account invitation.** Creating a Supabase Auth user requires the service-role key, which is absent from the project environment and which this task forbids introducing. | Set `SUPABASE_SERVICE_ROLE_KEY` in the deployment environment **if** an invitation endpoint is added, and complete the invitation flow described in `docs/DEPLOYMENT_READINESS.md` §6. Until then, accounts are created in the Supabase dashboard and appear in the administrator directory immediately, with the linkage status confirming them. |
| 3 | **Live attachment upload** is unverified. | Sign in with an authorized account and upload one image to the `report-attachments` bucket. |
| 4 | **Real-time technician presence and SLA tracking** are unimplemented because the schema has no presence or response-deadline data. | None required — both widgets state the limitation honestly. Implementing them needs a schema change and a fresh approved design. |
| 5 | **The direct authenticated lifecycle policies remain** (approved decision S-06 / I-02). | After every legitimate writer has been converted and verified, a separate gated release may revoke them. Not a functional gap: the application uses the command RPCs exclusively. |
| 6 | **Git.** The branch is 3 commits ahead of `origin/main` and **nothing has been pushed**. The Phase 4E/4F work is uncommitted. | Review and commit the working tree, then push. This task was instructed not to commit, push, deploy, amend or rewrite history, and no such operation was performed. |
| 7 | **Migration 007 was applied out of order** (it sorts before the already-applied 008 and was pushed with `--include-all`). | No action required — the migrations are additive and independent. The applied ledger now reads 001 → 011. |
| 8 | **Physical-device responsive testing** was not performed. | A short manual pass on a phone and a tablet. |

---

## 11. Related Documents

| Document | Contents |
| --- | --- |
| `docs/frontend/PHASE_4D_COMPLETION_REPORT.md` | The real-data completion summary |
| `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md` | Connectivity, banner removal, remote verification evidence |
| `docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md` | The `can_view_report` repair in detail |
| `docs/frontend/PHASE_4D_2_TECHNICIAN_VISIBILITY_FIX_REPORT.md` | Technician visibility and KPI accuracy |
| `docs/frontend/PHASE_4E_TECHNICIAN_WORKFLOW_REPORT.md` | Technician account management and the work-order lifecycle |
| `docs/frontend/PHASE_4F_NOTIFICATIONS_COMPLETION_REPORT.md` | The notification lifecycle completion |
| `docs/DEPLOYMENT_READINESS.md` | Deployment preparation and the owner's steps |
