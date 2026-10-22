# CMIRS — Deployment Readiness

**Project:** Campus Maintenance & Incident Reporting System
**Project root:** `D:\CMIRS-System\my-app`
**Date:** 2026-10-21
**Target:** Next.js 16.4.2 (App Router, Turbopack) · React 19 · TypeScript 5 · Tailwind CSS 4 ·
Supabase Auth + PostgreSQL + Row Level Security + Supabase Storage

**Status: prepared and verified — NOT deployed.** No deployment, commit, push, or remote
configuration change was performed by this work.

---

## 1. Build and Quality Gates

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | **0 errors** |
| Lint | `npm run lint` | **0 errors, 0 warnings** |
| Unit tests | `npm test` | **238 tests · 238 pass · 0 fail** |
| Integration safety tests | `node tests/integration/rls-runner-safety.test.ts` | **42 tests · 42 pass · 0 fail** |
| Server Action export guard | `node --import ./scripts/register-next-subpath-hook.mjs scripts/verify-server-action-exports.mjs` | **4/4 modules PASS** — Next.js's own `ensureServerEntryExports()` accepts every `'use server'` module |
| Production build | `npm run build` | **Success** |
| Production bundle scan | `npm run verify:bundle` | **PASS** — no test account address, no QA persona panel and no secret in the browser bundle |
| Route smoke test | `node scripts/probe-local-routes.mjs http://localhost:<port>` | **9/9 PASS** — no server-action loader error |
| Browser smoke test | `node scripts/verify-in-browser.mjs http://localhost:<port>` | **0 console errors, 0 page exceptions** |
| Database behaviour | `scripts/remote-*-verification.sql` | **79/79 PASS** (25 RLS + 42 lifecycle + 12 account management) |
| Migration ledger | `npx supabase migration list --linked` | **4 migrations PENDING** — see §5.1 |

`npm run start` serves the production build on `PORT` (default 3000).

---

## 2. Environment Variables

Only two variables are required, and both are **client-safe**. No service-role key is used
anywhere in the application, and none is present in the repository.

| Variable | Required | Scope | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public | The project URL, e.g. `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Public | The publishable (client-safe) key. The application must **never** be given a `sb_secret_*` or service-role key. |

**Optional, for operator tooling only (not required by the application):**

| Variable | Scope | Purpose |
| --- | --- | --- |
| `SUPABASE_DB_PASSWORD` | Server/CI only | Used by `npx supabase db push` against the linked project. Supply it through the CI secret store or a local environment file — never in source control, never in chat. |
| `SUPABASE_ACCESS_TOKEN` | Server/CI only | Required by the Supabase CLI for Management-API operations. |

**Development-only, must never be set in a production environment:**

| Variable | Scope | Purpose |
| --- | --- | --- |
| `CMIRS_ENABLE_TEST_PERSONAS` | Local development only | Enables the QA test-persona quick-fill panel on `/login`. Honoured **only** when `NODE_ENV === 'development'` (that is, `next dev`). A production build always evaluates `NODE_ENV` to `"production"`, so the panel cannot be enabled there regardless of this value. It is deliberately **not** prefixed with `NEXT_PUBLIC_`, so it is never inlined into the browser bundle. Leave it unset in the deployment environment. |

**Verification performed:** `scripts/verify-supabase-connectivity.mjs` reads `.env.local`,
asserts that both variables are present and well-formed, asserts that the key is a
`sb_publishable_*` key and **explicitly rejects** `sb_secret_*` / `service_role` keys, and then
verifies that the application client factory accepts the configuration. A repository-wide scan
confirms that no module other than the two above (and the development-only switch) references
any environment variable.

**Owner action:** set both variables in the deployment platform's environment settings. Do not
edit `.env.local` in a deployed environment; it is a local-only file and is already git-ignored
(`.env*` with `!.env.example`).

---

## 3. Request Body Limits (required for report photo attachments)

Two **independent** framework limits govern how large a Server Action request may be. Both must
exceed the 10 MB per-attachment cap in `utils/reports/validation.ts`, or a legitimate photo is
rejected or corrupted.

| Limit | Config key | Default | Configured | Failure mode when exceeded |
| --- | --- | --- | --- | --- |
| Server Action body | `experimental.serverActions.bodySizeLimit` | **1 MB** | `12mb` | `413` — *"Body exceeded 1 MB limit."* |
| Proxy body buffer | `experimental.proxyClientMaxBodySize` | **10 MB** | `12mb` | The body is **truncated** (not rejected) → *"Unexpected end of form"* |

The proxy limit is the one that bites: it is **equal to** the per-attachment cap, so a 10 MB
photo was being truncated before the action ever saw it. Both limits are now `12mb`, which
accommodates one maximum-size file plus the multipart framing overhead.

The **report-submission** action never carries file bytes: the photo picker is rendered
**outside** the report form, so the selected images are not posted with the report. The files
are uploaded afterwards, one per request, by `uploadReportAttachmentAction`.

Verification: `node scripts/verify-server-action-body-limit.mjs http://localhost:<port> 12582912 /login`
(with `ACTION_ID` set to a real Server Action id) proves that a body of 11.58 MB is received
and parsed intact while a body of 13.59 MB is truncated — i.e. the threshold is exactly the
configured 12 MB.

