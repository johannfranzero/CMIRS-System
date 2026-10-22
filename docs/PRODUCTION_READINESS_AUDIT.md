# CMIRS — Production Readiness Audit

**Project:** Campus Maintenance & Incident Reporting System
**Project root:** `D:\CMIRS-System\my-app`
**Audit date:** 2026-10-22
**Auditor scope:** Full application audit — authentication, RBAC, report lifecycle, technician
workflow, notifications, analytics, database schema/RLS/Storage, production configuration and
deployment readiness.
**Target stack:** Next.js 16.4.2 (App Router, Turbopack, `proxy.ts` perimeter) · React 19.3.0 ·
TypeScript 5 · Tailwind CSS 4 · Supabase Auth + PostgreSQL + Row Level Security + Storage.

---

## 1. Executive summary and overall status

> ## Overall status: **READY AFTER REQUIRED FIXES**
>
> **This is not "READY FOR DEPLOYMENT".** Three blocking defects were confirmed against the
> **live** production Supabase project and the **built** application bundle during this audit.
> Each has a concrete, already-prepared remediation, but two of the three require an owner
> action that cannot be performed from the repository.

### What the previous verification round missed

The repository already contained a `docs/FINAL_ACCEPTANCE_REPORT.md` (2026-10-21) and a
`docs/DEPLOYMENT_READINESS.md` that declared the system "prepared and verified". This audit
re-derived the guarantees from the live database and the built bundle instead of trusting those
documents, and found that **several of their claims were false**:

| Previous claim | Reality on 2026-10-22 | Evidence |
|---|---|---|
| "Every migration in the repository is applied; there is no pending migration." | **False.** Migrations `…012`, `…013`, `…014` are **PENDING**. | `npx supabase migration list --linked` |
| The report-submission role restriction is enforced "at the database layer". | **False.** The `reports_insert` RLS policy has no role restriction, and the SECURITY DEFINER command performs no reporter-role check. | `pg_policies` + `pg_get_functiondef` on the live project |
| `scripts/verify-server-action-exports.mjs` reports the server-action export rule is enforced. | **Vacuous.** The script passed the module *namespace object* to `ensureServerEntryExports()`, which iterates an **array**; the loop never ran, so every module "passed". | `node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js` |
| `/reports/new` is available to "all five" roles. | **False.** Only Student/Personnel and Coordinator may file a report (PD-R6). | `app/reports/new/page.tsx`, `types/auth.ts` |
| "None of them alter an existing table, column, index, trigger, policy or role." | **False.** Migrations 007/011/014/015 do exactly that. | migration SQL |
| The README describes "a default Next.js starter scaffold" with "no application features". | **False.** The application is complete; the README was stale. | `README.md` (corrected) |

### The three deployment blockers

| # | Blocker | Severity | Status after this audit |
|---|---|---|---|
| **B-1** | **Public self-registration is enabled on the live hosted Supabase project.** `GET /auth/v1/settings` reports `"disable_signup": false`. The `handle_new_user` trigger grants every self-registered account the `student_personnel` role and creates a `public.profiles` row. | **HIGH** | **Owner action required** — documented in §10.1. The repository-side posture is now aligned (`supabase/config.toml` declares `enable_signup = false`). |
| **B-2** | **The report-submission role restriction is enforced only in the application layer.** Any authenticated session (technician, administrator, management) can create a report by calling `public.submit_report_with_notifications(...)` or by POSTing to `/rest/v1/reports`, because the live `reports_insert` policy has no role restriction and the SECURITY DEFINER command performs no role check. | **HIGH** | **Migration `…015` prepared locally, NOT applied.** Owner authorization required (§8.2). |
| **B-3** | **`public.soft_delete_attachment(UUID)` is executable by the unauthenticated `anon` role, and its only authorization check fails open** (`IF caller_role != 'coordinator'` evaluates to NULL, and `IF NULL` is false in PL/pgSQL). | **HIGH** | **Migration `…015` prepared locally, NOT applied.** Owner authorization required (§8.2). |

### What was fixed locally in this audit

