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
| Unit tests | `node --test tests/unit/*.test.mjs` | **189 tests · 189 pass · 0 fail** |
| Production build | `npm run build` | **Success** — `✓ Compiled successfully in 9.3s`, `✓ Generating static pages … (13/13)` |
| Route smoke test | `node scripts/probe-local-routes.mjs` | **9/9 PASS** — no server-action loader error |
| Browser smoke test | `node scripts/verify-in-browser.mjs` | **0 console errors, 0 page exceptions** |
| Database behaviour | `scripts/remote-*-verification.sql` | **79/79 PASS** (25 RLS + 42 lifecycle + 12 account management) |

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

**Verification performed:** `scripts/verify-supabase-connectivity.mjs` reads `.env.local`,
asserts that both variables are present and well-formed, asserts that the key is a
`sb_publishable_*` key and **explicitly rejects** `sb_secret_*` / `service_role` keys, and then
verifies that the application client factory accepts the configuration. A repository-wide scan
confirms that no module other than the two above references any environment variable.

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

### 3.1 Applied state

```
20261018000001  core_schema                     applied
20261018000002  performance_indexes              applied
20261018000003  triggers                         applied
20261018000004  security_functions_and_rpc       applied
20261018000005  table_rls_policies               applied
20261018000006  storage_setup                    applied
20261020000007  notification_lifecycle_rpcs       applied
20261021000008  fix_can_view_report_parameter_ambiguity   applied
20261021000009  technician_account_management    applied
20261021000010  bulk_auth_account_status         applied
20261021000011  revoke_anon_execute_privileges   applied
```

Confirm the remote state with:

```powershell
npx supabase migration list --linked
```

Every migration in the repository is applied; there is no pending migration.

### 3.2 Applying to a fresh environment

```powershell
npx supabase db push --dry-run     # must list exactly 20261018000001 … 20261021000011
npx supabase db push
```

**Ordering note.** Migration `20261020000007` sorts before `20261021000008` but was authored
after it, so on the current project it was applied with `--include-all`. On a **fresh**
environment the migrations apply in filename order (001 → 011) and no flag is needed. The
migrations are additive and independent of one another, so either order is safe.

### 3.3 Migration characteristics

| Migration | Additive? | Touches | Reversible by |
| --- | --- | --- | --- |
| 007 | Yes | New receipt table, a nullable column, two indexes, seven functions | Dropping the new objects; the pre-007 policies are untouched |
| 008 | Yes | One function body (`can_view_report`) | Re-running the migration-004 definition — **but that reintroduces the 42702 failure** |
| 009 | Yes | Two functions | `DROP FUNCTION` |
| 010 | Yes | One function | `DROP FUNCTION` |
| 011 | Yes | Function privileges only | `GRANT EXECUTE … TO anon` |

None of them truncate, reseed, delete or rewrite existing rows. None of them alter an existing
table, column, index, trigger, policy or role.

---

## 6. Authentication Configuration

| Requirement | Value / action |
| --- | --- |
| Supabase Auth provider | Email/password is enabled on the project (the five Gate E.3 accounts use it) |
| Session transport | `@supabase/ssr` with the cookie adapter, refreshed by `proxy.ts` on every request |
| Redirect URLs | Add the deployment origin to **Authentication → URL Configuration → Redirect URLs**, e.g. `https://<deployment-host>/login` and `https://<deployment-host>/**`. The application redirects unauthenticated users to `/login?next=<path>` |
| Site URL | Set to the deployment origin |
| Client-side auth keys | Only the publishable key is exposed to the browser |

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
| `/reports/new` | all five | Validated submission form with an idempotent retry |
| `/reports/[id]` | RLS-scoped | Detail with the lifecycle actions |
| `/notifications` | all five | Recipient-scoped inbox with a real unread count |
| `/analytics` | coordinator, administrator, management | Operational analytics |
| `/locations` | all five | Campus location directory |
| `/settings` | administrator | Account directory, account management, role-change audit |
| `/unauthorized` | all five | Access-denied page |

Unauthenticated requests to any protected route are redirected to `/login?next=<path>` by
`proxy.ts`. All protected routes are dynamic (`ƒ`) and are not prerendered.

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

- [ ] `NEXT_PUBLIC_SUPABASE_URL` set in the deployment environment
- [ ] `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set (**publishable**, not a secret key)
- [ ] `npx supabase migration list --linked` shows no pending migration
- [ ] The deployment origin added to the Supabase **Redirect URLs**
- [ ] The **Site URL** set to the deployment origin
- [ ] The `report-attachments` bucket exists, is private, and has the migration-006 policies
- [ ] At least one test account exists with a confirmed e-mail and the intended role
- [ ] `npm run build` succeeds on the deployment platform
- [ ] The deployment origin serves `/login` with HTTP 200
- [ ] An authenticated sign-in reaches `/` and shows the role dashboard
- [ ] A signed-in user sees their own notification badge count
- [ ] A coordinator sees the report queue; a technician sees only their assigned work
- [ ] `git status` reviewed; the working tree committed and pushed (this task performed no commit, push, or deploy)

---

## 15. Final Statement

The application is **buildable, type-safe, lint-clean, fully unit-tested, and verified against
the live Supabase project** for every database behaviour that matters. The only outstanding
external dependencies are an authorized authenticated session for a live end-to-end walkthrough
and the optional service-role configuration for self-service account invitation — both are
documented above with the exact owner steps.