> **Note for a reverse proxy or CDN in front of the application:** it must also allow a
> 12 MB request body, otherwise it will truncate the upload before Next.js sees it.

---

## 5. Database Migrations

### 5.1 Applied state

Verified against the linked project on **2026-10-22** with
`npx supabase migration list --linked`:

```
20261018000001  core_schema                             applied
20261018000002  performance_indexes                      applied
20261018000003  triggers                                 applied
20261018000004  security_functions_and_rpc               applied
20261018000005  table_rls_policies                       applied
20261018000006  storage_setup                            applied
20261020000007  notification_lifecycle_rpcs               applied
20261021000008  fix_can_view_report_parameter_ambiguity  applied
20261021000009  technician_account_management             applied
20261021000010  bulk_auth_account_status                 applied
20261021000011  revoke_anon_execute_privileges           applied
20261021000012  technician_rework_resumption              PENDING
20261021000013  deterministic_status_history_reason       PENDING
20261021000014  restrict_report_submission_roles          PENDING
20261021000015  harden_report_submission_and_function_privileges  PENDING (new, see §5.4)
```

> **CORRECTION (production readiness audit, 2026-10-22).** An earlier revision of this
> document stated that "every migration in the repository is applied; there is no pending
> migration". That was **incorrect**: migrations `…012`, `…013` and `…014` exist in the
> repository and were **not** applied. The migration ledger was never re-read after those
> files were added. Confirm the remote state with the command above before every release.

Do **not** run `npx supabase db push` unattended. Migrations 014 and 015 change database
authorization behaviour and require the explicit owner authorization recorded in §5.4.

### 5.2 Applying to a fresh environment

```powershell
npx supabase migration list --linked            # confirm the ledger first
npx supabase db push --dry-run                  # review exactly what would change
npx supabase db push                            # only after the owner has authorized it
```

**Ordering note.** Migration `20261020000007` sorts before `20261021000008` but was authored
after it, so on the current project it was applied with `--include-all`. On a **fresh**
environment the migrations apply in filename order (001 → 015) and no flag is needed. The
migrations are additive and independent of one another, so either order is safe.

### 5.3 Migration characteristics

| Migration | Additive? | Touches | Reversible by |
| --- | --- | --- | --- |
| 007 | Yes | New receipt table, a nullable column, two indexes, seven functions, `REVOKE INSERT/DELETE` on `notifications` | Dropping the new objects; the pre-007 policies are untouched |
| 008 | Yes | One function body (`can_view_report`) | Re-running the migration-004 definition — **but that reintroduces the 42702 failure** |
| 009 | Yes | Two functions | `DROP FUNCTION` |
| 010 | Yes | One function | `DROP FUNCTION` |
| 011 | Yes | Function privileges only | `GRANT EXECUTE … TO anon` |
| 012 | Yes | Two function bodies (technician rework resumption) | Re-applying the migration-007 bodies |
| 013 | Yes | One function body (`record_status_history`) | Re-applying the migration-007 body |
| 014 | Yes | One RLS policy (`reports_insert`) is replaced | Re-running the migration-005 definition |
| 015 | Yes | One trigger function + trigger, two function bodies replaced, RLS enabled on one table, `anon` grants revoked | Re-running the migration-004 / migration-007 bodies |