| Area | Fix |
|---|---|
| Test-only login UI | The "Authorized Test Personas (Stage 2.1 QA)" panel and the test-account autofill were removed from the production-facing login page and isolated behind a development-only switch that **cannot** be enabled in a production build. Regression test added. |
| Server Action exports | **CRITICAL** — `actions/accounts.ts` and `actions/notifications.ts` exported plain objects from file-level `'use server'` modules. Next.js's own runtime guard throws `A "use server" file can only export async functions, found object.` for both, which would have broken `/settings` and `/notifications` at runtime. Fixed and proven with Next's own guard. |
| Open redirect | `sanitizeRedirectUrl` accepted `/\t/evil.com`; the WHATWG URL parser strips the tab, so the value resolved to `https://evil.com/`. Now rejected, with a proof-of-origin probe. |
| Security headers | None existed. CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` are now applied to every response. |
| False "zero" states | A failed query published "0 Reports Registered" and "You currently have no active maintenance requests". Both now state that the value is unavailable. |
| Error boundaries | `app/error.tsx`, `app/global-error.tsx` and `app/not-found.tsx` added. |
| Broken test harnesses | The integration safety suite could not execute at all (import resolution). Fixed; 42/42 pass. |
| Verification tooling | The server-action export verifier actually invoked Next's guard correctly; a production-bundle scanner and a live readiness probe were added. |
| Documentation | `README.md`, `docs/DEPLOYMENT_READINESS.md` and `docs/ROLES.md` corrected where they contradicted the code. |

### Honest statement of what could not be verified

**No authenticated end-to-end browser walkthrough was performed for any role.** No test-account
passwords or session tokens were available to this audit, and the task correctly forbids asking
for them. Every authenticated workflow in §4 is therefore marked **UNVERIFIED** or **BLOCKED**,
not PASS. The database-layer halves of those workflows *were* verified with live, read-only
harnesses against the real project; the application-layer halves were verified by code review
and by Next.js's own runtime guards, not by execution.

---

## 2. Modules audited and evidence inspected

| # | Module | Files inspected | Primary evidence |
|---|---|---|---|
| 1 | Authentication, session, account provisioning | `proxy.ts`, `actions/auth.ts`, `utils/auth/{server,validation,user,dev-tools}.ts`, `utils/supabase/{server,client}.ts`, `app/login/page.tsx`, `components/auth/**` | `GET /auth/v1/settings` on the live project; route probe; browser verification |
| 2 | RBAC for the five roles | `config/navigation.ts`, `types/auth.ts`, `utils/auth/server.ts`, every `actions/*.ts`, all route pages | `pg_policies` inventory; `pg_proc` privilege inventory; Next.js runtime guards |
| 3 | Report submission, validation, attachments, detail | `actions/reports.ts`, `utils/reports/{validation,mutations,transform,storage}.ts`, `utils/storage/server.ts`, `app/reports/**` | Live RLS harness (25 assertions); storage policy inventory |
| 4 | Technician assignment and ownership | `assign_or_reassign_report_with_notifications` (live definition), `utils/reports/mutations.ts` | Live function definition; live RLS harness |
| 5 | Technician work progress / completion / further repair | `transition_report_status_with_notifications`, `verify_report_with_notifications`, `work_logs` policies | Live function definitions; live notification-lifecycle harness (42 assertions) |
| 6 | Coordinator verification and resolution | `verify_report_with_notifications` (live definition) | Live function definition — separation-of-duties clauses verified |
| 7 | Notifications, unread counts, read persistence | `actions/notifications.ts`, `utils/notifications/{dal,runtime}.ts`, `components/notifications/notification-inbox.tsx` | Live notification-lifecycle harness (42 assertions); `notifications_*` policies |
| 8 | Locations, categories, dashboards, analytics | `app/{locations,analytics,page.tsx}`, `utils/locations/directory.ts`, `utils/reports/{dal,dashboard-config,analytics-runtime}.ts` | Live table contents; source review for fabricated metrics |
| 9 | User management, technician linkage, activation | `actions/accounts.ts`, `utils/settings/**`, `components/settings/**`, migrations 009/010 | Live account-management harness (12 assertions); live privilege inventory |
| 10 | Settings, audit trail, pagination, filtering, states | `utils/settings/{runtime,transform,dal}.ts`, `app/settings/page.tsx` | Live `role_change_audit` policy review; source review of every error/empty branch |
| 11 | Schema, migrations, RLS, Storage, privileges | All 15 files in `supabase/migrations/`, `supabase/config.toml`, `supabase/seed.sql`, `supabase/tests/**` | `scripts/remote-production-readiness-probe*.sql` (read-only, live); `supabase migration list --linked` |
| 12 | Responsive UI, accessibility, production configuration | `next.config.ts`, `app/globals.css`, `components/layout/**`, `components/ui/**` | Response-header inspection of the running production server; headless-browser check |

### Evidence classes used

| Class | Meaning |
|---|---|
| **LIVE** | Executed against the real hosted Supabase project or the real production build. |
| **CODE** | Established by reading the implementation and the framework's own source. |
| **DOC** | Established by reconciling the documentation against the code. |
| **UNVERIFIED** | Could not be established with the access available to this audit. |

---

## 3. Test commands and actual results

Every result below was produced by running the command in this repository on 2026-10-22.

### 3.1 Local gates

| Command | Actual result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS — 0 errors** |
| `npm run lint` (`eslint`) | **PASS — 0 errors, 0 warnings** |
| `npm test` (`node --test tests/unit/*.test.mjs`) | **PASS — 238 tests, 238 passed, 0 failed** (223 before this audit; +13 new login-production tests, +2 rewritten validation tests) |
| `node tests/integration/rls-runner-safety.test.ts` | **PASS — 42 tests, 42 passed, 0 failed** (could not execute at all before this audit) |
| `npm run build` | **PASS** — `✓ Compiled successfully`, `✓ Generating static pages (13/13)` |
| `npm run verify:bundle` | **PASS** — no test address, no QA persona panel and no secret in `.next/static` |
| `node --import ./scripts/register-next-subpath-hook.mjs scripts/verify-server-action-exports.mjs` | **PASS — 4/4 `'use server'` modules accepted by Next.js's own `ensureServerEntryExports()`** (2 modules failed before the fix) |
| `node scripts/probe-local-routes.mjs http://localhost:3100` | **PASS — 9/9 routes**; every protected route 307-redirects to `/login?next=…`; no server-action loader error |
| `node scripts/verify-in-browser.mjs http://localhost:3100 /login,/reports/new` | **PASS — 0 console errors, 0 page exceptions**; the QA persona panel text is **absent** from the rendered login page |
| Response-header inspection of the running production server | **PASS** — CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` present; `X-Powered-By` removed |
| **Positive control** — the same login page under `next dev` with `CMIRS_ENABLE_TEST_PERSONAS=true` | **PASS — the QA persona panel and the test addresses ARE rendered.** The switch is therefore proven to work in both directions: available for local QA in development, absent from every production artifact. |

### 3.2 Live database gates (read-only; every harness rolls back)

| Command | Actual result |
|---|---|
| `npx supabase migration list --linked` | **11 applied · 4 PENDING** (`…012`, `…013`, `…014`, `…015`) |
| `npx supabase db query --linked --file scripts/remote-rls-verification.sql` | **PASS — 25/25 assertions** |
| `npx supabase db query --linked --file scripts/remote-notification-lifecycle-verification.sql` | **PASS — 42/42 assertions** |
| `npx supabase db query --linked --file scripts/remote-account-management-verification.sql` | **PASS — 12/12 assertions** |
| `npx supabase db query --linked --file scripts/remote-production-readiness-probe.sql` | **Executed** — schema/RLS/privilege/storage/trigger/account/data-volume inventory collected |
| `GET <project-url>/auth/v1/settings` | **Executed** — `"disable_signup": false` → blocker **B-1** |

**Total live database assertions passed: 79/79.** The three harnesses and the readiness probe
run inside a transaction that is always rolled back; they never write to the remote project.

### 3.3 Migration consistency

| Check | Result |
|---|---|
| 15 migration files, sequential and non-conflicting timestamps | **PASS** |
| Any `DROP TABLE` / `TRUNCATE` / `DELETE FROM` | **None** — no migration destroys data |
| Any migration that reseeds or overwrites existing rows | **None** in the migration set. `supabase/seed.sql` does `ON CONFLICT … DO UPDATE` (which resets `is_active` on the five seeded categories/locations) — see F-16. |
| Forward-reference that would break a fresh `supabase db push` | **None found** — each migration's dependencies are created earlier in filename order |
| Would a fresh `db push` succeed? | **Yes**, but it would apply 012–015, two of which change production authorization behaviour. `db push` must not be run unattended. |

### 3.4 Live data inventory (counts only — no identifiers disclosed)

| Object | Count |
|---|---|
| `auth.users` / `public.profiles` / confirmed auth accounts | 5 / 5 / 5 |
| Profiles with a non-canonical role | 0 |
| `public.reports` | 5 (4 `submitted`, 1 `assigned`) |
| `public.assignments` | 1 |
| `public.work_logs` | 0 |
| `public.verifications` | 0 |
| `public.notifications` | 5 |
| `public.report_attachments` | 0 |
| `public.report_status_history` | 1 |
| `public.role_change_audit` | 0 |

> The live dataset is **Phase-4G/4H QA residue**, not production data. All five reports were
> filed by the technician account as a test shortcut, which is itself evidence for blocker
> **B-2**. There is no attachment, work-log or verification row in the database, so the
> attachment, work-progress and verification paths have **no live data exercising them**.

---

## 4. Workflow results — PASS / FAIL / BLOCKED / UNVERIFIED

**Legend.** *DB-layer* = verified against the live database. *App-layer* = verified by code
review and framework runtime guards. *Execution* = verified by actually running the workflow.

| # | Workflow | DB-layer | App-layer | Execution | Overall |
|---|---|---|---|---|---|
| W1 | **Student/Personnel submits a report** | **FAIL** — the live `reports_insert` policy accepts any authenticated role, and the command performs no role check (**B-2**) | PASS — `canSubmitReport()` in `actions/reports.ts` and the `/reports/new` route | **UNVERIFIED** — no session | **FAIL (blocking)** |
| W2 | **Coordinator reviews and assigns a real technician** | **PASS** — `assign_or_reassign_report_with_notifications` requires `v_role = 'coordinator'`, requires an active technician, and is atomic | PASS — role check in the action + `requireRole` | **UNVERIFIED** — no session | **PASS (DB + code); execution UNVERIFIED** |
| W3 | **Assigned technician accesses the work order, starts work, submits completion or further-repair** | **PASS** — `transition_report_status_with_notifications` restricts technicians to `start`/`hold`/`complete` on their own assignment; `work_logs` insert is ownership-scoped | PASS — role + ownership checks in the action and the DAL | **UNVERIFIED** — no session, and `work_logs` is empty in the live database | **PASS (DB + code); execution UNVERIFIED** |
| W4 | **Coordinator verifies the repair before the report becomes resolved** | **PASS** — `verify_report_with_notifications` requires `coordinator`, requires status `completed`, forbids a reporter verifying their own report, and forbids the assigned technician verifying their own repair | PASS — role check in the action | **UNVERIFIED** — no session, `verifications` is empty | **PASS (DB + code); execution UNVERIFIED** |
| W5 | **Administrator manages accounts without exposing privileged credentials** | **PASS** — `admin_update_profile_operational_state` requires `administrator`, forbids self-modification, requires a ≥5-character reason, and writes the audit row in the same transaction | PASS — `requireRole(['administrator'])`; no service key, hash or raw SQL error reaches the browser | **UNVERIFIED** — no session | **PASS (DB + code); execution UNVERIFIED** |
| W6 | **Management accesses only its authorized oversight functions** | **PASS** — management is read-only in every policy; it cannot insert, update or delete | PASS — `requireRole(['coordinator','administrator','management'])` on `/analytics`; management has no mutating action | **UNVERIFIED** — no session | **PASS (DB + code); execution UNVERIFIED** |
| W7 | **Attachments are uploaded, retrieved and protected against unauthorized access** | **PASS** — bucket is private; SELECT is gated on `can_view_report()`; INSERT is gated on role + assignment + canonical path + `< 5` active attachments; no UPDATE/DELETE policy (default deny) | PASS — server-side magic-byte/MIME/size validation; short-lived signed URLs | **UNVERIFIED** — no session, `report_attachments` is empty | **PASS (DB + code); execution UNVERIFIED** |
| W8 | **Notifications are scoped to the correct recipient** | **PASS** — `notifications_select` is `recipient_id = auth.uid()`; INSERT/DELETE revoked from `authenticated`; the actor is excluded from their own notification | PASS — DAL reads the caller's own rows | **UNVERIFIED** — no session | **PASS (DB + code); execution UNVERIFIED** |
| W9 | **Unread count and read persistence** | **PASS** — 42/42 live assertions; `notifications_update_recipient` permits only the read flag | PASS — unread badge is **hidden** rather than shown as a fabricated `0` | **UNVERIFIED** — no session | **PASS (DB + code); execution UNVERIFIED** |
| W10 | **Important changes persist in the real database** | **PASS** — 42/42 live assertions confirm the lifecycle commands commit their mutations and their notifications together | PASS — `revalidatePath` after each mutation | **UNVERIFIED** — no session | **PASS (DB + code); execution UNVERIFIED** |
| W11 | **Unauthenticated perimeter redirect** | n/a | n/a | **PASS** — 9/9 protected routes 307 → `/login?next=…` | **PASS** |
| W12 | **Public self-registration is disabled** | **FAIL** — `"disable_signup": false` on the hosted project (**B-1**) | PASS — no sign-up or recovery UI; the trigger forces `student_personnel` | PASS — browser check confirms no sign-up control | **FAIL (blocking)** |
| W13 | **Unauthenticated mutation of attachments** | **FAIL** — `anon` retains EXECUTE on `soft_delete_attachment` and the guard fails open (**B-3**) | PASS — the app path is coordinator-gated | n/a | **FAIL (blocking)** |
| W14 | **Error responses never expose database internals** | n/a | PASS — allow-list classifier; raw errors go to the server log only | PASS — route/browser probes show no internals | **PASS** |

### 4.1 Modules verified correct (no defect found)

| Module | Evidence |
|---|---|
| **RLS enablement** | 12 of 13 public tables have RLS enabled. **Every** policy is `TO authenticated` — no policy grants `anon` or `PUBLIC`. |
| **`search_path` pinning** | All 21 `SECURITY DEFINER` functions in the live project pin `SET search_path = public, auth, pg_temp`. |
| **Identity derivation** | Role and identity come **only** from `supabase.auth.getUser()` → the database profile. No role is read from a header, cookie, query parameter or form field anywhere in the repository. |
| **Role escalation** | Blocked three times over: the Server Action, the RLS policy (`id != auth.uid()`), and the `SECURITY DEFINER` command. An administrator cannot alter their own account at all. |
| **Audit trail** | `role_change_audit` is written in the same transaction as the role change, with a mandatory reason and a `CHECK (old_role <> new_role)` constraint; read-protected to administrator + management; append-only (no UPDATE/DELETE policy). |
| **Separation of duties** | A reporter cannot verify their own report; the assigned technician cannot verify their own repair. Both confirmed in the live function definitions. |
| **Storage** | The bucket is private; reads are gated on `can_view_report()`; writes are role-, assignment- and path-gated; UPDATE and DELETE are default-deny. There is **no service-role client anywhere in the application**, so storage RLS cannot be bypassed. |
| **Data honesty** | No mock or fixture module remains in the runtime tree. Locations and categories are read live. No truncated dataset is ever published as a total. The dashboard states the two unimplemented features rather than inventing numbers. |
| **Secret exposure** | Only the publishable key reaches the browser. The production bundle scanner confirms no `sb_secret_*`, no service-role key and no test address in `.next/static`. |
| **Password handling** | No `signUp`, `resetPasswordForEmail` or `inviteUserByEmail` call exists in the application. No password or hash is stored, logged or rendered. |

---

## 5. Security findings by severity

### CRITICAL

None remaining. The one CRITICAL-class defect found during this audit
(`'use server'` modules exporting plain objects, which breaks `/settings` and
`/notifications`) was **fixed locally and proven fixed with Next.js's own runtime guard**.

### HIGH

| ID | Finding | Location | Impact | Status |
|---|---|---|---|---|
| **F-01** | Public self-registration enabled on the hosted project | live `GET /auth/v1/settings` → `"disable_signup": false`; trigger `handle_new_user` grants `student_personnel` | Any unauthenticated caller can create institutional profiles on the production database | **OPEN — owner action** (§10.1) |
| **F-02** | Report-submission role restriction not enforced in the database | live `reports_insert` policy + live `submit_report_with_notifications` definition | Any authenticated non-reporter role can file reports by bypassing the application | **OPEN — migration `…015` prepared** |
| **F-03** | `soft_delete_attachment` reachable by `anon`; its authorization check fails open | live privilege inventory; `20261018000004:98-101` | Unauthenticated soft-delete of any attachment whose UUID is known (UUIDs are v4-random, so not enumerable today) | **OPEN — migration `…015` prepared** |
| **F-04** | Open redirect via ASCII control characters in `?next=` | `utils/auth/validation.ts` (was `sanitizeRedirectUrl`) | `?next=/%09/evil.com` resolved to `https://evil.com/` | **FIXED locally** + regression test |
| **F-05** | No security headers of any kind | `next.config.ts` (was empty) | Clickjacking of authenticated administrator pages; no CSP, HSTS or content-type protection | **FIXED locally** |
| **F-06** | `'use server'` modules exported plain objects → Next.js loader error | `actions/accounts.ts`, `actions/notifications.ts` | `/settings` and `/notifications` fail to render at runtime | **FIXED locally** (Next's guard now accepts all 4 modules) |
| **F-07** | Deployment documentation asserted a false applied-migration state | `docs/DEPLOYMENT_READINESS.md` §3.1 | An unattended `db push` would apply two unprepared authorization changes | **FIXED locally** (documented + §5.4 authorization table) |
| **F-08** | Failed query published "0 Reports Registered" | `app/reports/page.tsx`, `utils/reports/dal.ts` | A failed query was indistinguishable from a genuinely empty queue | **FIXED locally** |

### MEDIUM

| ID | Finding | Location | Status |
|---|---|---|---|
| **F-09** | Dashboard welcome banner published a fabricated "no active requests" after a KPI failure | `app/page.tsx`, `utils/reports/dashboard-config.ts` | **FIXED locally** |
| **F-10** | `decline_assignment` uses the same NULL-unsafe role guard | `20261018000004:143-146` | **OPEN — included in migration `…015`** |
| **F-11** | `public.notification_command_receipts` has RLS disabled (protected only by grants) | `20261020000007:56` | **OPEN — included in migration `…015`** |
| **F-12** | `anon` retains blanket table privileges on `public.notifications` | live `information_schema.role_table_grants` | **OPEN — included in migration `…015`** |
| **F-13** | Six trigger functions still hold an `anon` EXECUTE grant | live `pg_proc` inventory | **OPEN — included in migration `…015`** (not directly callable; hygiene) |
| **F-14** | The `New Report` CTA was shown to every role, contradicting the role matrix | `components/layout/header.tsx`, `app/reports/page.tsx` | **FIXED locally** |
| **F-15** | The account directory hard-stops at 1000 accounts and renders nothing beyond that | `utils/settings/runtime.ts` | **OPEN — accepted design limit** |
| **F-16** | `supabase/seed.sql` resets `is_active` to `true` for the seeded categories/locations | `supabase/seed.sql` | **OPEN — accepted** (a re-seed reactivates a deliberately deactivated row) |
| **F-17** | Role-change audit history is capped at 100 rows with no pagination or export | `utils/settings/runtime.ts` | **OPEN** |
| **F-18** | The mandatory role-change **reason** is stored but never displayed | `utils/settings/runtime.ts`, `components/settings/role-change-audit-history.tsx` | **OPEN** |
| **F-19** | Account de/activation is not audited (only role changes are) | `20261018000001:143-152` | **OPEN** — requires a schema change; not made, to avoid altering the approved architecture without owner approval |
| **F-20** | No health/readiness endpoint; no structured logging; no log sink | repository-wide | **OPEN** — required for operations (§10) |
| **F-21** | The locations directory has no truncation guard | `utils/reports/dal.ts` | **OPEN** — latent; the campus would need >1000 locations |
| **F-22** | `transitionReportStatusAction` has no app-layer role predicate (the matrix lives only in the database command) | `actions/reports.ts` | **OPEN** — defence in depth only |

### LOW

| ID | Finding | Status |
|---|---|---|
| **F-23** | Mobile navigation controls lacked `aria-expanded` / `aria-controls`; the drawer has no focus trap or focus restoration | **PARTIALLY FIXED locally** — `aria-expanded` / `aria-controls` added to the header and "More" controls; focus management still open |
| **F-24** | Status-filter tabs have no `role="tablist"` / `aria-selected` | **OPEN** |
| **F-25** | `text-slate-400` on light backgrounds fails WCAG AA contrast | **OPEN** |
| **F-26** | The desktop report table has no caption | **OPEN** |
| **F-27** | `profiles_auth_account_status` / `profile_has_auth_account` are executable by every authenticated user, not only administrators | **OPEN** — negligible impact (boolean oracle on a known UUID) |
| **F-28** | No length cap on the audit reason at the database boundary (the UI caps at 500) | **OPEN** — low impact; the caller must already be an administrator |
| **F-29** | No session timebox or inactivity timeout | **OPEN** — recorded as an unresolved decision (`docs/SECURITY.md` PD-S2) |
| **F-30** | The repository's own cookie options (`httpOnly`, `secure`, `sameSite`) are asserted in documentation but never configured in code | **OPEN** — `@supabase/ssr` defaults apply and are not asserted by any test |
| **F-31** | `@supabase/ssr` and `@supabase/supabase-js` use caret ranges while `next`/`react` are exact-pinned; no `engines` field | **OPEN** |
| **F-32** | `docs/DEPLOYMENT_READINESS.md` has a missing top-level section number (§4) and its §6 cross-reference target moved | **OPEN** — cosmetic |
| **F-33** | `scripts/remote-coordinator-assignment-probe.sql` and `scripts/probe-role-simulation.sql` never switch to the `authenticated` role, so they run privileged and do not prove what their headers claim | **OPEN** — harness correctness, not application |

### INFO

| ID | Finding |
|---|---|
| **F-34** | The `CMIRS_ENABLE_TEST_PERSONAS` variable **name** is discoverable in the client bundle. The **value** is not (it is not `NEXT_PUBLIC_`-prefixed) and no secret is exposed. |
| **F-35** | The login page's `placeholder="username@cmirs.internal"` reveals the institutional mail domain. Not a credential. |
| **F-36** | The Supabase project reference is visible in `supabase/seed.sql`, `supabase/tests/**` and `supabase/.temp/`. It is the public subdomain of the API URL, not a secret. |
| **F-37** | `proxy.ts` fails open at the perimeter when the Supabase environment variables are missing (the guard is skipped). It still fails closed at the page layer, so no data is disclosed — the symptom is a 500 instead of a clean redirect. |
| **F-38** | `proxy.ts` pre-declares `/auth` and `/auth/*` as public although no such route exists. A latent hole if an auth-callback route is ever added. |
| **F-39** | `/login?reason=expired` renders a banner that nothing ever produces. Dead code. |
| **F-40** | The long-running `next dev` server on this workstation died while compiling `/login`: the Turbopack CSS loader subprocess exhausted the Node heap (`FATAL ERROR: MarkCompactCollector … JavaScript heap out of memory`), and the Rust compiler process then failed with `memory allocation of 16777216 bytes failed`. The machine has **7.8 GB of RAM with ~2.1 GB free**. The **production** build compiles and serves normally, so this is a workstation memory constraint, not an application defect — but a developer machine with this much concurrent load will see `next dev` failures. |

---

## 6. Missing features and incomplete workflows

| Area | Status | Note |
|---|---|---|
| Real-time technician presence | **Not implemented** | The dashboard states this rather than showing a number. Schema has no presence data. |
| SLA / response-time tracking | **Not implemented** | The dashboard states this. Schema has no response-deadline column. |
| Weekly resolution KPI | **Not implemented** | The ingredients exist; it was omitted rather than approximated. |
| Account invitation from within the app | **Not implemented** | Requires a service-role key, which is deliberately absent. Dashboard provisioning is the supported path. |
| Physical-device responsive testing | **Not performed** | A manual pass on real devices is recommended. |
| Attachment upload / retrieval / work-log / verification **execution** | **Not exercised** | The live tables are empty. These paths are verified by code and policy review only. |
| Authenticated end-to-end walkthrough for all five roles | **Not performed** | No credentials were available to the audit, and requesting them is out of scope. |
| A purge worker for orphaned storage binaries | **Not implemented** | The schema comments reference a `service_role` cleanup worker that does not exist in this repository. Orphaned uploads accumulate in the private bucket. |
| Structured logging / correlation IDs | **Not implemented** | `console.error` / `console.warn` only. |
| Health / readiness endpoint | **Not implemented** | No `app/api` directory exists. |
| Nonce-based CSP | **Not implemented** | The current CSP needs `'unsafe-inline'` for the Next.js hydration bootstrap. A nonce removes that requirement. |
| Activation/deactivation audit trail | **Not implemented** | Only role changes are audited. |
| Database audit history pagination / export | **Not implemented** | The most recent 100 entries only. |

---

## 7. Required environment variables (names only — never values)

### Required in every environment

| Variable | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | The project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Must be the **publishable** key. The application must never receive an `sb_secret_*` or service-role key. |

### Required only for migration / operator tooling — **not** by the application

| Variable | Scope | Notes |
|---|---|---|
| `SUPABASE_DB_PASSWORD` | Server / CI secret store only | Used by `npx supabase db push`. Never in source control, never in chat. |
| `SUPABASE_ACCESS_TOKEN` | Server / CI secret store only | Required by the Supabase CLI for Management-API operations. |

### Development-only — must be unset in production

| Variable | Scope | Notes |
|---|---|---|
| `CMIRS_ENABLE_TEST_PERSONAS` | Local development only | Enables the QA quick-fill panel on `/login`. Honoured **only** when `NODE_ENV === 'development'`. A production build cannot enable it. Deliberately **not** `NEXT_PUBLIC_`-prefixed, so it is never inlined into the browser bundle. |

### Deliberately absent

`SUPABASE_SERVICE_ROLE_KEY` is **not** present in the repository, not in `.env.local`, and not
used by any application module. The only references are a commented-out placeholder in
`.env.example` and the optional invitation path documented in
`docs/DEPLOYMENT_READINESS.md` §8.2.

---

## 8. Database migration and RLS readiness

### 8.1 Migration state

| Migration | Name | Applied? |
|---|---|---|
| `20261018000001` | core_schema | ✅ applied |
| `20261018000002` | performance_indexes | ✅ applied |
| `20261018000003` | triggers | ✅ applied |
| `20261018000004` | security_functions_and_rpc | ✅ applied |
| `20261018000005` | table_rls_policies | ✅ applied |
| `20261018000006` | storage_setup | ✅ applied |
| `20261020000007` | notification_lifecycle_rpcs | ✅ applied |
| `20261021000008` | fix_can_view_report_parameter_ambiguity | ✅ applied |
| `20261021000009` | technician_account_management | ✅ applied |
| `20261021000010` | bulk_auth_account_status | ✅ applied |
| `20261021000011` | revoke_anon_execute_privileges | ✅ applied |
| `20261021000012` | technician_rework_resumption | ❌ **PENDING** |
| `20261021000013` | deterministic_status_history_reason | ❌ **PENDING** |
| `20261021000014` | restrict_report_submission_roles | ❌ **PENDING** (prepared, owner authorization required) |
| `20261021000015` | harden_report_submission_and_function_privileges | ❌ **PENDING** (new, prepared, owner authorization required) |

`…012` re-enables the technician rework path; `…013` makes the status-history reason attach to
the correct row. Both are behavioural changes that the live database does not yet have.

### 8.2 Proposed change — migration `…015` (prepared, NOT applied)

`supabase/migrations/20261021000015_harden_report_submission_and_function_privileges.sql`
implements, in one reviewable file:

1. A `BEFORE INSERT` trigger on `public.reports` that rejects the insert unless the
   authenticated caller holds `student_personnel` or `coordinator`. Because the trigger fires
   for **every** insert path, it closes the SECURITY DEFINER command path, the PostgREST path
   and any future path at once. `auth.uid() IS NULL` (owner tooling, `service_role`, the seed
   file) keeps its existing access; anonymous PostgREST callers remain blocked by RLS.
2. `soft_delete_attachment` rewritten to fail **closed** (`IS DISTINCT FROM 'coordinator'`).
3. `decline_assignment` rewritten to fail **closed** on a NULL role.
4. `REVOKE … FROM anon` on `soft_delete_attachment` and the six trigger functions.
5. `ALTER TABLE public.notification_command_receipts ENABLE ROW LEVEL SECURITY`.
6. `REVOKE ALL ON public.notifications FROM anon`.

**Authorization required before execution.** Applying it changes production authorization
behaviour. The owner must run it deliberately:

> **Validation status of this migration.** It has been **statically reviewed against the live
> database** — every function signature it revokes or replaces was confirmed on the linked
> project (`soft_delete_attachment(uuid)`, `decline_assignment(uuid, text)` and the six
> zero-argument trigger functions), and every object it touches was confirmed to exist. It has
> **not** been executed against any database: no local Postgres stack is available in this
> environment (no Docker), and applying it to the remote project requires the owner
> authorization above. **Validate it in a rolled-back transaction before applying it**, exactly
> as the project's other migrations were validated.

```powershell
# 1. Review the exact statements
npx supabase db query --linked --file supabase/migrations/20261021000015_harden_report_submission_and_function_privileges.sql --dry-run

# 2. Confirm the ledger and the plan
npx supabase migration list --linked
npx supabase db push --dry-run

# 3. Apply (owner action)
npx supabase db push

# 4. Re-verify
npx supabase db query --linked --file scripts/remote-rls-verification.sql
npx supabase db query --linked --file scripts/remote-notification-lifecycle-verification.sql
npx supabase db query --linked --file scripts/remote-account-management-verification.sql
```

> **Note on the Phase 4G harness.** `scripts/remote-technician-workflow-verification.sql`
> created its fixture reports using the technician account as a shortcut. After migration
> `…015` (and `…014`) that shortcut correctly stops working. The harness must create its
> fixtures as the **reporter** role. This is a test-harness update, not an application change.

### 8.3 RLS readiness

| Check | Result |
|---|---|
| RLS enabled on every client-facing table | **PASS** — 12 of 13 |
| Any policy granting `anon` or `PUBLIC` | **None** |
| `SECURITY DEFINER` functions without a pinned `search_path` | **None** (21 of 21 pinned; live count) |
| `SECURITY DEFINER` functions with a client-forgeable actor parameter | **None reachable** — every client-reachable command derives the actor from `auth.uid()` |
| Private storage buckets with gated reads and writes | **PASS** |
| RLS disabled on `notification_command_receipts` | **FAIL — fixed by migration `…015`** |

**RLS verdict: READY AFTER migration `…014` and `…015` are applied.**

---

## 9. Authentication and account-provisioning readiness

| Area | Status | Notes |
|---|---|---|
| Sign-in | **READY** | `signInWithPassword` against Supabase Auth, `getUser()` (server-validated JWT) not `getSession()`. |
| Sign-out | **READY** | Global sign-out revokes refresh tokens, then redirects to `/login?reason=logged_out`. |
| Session transport | **READY (with a caveat)** | `@supabase/ssr` cookie adapter; no token in `localStorage`/`sessionStorage` anywhere. Refreshed cookies are written to both the request and the response in `proxy.ts`. **Caveat F-30:** the app configures no cookie options, so `httpOnly`/`secure`/`sameSite` are library defaults that no test asserts. |
| Redirect handling | **READY** | `sanitizeRedirectUrl` now rejects scheme, protocol-relative, backslash and control-character vectors, and proves the value still resolves to the application origin. |
| Self-registration | **NOT READY — blocker F-01** | No UI in the application, but the hosted project's Auth endpoint still accepts sign-ups. |
| Self-service password recovery | **READY** | No `resetPasswordForEmail` call exists. Password resets are performed by an administrator in the dashboard. |
| Account provisioning | **READY** | Dashboard creation → `handle_new_user` trigger → `student_personnel` profile → administrator assigns the role and activation state in `/settings`. The directory shows the real authentication-linkage status. |
| In-application invitation | **NOT IMPLEMENTED** | Deliberate. Requires a service-role key, which is absent. |
| Role change control | **READY** | Administrator only; no self-modification; audited in-transaction with a mandatory reason; the trail is read-protected and append-only. |
| Deactivation control | **READY (partial)** | Activation state can be changed by an administrator, but that change is not audited (F-19). |
| `anon` EXECUTE hygiene | **NOT READY** | Seven functions still carry the grant (F-03, F-13) — closed by migration `…015`. |

**Authentication verdict: READY AFTER the hosted-project sign-up setting is disabled and
migration `…015` is applied.**

---

## 10. Hosting, domain, HTTPS, backups, monitoring and recovery requirements

### 10.1 Blocking owner actions before the first production request

| # | Action | Where | How to verify |
|---|---|---|---|
| 1 | **Disable public sign-up** on the hosted project | Supabase dashboard → Authentication → Sign In / Providers → "Allow new users to sign up" | `GET <project-url>/auth/v1/settings` must report `"disable_signup": true` |
| 2 | **Apply migration `…014`** | `npx supabase db push` | `npx supabase migration list --linked` shows it applied |
| 3 | **Apply migration `…015`** | `npx supabase db push` | Same, plus the three remote harnesses still report 79/79 |
| 4 | **Update the Phase 4G workflow harness** to create fixture reports as the reporter role | `scripts/remote-technician-workflow-verification.sql` | The harness passes again |

### 10.2 Hosting, domain and HTTPS

| Requirement | Current state | Action |
|---|---|---|
| Deployment host | Not configured | Any Node 24 host or Vercel. `next build` + `next start` is the contract. |
| Custom domain / DNS | Not configured | Add the apex and `www` records; decide whether `www` redirects. |
| TLS certificate | Not configured | Must be issued and auto-renewed before the first request. |
| HSTS | **Now set by the application** (`max-age=63072000; includeSubDomains`) | Verify it is delivered over HTTPS only. Preload is optional and effectively irreversible. |
| Reverse proxy / CDN body limit | Not configured | Must accept a **12 MB** request body. A lower limit truncates photo uploads (see `docs/DEPLOYMENT_READINESS.md` §3). |
| Supabase Redirect URLs / Site URL | Local-only values in `supabase/config.toml` | Set both to the deployment origin. |
| Cookie `Secure` flag | Library default | Confirm the deployed origin is HTTPS-only, otherwise the session cookie will not be sent. |

### 10.3 Backups, monitoring and recovery

| Requirement | Current state | Required action |
|---|---|---|
| Automated backups / point-in-time recovery | **Not configured by this repository** | Enable PITR on the hosted project; agree a retention period. |
| Restore procedure | **Does not exist** | Write a runbook, define RPO and RTO, and rehearse one restore. |
| Uptime monitoring | **No health endpoint exists** | Add a public health route (excluded from the auth perimeter) and point a monitor at it. |
| Error alerting | **None** | Alert on the platform's 5xx rate and on the application's error log. |
| Log retention | **None** — `console.error` lines only | Ship the platform logs to a sink with retention. |
| Structured logging | **Not implemented** | Optional but recommended: JSON lines with a request/correlation ID. |
| Audit-trail export | **Not implemented** | The role-change trail is capped at 100 rows; a periodic export is needed for accountability. |
| Incident runbook | Partially covered by `docs/DEPLOYMENT_READINESS.md` §13 | §13 is symptom→action troubleshooting, **not** a backup/restore procedure. Extend it. |

---

## 11. Prioritized remaining-work checklist

### P0 — blocking; must be done before deployment approval

- [ ] **Disable public sign-up on the hosted Supabase project** and confirm `"disable_signup": true` (F-01)
- [ ] **Review and authorize migration `…014`** (report-submission RLS restriction)
- [ ] **Review and authorize migration `…015`** (report-submission role trigger + function-privilege hardening)
- [ ] Apply both migrations with `npx supabase db push` and re-run the three remote harnesses (79/79 must still pass)
- [ ] Update `scripts/remote-technician-workflow-verification.sql` to create its fixtures as the reporter role
- [ ] Correct `docs/FINAL_ACCEPTANCE_REPORT.md`, which still asserts "PASS" for deployment readiness and for `/reports/new` availability to all five roles

### P1 — required for a supported production service

- [ ] Enable PITR / automated backups; agree the retention period
- [ ] Write and rehearse the restore runbook; define RPO and RTO
- [ ] Add a public health/readiness route and exclude it from the auth perimeter
- [ ] Configure uptime monitoring and 5xx alerting
- [ ] Ship logs to a sink with retention
- [ ] Issue the TLS certificate; set the Supabase Redirect URLs and Site URL to the deployment origin
- [ ] Confirm the reverse proxy accepts a 12 MB body
- [ ] Configure the deployment platform's environment variables (names only — see §7)
- [ ] Run an authenticated walkthrough for all five roles with real credentials (see §4) and record the result
- [ ] Upload and retrieve at least one attachment per role so the attachment path has live coverage

### P2 — quality, accessibility and honesty

- [ ] Audit the **activation/deactivation** audit trail (F-19) — requires a schema change; needs owner approval of the design
- [ ] Display the mandatory role-change reason in the audit view (F-18)
- [ ] Paginate/export the role-change audit history (F-17)
- [ ] Implement a storage cleanup worker for orphaned binaries (§6)
- [ ] Add `role="tablist"` / `aria-selected` to the status-filter tabs (F-24)
- [ ] Add focus trapping and focus restoration to the mobile drawer (F-23)
- [ ] Fix the `text-slate-400` contrast failures (F-25)
- [ ] Add a caption to the desktop report table (F-26)
- [ ] Add an app-layer role predicate to `transitionReportStatusAction` (F-22)
- [ ] Add a truncation guard to the locations directory (F-21)
- [ ] Assert the effective session-cookie attributes in a test (F-30)
- [ ] Pin the `@supabase/*` dependencies and add an `engines` field (F-31)
- [ ] Fix the harness role-simulation defects in `remote-coordinator-assignment-probe.sql` and `probe-role-simulation.sql` (F-33)
- [ ] Implement a nonce-based CSP to remove `'unsafe-inline'` from `script-src`
- [ ] Fix the section numbering in `docs/DEPLOYMENT_READINESS.md` (F-32)

### P3 — optional

- [ ] Session timebox / inactivity timeout (F-29, an open decision in `docs/SECURITY.md`)
- [ ] Restrict `profile_has_auth_account` / `profiles_auth_account_status` to administrators (F-27)
- [ ] Cap the audit reason length at the database boundary (F-28)
- [ ] Remove the `?reason=expired` dead branch (F-39)
- [ ] Tighten the `proxy.ts` perimeter fail-open behaviour (F-37) and remove the unused `/auth` public-route entries (F-38)

---

## 12. Exact conditions for deployment approval

Deployment approval requires **every** one of the following to be true and evidenced. Nothing
below may be assumed from this document — each item must be independently confirmed.

### 12.1 Authorization and configuration

1. `GET <project-url>/auth/v1/settings` reports `"disable_signup": true`.
2. `npx supabase migration list --linked` reports **no pending migration**, including
   `…014` and `…015`.
3. The three remote verification harnesses report **79/79 assertions passed** against the
   project that will serve production.
4. A fresh read-only readiness probe shows: RLS enabled on every client-facing table, no
   policy granting `anon` or `public`, no `SECURITY DEFINER` function without a pinned
   `search_path`, and **no `anon` EXECUTE grant on any project function**.
5. The live `reports_insert` policy contains the reporter-role restriction **and** the
   `trg_enforce_report_submission_role` trigger exists on `public.reports`.
6. `GET /auth/v1/settings` and the project dashboard confirm **no** public OAuth provider is
   enabled (the app implements no OAuth callback).
7. The deployment platform environment contains exactly the two public variables from §7 and
   **does not** contain `SUPABASE_SERVICE_ROLE_KEY` or `CMIRS_ENABLE_TEST_PERSONAS`.

### 12.2 Build and application

8. `npm run typecheck` → 0 errors.
9. `npm run lint` → 0 errors, 0 warnings.
10. `npm test` → 0 failures.
11. `npm run build` → success.
12. `npm run verify:bundle` → PASS (no test address, no QA persona panel, no secret in the
    browser bundle).
13. `node --import ./scripts/register-next-subpath-hook.mjs scripts/verify-server-action-exports.mjs`
    → every `'use server'` module accepted by Next.js's own `ensureServerEntryExports()`.
14. The rendered production `/login` contains **no** test persona panel, no test address and no
    test-only authentication shortcut.

### 12.3 Live authenticated verification (all five roles)

15. A **student/personnel** account signs in, submits a report, and sees it in its queue.
16. A **coordinator** account signs in, triages the report, assigns it to a **real** technician,
    and sees the assignment.
17. The assigned **technician** signs in, opens the work order, starts work, submits a
    completion note **and** a further-repair update.
18. A **coordinator** verifies the repair, and only then does the report become resolved.
19. An **administrator** signs in, manages accounts, and the audit trail records the change —
    with no privileged credential visible anywhere in the UI or the network responses.
20. **Management** signs in and reaches analytics and oversight only; no mutating control is
    present or effective.
21. An **attachment** is uploaded by a reporter, retrieved by an assigned technician, and
    refused for an unrelated user.
22. Each role's **notification inbox** contains only that recipient's notifications, and the
    unread count and read state survive a sign-out/sign-in cycle.
23. Every change above is confirmed **persisted in the real database** (not just in the UI).

### 12.4 Operations

24. TLS is live and HSTS is delivered; the domain resolves and the redirect URL configuration
    matches the deployed origin.
25. Automated backups / PITR are enabled; a restore has been rehearsed; the RPO and RTO are
    written down and accepted.
26. A health endpoint exists and is monitored; 5xx alerting is wired to a reachable channel.
27. Logs are shipped to a sink with retention.
28. The reverse proxy / CDN accepts a 12 MB request body.
29. An account deactivation and offboarding procedure is documented and has been tested.

### 12.5 Approval

30. The owner has reviewed this audit and has signed off on the residual risks (F-15, F-19,
    F-23–F-33) that are explicitly **not** closed by this audit.

---

## Appendix A — Files changed by this audit

### New — production code

| File | Purpose |
|---|---|
| `utils/auth/dev-tools.ts` | The single development-only switch. `NODE_ENV === 'development'` **and** `CMIRS_ENABLE_TEST_PERSONAS === 'true`. |
| `utils/auth/test-personas.server.ts` | The server-only QA persona catalogue with a browser-evaluation guard. |
| `components/auth/dev/test-persona-panel.tsx` | The isolated QA panel; refuses to render outside a development build. |
| `utils/settings/action-state.ts` | The account-management state constant, moved out of a `'use server'` module. |
| `utils/notifications/action-state.ts` | The notification state constant, moved out of a `'use server'` module. |
| `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` | Error and 404 boundaries. |

### New — verification tooling and evidence

| File | Purpose |
|---|---|
| `scripts/verify-production-bundle.mjs` | Scans the production build output for development-only data and secrets. |
| `scripts/next-subpath-resolve-hook.mjs`, `scripts/register-next-subpath-hook.mjs` | Resolves `next/*` subpaths and the `@/*` alias outside the Next.js bundler so the **real** modules can be imported and checked. |
| `scripts/remote-production-readiness-probe*.sql` (4 files) | Read-only live schema / RLS / privilege / storage / trigger / account / volume probes. |
| `tests/unit/login-dev-persona-panel.test.mjs` | The production regression suite for the QA persona panel (13 tests). |
| `supabase/migrations/20261021000015_harden_report_submission_and_function_privileges.sql` | The prepared (unapplied) authorization hardening migration. |

### Modified — production code

| File | Change |
|---|---|
| `components/auth/login-form.tsx` | The inline persona panel and the hard-coded test-account list were removed; the panel is now a prop-driven component. |
| `app/login/page.tsx` | Supplies the personas from the server-only, gated accessor. |
| `actions/accounts.ts`, `actions/notifications.ts` | The exported plain objects were removed — these modules now export only async functions. |
| `components/settings/user-directory.tsx`, `components/notifications/notification-inbox.tsx` | Import the state constants from their new homes. |
| `utils/auth/validation.ts` | `sanitizeRedirectUrl` hardened; the import made relative so the shipped function is unit-testable. |
| `actions/auth.ts`, `utils/auth/server.ts` | Type-only imports marked `import type` so the modules import cleanly outside the bundler. |
| `utils/notifications/dal.ts` | Extension-qualified relative import. |
| `next.config.ts` | Security headers, CSP and `poweredByHeader: false`. |
| `app/page.tsx`, `app/reports/page.tsx`, `utils/reports/dashboard-config.ts` | No more fabricated zeros; the "Submit Report" CTA is role-gated. |
| `components/layout/header.tsx`, `app-shell-client.tsx`, `mobile-nav.tsx` | Role-gated CTA; `aria-expanded` / `aria-controls`; `type="button"`; `focus-visible:` consistency. |
| `supabase/config.toml` | `enable_signup = false`, with the hosted-project action documented. |
| `supabase/migrations/20261021000014_restrict_report_submission_roles.sql` | The inaccurate header claim was corrected (comment only — the SQL is unchanged and the migration is still unapplied). |

### Modified — tests and tooling

| File | Change |
|---|---|
| `tests/unit/validation.test.mjs` | Rewritten to import the **real** implementation instead of re-implementing it; added the control-character open-redirect regression tests. |
| `tests/integration/rls-runner-safety.test.ts`, `tests/integration/rls-runner.ts` | The suite could not execute at all; fixed so it runs (42/42). |
| `scripts/verify-server-action-exports.mjs` | The Next.js guard was being invoked with the wrong argument type and never ran. Fixed, and the modules are now genuinely imported. |
| `package.json` | Added `test`, `typecheck`, `verify:bundle`, `verify:prod` scripts. |
| `.gitignore`, `README.md`, `docs/DEPLOYMENT_READINESS.md`, `docs/ROLES.md` | Corrected against the code; the generated teardown artifact was untracked and removed. |

## Appendix B — What this audit deliberately did **not** do

- No commit, push, tag or deployment **by the audit**.
- No `supabase db push`, no migration applied to the remote project.
- No remote data reset, truncate, reseed or deletion.
- No account created, modified, invited or deleted on the remote project.
- No service-role key requested, introduced or used.
- No database user deleted and no remote authentication setting changed — **except** the
  *documentation* of the required sign-up change; the setting itself remains as the owner
  found it and requires their action.
- No secret value was reproduced in this document, in any log, or in any chat message.

### Repository state at the end of the audit

`HEAD` is `bc94926` — the commit that was checked out when the audit started. The complete
change set is present in the working tree as **53 uncommitted entries** (36 modified or
deleted files, 17 new files) and nothing has been pushed.

> **Note for the owner:** an external automation in this workstation committed the audit's
> intermediate state twice while the audit was running (`8117bb1` and `2bf9a28`, the latter
> titled `done`). Neither commit was created by the audit, and no git hook is configured in
> this repository. The audit undid both with `git reset --mixed bc94926`, which moved `HEAD`
> back to the original commit **without altering a single file on disk** — the working tree
> was re-verified afterwards (type check 0 errors, 238/238 tests passing). If that automation
> is expected, it will commit again on the next run; the content is unchanged either way.