> **CORRECTION (production readiness audit, 2026-10-22).** An earlier revision of this
> document stated that none of the migrations "alter an existing table, column, index,
> trigger, policy or role". That was **incorrect**: migration 007 adds a column and revokes
> privileges, migration 011 changes role privileges, and migrations 014/015 replace policies
> and function bodies. None of them truncate, reseed, delete or rewrite existing rows.

### 5.4 Owner authorization required before the next release

| Migration | Change | Why it needs authorization |
| --- | --- | --- |
| `…014` | Restricts the `reports_insert` RLS policy to the reporter roles | A production policy change. It is prepared and locally validated; it has never been applied. |
| `…015` | Adds the report-submission role trigger, closes the `anon` EXECUTE grant on `soft_delete_attachment`, rewrites two authorization guards to fail closed, enables RLS on `notification_command_receipts`, and revokes `anon` table privileges | A production authorization change. See `docs/PRODUCTION_READINESS_AUDIT.md` §5 for the full finding list and the validation harness. |

Both must be reviewed and applied deliberately. Neither is safe to apply as part of an
unattended pipeline step.

---

## 6. Authentication Configuration

| Requirement | Value / action |
| --- | --- |
| Supabase Auth provider | Email/password is enabled on the project (the five Gate E.3 accounts use it) |
| Session transport | `@supabase/ssr` with the cookie adapter, refreshed by `proxy.ts` on every request |
| Redirect URLs | Add the deployment origin to **Authentication → URL Configuration → Redirect URLs**, e.g. `https://<deployment-host>/login` and `https://<deployment-host>/**`. The application redirects unauthenticated users to `/login?next=<path>` |
| Site URL | Set to the deployment origin |
| Client-side auth keys | Only the publishable key is exposed to the browser |
| **Public self-registration** | **MUST be disabled on the hosted project.** The application has no sign-up or password-recovery UI and the documentation requires self-registration to stay disabled — but the **hosted project's `Enable signup` setting was still `true` on 2026-10-22** (verified through the project's own `GET /auth/v1/settings` endpoint). While it is enabled, anyone who can reach `POST /auth/v1/signup` gets an Auth account, and the `handle_new_user` trigger immediately creates a `public.profiles` row with the `student_personnel` role. Turn it off in **Authentication → Sign In / Providers → "Allow new users to sign up"** and re-verify with `GET <project-url>/auth/v1/settings` — the response must report `"disable_signup": true`. The repository's `supabase/config.toml` now also declares `enable_signup = false` for local stacks. |
| Password recovery | Self-service recovery stays disabled. Password resets are performed by an administrator through the Supabase dashboard. |

---

## 7. Storage

| Requirement | Current state | Action |
| --- | --- | --- |
| `report-attachments` bucket | Exists, **private** | None |
| Storage policies | Created by migration 006: reads are gated on `public.can_view_report(ra.report_id)`; writes are limited to the report owner and to the assigned technician | None — re-apply with the migrations on a fresh project |
| Upload path | `utils/storage/server.ts` uses a **server-side** client and issues short-lived signed URLs; the browser never receives a storage credential | None |
| Constraints | JPEG / PNG / WebP only, 10 MB per file, 5 files per report — enforced server-side | None |

**Owner action (if new buckets are ever added):** keep every bucket **private** and grant access
only through signed URLs issued by a server-side function, mirroring the `report-attachments`
pattern.

---

## 8. Account Provisioning — the one external dependency

The application manages the **profile** state of accounts that already exist in Supabase Auth.
It cannot **create** a Supabase Auth user, because that requires the Admin API and therefore the
service-role key.

### 8.1 Current (supported) path

1. Create the account in the **Supabase dashboard** (Authentication → Users → Add user), with the
   email confirmed.
2. The `handle_new_user` trigger creates the matching `public.profiles` row automatically.
3. The account appears immediately in the **administrator directory** with the status
   **Confirmed** (the `profile_has_auth_account` check).
4. An administrator assigns the role and the activation state in `/settings`; every role change
   is written to `public.role_change_audit`.

A profile that exists **without** a confirmed Auth user is shown as **No login account** — it is
never presented as a working technician.

### 8.2 Optional invitation path — requires owner configuration

If self-service invitations are wanted:

1. Add `SUPABASE_SERVICE_ROLE_KEY` to the **server-side** deployment environment only.
2. Add a server action that calls the Supabase Admin API (`auth.admin.inviteUserByEmail`) and
   then sets the profile role.
3. **Never** expose the key to the browser, never accept a role from the client, and keep the
   invitation endpoint administrator-only.

This was deliberately **not** implemented: the key is absent from the project environment, and
the task forbade introducing a service-role credential.

---

## 9. Production Route Behaviour

| Route | Roles | Behaviour |
| --- | --- | --- |
| `/login` | public | Sign-in form; redirects to the requested page after authentication |
| `/` | all five | Role-specific dashboard |
| `/reports` | all five | Live, paginated, filterable queue |
| `/reports/new` | **student_personnel, coordinator** | Validated submission form with an idempotent retry. The other three roles are redirected to `/unauthorized` (the Phase 4H role-matrix resolution). |
| `/reports/[id]` | RLS-scoped | Detail with the lifecycle actions |
| `/notifications` | all five | Recipient-scoped inbox with a real unread count |
| `/analytics` | coordinator, administrator, management | Operational analytics |
| `/locations` | all five | Campus location directory |
| `/settings` | administrator | Account directory, account management, role-change audit |
| `/unauthorized` | all five | Access-denied page |

Unauthenticated requests to any protected route are redirected to `/login?next=<path>` by
`proxy.ts`. All protected routes are dynamic (`ƒ`) and are not prerendered.

> **CORRECTION (production readiness audit, 2026-10-22).** An earlier revision of this table
> listed `/reports/new` as available to "all five". The route is restricted to the reporter
> roles by the Phase 4H role-matrix resolution (see `docs/ROLES.md` PD-R6).

---

## 10. Secure Error Handling

- The application never returns a raw database error to the browser. A fixed **allow-list**
  classifier (`utils/reports/transform.ts`) maps the recognised failure classes to accurate,
  non-revealing notices; the controlled command errors (`CMIRS_*`) are mapped separately.
- The raw error is written to the server log only.
- A failed query renders an **explicit failure state**, never an empty list or a zero KPI.
- The server-action loader error class (`A "use server" file can only export async functions`)
  is structurally prevented: `scripts/verify-server-action-exports.mjs` runs Next.js's own
  `ensureServerEntryExports()` against every `'use server'` module.

---

## 11. Documentation for Installation and Setup

| Document | Purpose |
| --- | --- |
| `README.md` | Project overview and local development |
| `docs/PRODUCTION_READINESS_AUDIT.md` | **The 2026-10-22 production readiness audit** — findings, evidence, and the exact conditions for deployment approval |
| `docs/FINAL_ACCEPTANCE_REPORT.md` | Acceptance matrix, evidence, remaining blockers |
| `docs/DEPLOYMENT_READINESS.md` | This document |
| `docs/SECURITY.md` | Security model |
| `docs/frontend/PHASE_4D_COMPLETION_REPORT.md` | The real-data completion summary |
| `docs/frontend/PHASE_4E_TECHNICIAN_WORKFLOW_REPORT.md` | Technician accounts and the work-order lifecycle |
| `docs/frontend/PHASE_4F_NOTIFICATIONS_COMPLETION_REPORT.md` | The notification lifecycle |
| `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md` | Connectivity and remote verification evidence |
| `docs/frontend/PHASE_4D_2_REPORT_VISIBILITY_REPAIR_REPORT.md` | The `can_view_report` repair |
| `docs/database-design/*` | The schema, RLS, index and migration design record |
| `.env.example` | The documented environment variable names |

---

## 12. Known Limitations

| Limitation | Explanation |
| --- | --- |
| Real-time technician presence | The schema has no presence data. The dashboard states this instead of inventing a number. |
| SLA / response-time tracking | The schema has no response-deadline column. The dashboard states this. |
| Weekly resolution KPI | Not displayed; it was previously a fixture value. The ingredients exist (`updated_at` + `status = 'verified'` inside the Philippine week bounds) but it was omitted rather than approximated. |
| Server-side idempotency for the generic write path | The five lifecycle commands are idempotent through the command receipts. The direct authenticated lifecycle policies are retained by approved decision S-06 / I-02 and are a later gated release. |
| Auth account invitation | See §8.2. |
| Physical-device responsive testing | Not performed; a short manual pass is recommended. |

---

## 13. Recovery Steps

| Situation | Action |
| --- | --- |
| The application shows a database error | Check the server log for the PostgREST code. `42702` indicates the `can_view_report` definition is the pre-008 one — re-apply migration 008. `42501` indicates a privilege problem — re-apply migration 011. |
| A report is invisible to a legitimate user | Confirm the role: `SELECT id, role, is_active FROM public.profiles WHERE id = '<uuid>';`. For a technician, confirm a qualifying assignment exists (`assignments.status <> 'declined'`). |
| A notification is missing | Notifications are created only by the lifecycle commands, and only for a recipient other than the actor. Check `public.notifications` for the report id. |
| The header badge shows no count | The count query failed; the badge is deliberately hidden rather than shown as zero. Check the server log. |
| Storage upload fails | Confirm the `report-attachments` bucket is private and that the storage policies from migration 006 are applied. |
| A migration fails | Every migration is validated in a rolled-back transaction before it is applied (`BEGIN; <migration>; ROLLBACK;`). Re-run the validation, fix the file, and push again. |
| Roll back the visibility repair | Re-running the migration-004 `can_view_report` definition restores the 42702 failure. This is a last resort only. |

---

## 14. Deployment Checklist

### 14.1 Blocking actions (must be completed before the first production request)

- [ ] **Disable public sign-up on the hosted Supabase project** and confirm
      `GET <project-url>/auth/v1/settings` reports `"disable_signup": true` (§6)
- [ ] **Apply migration `…014`** (report-submission RLS restriction) — owner authorization required (§5.4)
- [ ] **Apply migration `…015`** (report-submission role trigger + function-privilege hardening) — owner authorization required (§5.4)
- [ ] Re-run `npx supabase migration list --linked` and confirm **no pending migration**
- [ ] Re-run the remote harnesses: `scripts/remote-rls-verification.sql`,
      `scripts/remote-notification-lifecycle-verification.sql`,
      `scripts/remote-account-management-verification.sql` — all must report PASS
- [ ] `NEXT_PUBLIC_SUPABASE_URL` set in the deployment environment
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set (**publishable**, not a secret key)
- [ ] The deployment origin added to the Supabase **Redirect URLs**
- [ ] The **Site URL** set to the deployment origin
- [ ] `report-attachments` bucket exists, is private, and has the migration-006 policies
- [ ] At least one test account exists with a confirmed e-mail and the intended role
- [ ] `npm run build` succeeds on the deployment platform
- [ ] `npm run verify:bundle` passes on the deployment build
- [ ] The deployment origin serves `/login` with HTTP 200
- [ ] An authenticated sign-in reaches `/` and shows the role dashboard
- [ ] A signed-in user sees their own notification badge count
- [ ] A coordinator sees the report queue; a technician sees only their assigned work
- [ ] `git status` reviewed; the working tree committed and pushed (this task performed no commit, push, or deploy)

### 14.2 Operational prerequisites (required for a supported production service)

- [ ] TLS certificate issued and **HSTS** verified in the response headers
- [ ] Automatic database backups / point-in-time recovery enabled and the retention period agreed
- [ ] A documented restore procedure with a stated RPO and RTO, rehearsed at least once
- [ ] Uptime monitoring against a public health probe, plus alerting for the error rate
- [ ] A log sink with retention; the application currently writes plain `console.error` lines only
- [ ] A reverse proxy / CDN that accepts a **12 MB** request body (see §3)
- [ ] An owner-approved account deactivation and offboarding procedure

---

## 15. Final Statement

**Status: READY AFTER REQUIRED FIXES — NOT DEPLOYED.**

The application is buildable, type-safe, lint-clean and fully unit-tested, and every database
behaviour that the remote harnesses cover is verified against the live Supabase project. The
production readiness audit of 2026-10-22 nevertheless identified defects that were **not**
present in the earlier verification round, because that round verified the code that existed
rather than re-deriving the guarantees from the live database. The blocking items are listed
in `docs/PRODUCTION_READINESS_AUDIT.md` and summarised in §14.1 above:

1. public self-registration is still enabled on the hosted Supabase project;
2. the report-submission role restriction is enforced only in the application layer, not in
   the database;
3. `soft_delete_attachment` is still reachable by the unauthenticated `anon` role and its
   authorization check fails open;
4. migrations `…014` and `…015` are prepared but not applied.

The first three are closed by owner actions that are outside the repository. The fourth
requires an explicit `supabase db push` authorization. No deployment, commit, push, or remote
configuration change was performed by this work.
