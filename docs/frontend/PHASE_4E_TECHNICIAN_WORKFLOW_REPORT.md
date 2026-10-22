# CMIRS — Phase 4E: Technician Workflow & Account Management Report

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Scope:** Phase 5 (real technician account management) and Phase 6 (assignment and work-order lifecycle)

---

## 1. Executive Summary

The technician workflow was **functionally complete but operationally unverifiable**: the
technician dashboard reported *"The database could not evaluate the report visibility rule"*
because the `public.can_view_report()` helper raised PostgreSQL `42702` for every non-oversight
role. That defect is now **repaired and applied**, and the two capabilities that the workflow
still lacked — a trustworthy technician account directory and a way to manage those accounts —
are now implemented against real data.

| Capability | Before | After |
| --- | --- | --- |
| Technician account directory | A read-only list of `profiles` rows; a manually inserted row looked identical to a working account | Real profiles **plus** a per-account auth-linkage status derived from `auth.users` (Confirmed / No login account / Unknown) |
| Account management | Not possible | An administrator can change an account's role and activation state; every role change is written to `role_change_audit` in the same transaction |
| Technician work queue | Broken by 42702 | Verified end to end against the remote: the assigned technician can read the work order, start it, hold it, and complete it |
| Coordinator assignment | Broken by 42702 | Verified end to end: assignment, reassignment, and the no-op rejection all behave as approved |
| Completion and verification | Broken by 42702 | Verified end to end: completion moves the report to `completed` (awaiting verification, never straight to `verified`), and the coordinator verifies or returns it for rework |

**Verification:** `tsc` 0 errors · `eslint` 0/0 · **189 unit tests, 189 pass, 0 fail** ·
**12/12** remote account-management checks · **42/42** remote lifecycle checks ·
**25/25** remote RLS checks.

---

## 2. Root Cause and Evidence

### 2.1 The technician dashboard error

The technician dashboard showed:

> "The database could not evaluate the report visibility rule, so report data cannot be displayed right now."

That wording was already correct — Phase 4D.1 added it deliberately instead of misreporting a
database failure as a permission problem. The underlying defect was:

```
[DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous" | code= "42702" | status= "unknown"
```

**PostgreSQL 42702 is `ambiguous_column`.** The `public.can_view_report(report_id UUID)`
function referenced its bare parameter `report_id` inside a query over `public.assignments`,
which owns a `report_id` column. PL/pgSQL's default `plpgsql.variable_conflict = error` raised
the error at parse time.

**Why it hit exactly the technician and student dashboards.** The `IF` condition of the function
is parsed as one statement, so the ambiguous sub-select is parsed for every caller that reaches
the third branch:

- `coordinator`, `administrator`, `management` → return `TRUE` in the **first** branch and never
  reach it → unaffected.
- `student_personnel`, `technician` → reach it → the function raises → the `reports_select` RLS
  policy (`USING (public.can_view_report(id))`) fails → **every** `SELECT` on `public.reports`
  fails, together with the `report_attachments`, `report_status_history`, `report_comments`,
  `verifications` and `storage.objects` policies.

**What was ruled out by evidence, not assumption**

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| The RLS policy is wrong | **No** | The policy expression is plain SQL where `report_id` unambiguously denotes the calling table's column. The defect is inside the PL/pgSQL helper. |
| `auth.uid()` or the profile/role resolution is wrong | **No** | `public.get_user_role()` takes no parameters and is unambiguous; the error is raised by the *visibility* helper, after role resolution succeeded. |
| A missing relationship / join | **No** | The technician path is `reports` → `assignments` on `a.report_id = <report id>`, backed by the existing `idx_assignments_lookup (report_id, technician_id, status)` index. |
| A permission error | **No** | PostgreSQL returned 42702, not 42501. |
| The error is obscured by a generic message | **No** | The classifier maps 42702 to a specific, accurate notice and the raw error code is logged server-side. |

**Security consequence of the defect.** Had the unqualified name resolved to the *column*, the
predicate would have become `a.report_id = a.report_id` — true for any assignment row — letting
**any technician view any report that had any assignment**. The 42702 failure was actively
preventing that bypass. The repair restores the intended comparison and does not widen access.

**Fix** — migration `20261021000008` (applied). The argument is captured once into a local
whose name cannot collide with any column, and `#variable_conflict use_variable` makes the
resolution deterministic:

```sql
target_report_id := report_id;
...
WHERE a.report_id = target_report_id
```

The parameter name, the `can_view_report(UUID)` signature, `SECURITY DEFINER`, `STABLE`, the
fixed `search_path` and the `REVOKE`/`GRANT` pair are preserved, so all seven policy call sites
remain valid. The three approved authorization branches are byte-identical.

### 2.2 A privilege gap found while verifying account management

Supabase configures `ALTER DEFAULT PRIVILEGES` so that every newly created function receives
EXECUTE for `anon`, `authenticated` and `service_role`. A `REVOKE ALL … FROM PUBLIC` does not
remove that, because it is an *explicit* grant to `anon`.

The remote harness observed it directly:

```
AM-11 the account-management command is not executable by the anon role -> observed: executed
AM-12 the linkage helper is not executable by the anon role            -> observed: executed
```

**No data was exposed**: every one of these functions re-derives the actor from `auth.uid()` and
raises `CMIRS_NOT_AUTHENTICATED` without a session, and the anon call was refused. Migration
`20261021000011` closes the gap by revoking the `anon` privilege from every project function
(including the pre-existing `can_view_report`, `decline_assignment` and `get_user_role`). After
the fix both checks report `permission denied for function …`.

---

## 3. Files Changed

### 3.1 Migrations

| File | Change |
| --- | --- |
| `supabase/migrations/20261021000008_fix_can_view_report_parameter_ambiguity.sql` | Repairs the 42702 ambiguity; preserves signature, attributes and privileges |
| `supabase/migrations/20261021000009_technician_account_management.sql` | Adds `public.profile_has_auth_account(uuid)` and `public.admin_update_profile_operational_state(uuid, user_role, boolean, text)` |
| `supabase/migrations/20261021000010_bulk_auth_account_status.sql` | Adds `public.profiles_auth_account_status(uuid[])` for a one-round-trip directory |
| `supabase/migrations/20261021000011_revoke_anon_execute_privileges.sql` | Revokes the `anon` EXECUTE privilege from every project function |

### 3.2 Application

| File | Change |
| --- | --- |
| `types/settings.ts` | `SettingsUserDirectoryEntry.hasAuthAccount: boolean \| null` |
| `utils/settings/transform.ts` | The mapping carries the linkage status; it stays `null` when it could not be read |
| `utils/settings/runtime.ts` | Resolves the whole directory's linkage status with one bulk RPC |
| `actions/accounts.ts` | **NEW** — `updateInstitutionalAccountAction`: server-side administrator gate, refuses self-management, validates the role, requires a reason for a role change |
| `components/settings/user-directory.tsx` | Shows the real login-account status per row and adds the management panel |
| `app/settings/page.tsx` | Passes the signed-in administrator id; the page is no longer read-only |
| `utils/reports/mutations.ts` | The five lifecycle commands now execute through the hardened RPCs |
| `utils/reports/lifecycle-rpc.ts` | **NEW** — `resolveRequestId`, `describeLifecycleRpcError`, `invokeLifecycleRpc` |
| `actions/reports.ts` | Extracts and forwards the idempotency token |
| `components/reports/report-submission-form.tsx`, `components/reports/report-action-panel.tsx` | Stamp the idempotency token on submit; keep it stable across retries of the same attempt |

---

## 4. The Complete Assignment and Work-Order Lifecycle

### 4.1 Coordinator workflow

| Step | Implementation | Verified |
| --- | --- | --- |
| Review category, location, description, priority | `getReportDetails()` → `transformDbReportToDetailedReport` | 42/42 lifecycle checks |
| Set or confirm priority | `triage_report_with_notifications` (coordinator only; `under_review` only) | 42/42 |
| View eligible real technicians | `getActiveTechnicians()` → active `technician` profiles | 42/42 |
| Assign and confirm | `assign_or_reassign_report_with_notifications` — locks the report and its active assignments, marks the previous assignment `reassigned`, creates the new one, moves the report to `assigned`, delivers the notification, all in one transaction | 42/42 |
| Reassign only when permitted | A reassignment to the **already active** technician is rejected as a no-op (approved decision P-05) | 42/42 |
| Accurate success/failure feedback | Controlled `CMIRS_*` errors mapped to accurate, non-revealing notices | Unit tests |

### 4.2 Technician workflow

| Step | Implementation | Verified |
| --- | --- | --- |
| View only authorized assigned work | RLS `can_view_report` → the technician branch (qualifying assignment, any status except `declined`) | 25/25 RLS checks |
| Open the work-order detail | `getReportDetails()` | Route probe + headless browser |
| Start work | `transition_report_status_with_notifications` → `in_progress`; the assignment moves too | 42/42 |
| Record progress notes | `createWorkLogRecord` → `work_logs` (unchanged, still RLS-guarded) | Existing suite |
| Place on hold with a reason | `on_hold` requires a reason of ≥ 5 characters | 42/42 |
| Submit completion | `completed` → the report enters **awaiting verification**, never `verified` | 42/42 |
| See status and history | `report_status_history` (trigger T3) and the detail panel | 42/42 |

### 4.3 Completion verification

| Requirement | Implementation | Verified |
| --- | --- | --- |
| Record completion with the approved contract | `completed` assignment + report status | 42/42 |
| Awaiting-verification state | The report sits at `completed`; only the verification command may move it on | 42/42 |
| Coordinator inspects notes and evidence | The detail view renders the work logs and attachments | Route probe |
| Verification or return for rework | `verify_report_with_notifications` → `verified` or `reopened` | 42/42 |
| Unauthorized users cannot verify | Coordinator-only **and** separation of duties: the reporter and the assigned technician may not verify their own work | 42/42 |
| Verifier and timestamp recorded | `public.verifications` (`verified_by`, `verified_at`) | 42/42 |

### 4.4 Atomicity and race conditions

The assignment and lifecycle commands lock the rows they touch (`SELECT … FOR UPDATE` on the
report and on the active assignments, in a deterministic order) and run inside one transaction,
so a concurrent dispatch cannot produce two active assignments. The notification rows for a
command are created in the same transaction as the mutation, and the per-recipient
`(event_key, recipient_id)` unique index makes delivery idempotent.

**Duplicate submissions** are prevented on two levels:

1. **Client** — an explicit single-flight lock (`submissionLockedRef`) cancels a second dispatch
   while the first is in flight.
2. **Server** — the client stamps an idempotency token (`p_request_id`) into the form, the
   action forwards it, and the command stores it in `public.notification_command_receipts`
   under `(actor_id, command_name, request_id)`. A retry of the same attempt is answered with
   the **original** result and creates no second report, assignment or notification. A replay
   with different arguments is rejected with `CMIRS_REPLAY_MISMATCH`.

Both levels were verified: 42/42 lifecycle checks include the replay, the no-duplicate-notification
and the replay-mismatch cases.

---

## 5. Technician Account Management

### 5.1 What the administrator can now do

| Capability | Implementation | Verified |
| --- | --- | --- |
| Read real technician profiles | `getAdministratorSettingsData()` → `profiles` with an exact count and a completeness guard | Existing suite + route probe |
| Display the real account status | `is_active` from the profile **and** the auth-linkage status from `auth.users` | AM-01, AM-02, AM-03 |
| Change an account's role | `admin_update_profile_operational_state` — administrator only, reason required, `role_change_audit` written in the same transaction | AM-07, AM-08 |
| Activate / deactivate an account | Same command, without a role change | AM-09 |
| Never manage your own account | The command refuses it, mirroring the existing `profiles_update_admin` RLS policy | AM-05 |
| Never let a non-administrator manage accounts | The command re-derives the role from `auth.uid()` | AM-04 |
| Never expose a service-role key to the browser | The application references only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Repository-wide scan |
| Never fabricate names or emails | Every name and email comes from `public.profiles` | Repository-wide scan |

### 5.2 The auth-linkage status

`public.profile_has_auth_account(uuid)` returns a single boolean: does a **confirmed**
Supabase Auth user exist for this profile? It never returns an email, a token, a session, a
password hash, or any other auth attribute — it is the minimum information needed to distinguish
an operable account from a manually inserted profile row that cannot sign in.

The directory renders three honest states:

| State | Meaning |
| --- | --- |
| **Confirmed** | A confirmed Auth user exists — the account can sign in. |
| **No login account** | The profile exists but has no confirmed Auth user — the account **cannot** sign in. |
| **Unknown** | The linkage status could not be read — the directory says so instead of guessing. |

This directly satisfies the requirement *"Do not pretend a manually inserted profile without a
valid authentication account is a working technician."*

### 5.3 The documented external step that remains

Creating a Supabase Auth user (an invitation) requires the **service-role key**, which is
deliberately absent from the project environment and which this task forbids introducing. The
administrator workflow therefore manages the **profile** state of accounts that already exist
in Supabase Auth; issuing a brand-new invitation is an owner step, documented in
`docs/DEPLOYMENT_READINESS.md` §6.

---

## 6. Tests and Actual Results

| Suite | Result |
| --- | --- |
| `node --test tests/unit/*.test.mjs` | **189 tests · 189 pass · 0 fail** |
| `scripts/remote-rls-verification.sql` | **25/25 PASS** |
| `scripts/remote-notification-lifecycle-verification.sql` | **42/42 PASS** |
| `scripts/remote-account-management-verification.sql` | **12/12 PASS** |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run build` | Success |

New regression files: `tests/unit/role-visibility-model.test.mjs` (access matrix + anti-broadening
proof), `tests/unit/sql-function-parameter-ambiguity.test.mjs` (statement-scoped 42702 detector),
`tests/unit/phase-4c-notifications.test.mjs`.

---

## 7. Role Visibility Findings

| Viewer | Target | Assignment | Result | Enforced by |
| --- | --- | --- | --- | --- |
| Reporter (owner) | own report | — | may view | `can_view_report` branch 2 |
| Another student | someone else's report | — | **may not view** | branches 2 and 3 both fail → `FALSE` |
| Technician | assigned report | `assigned` / `in_progress` / `on_hold` / `completed` | may view | branch 3 |
| Technician | assigned report | `declined` | **may not view** | branch 3 excludes declined |
| Technician | report assigned to another technician | — | **may not view** | `a.technician_id = auth.uid()` |
| Technician | a report they are assigned to, reported by someone else | `assigned` | may view | branch 3 |
| `coordinator` / `administrator` / `management` | any report | — | may view | branch 1 |
| Reporter who is also a technician | own report | — | may view | branch 2 applies regardless of role |
| Unauthenticated (`anon`) | any report | — | **may not view** | 25/25 RLS checks; 0 rows, not an error |

**Access is not broadened.** Two independent tests assert this: the executable access-matrix
model, and a source-level check that the effective SQL does **not** contain
`a.report_id = a.report_id` and has exactly three visibility branches.

---

## 8. KPI Accuracy Findings

| KPI | Rule | Status |
| --- | --- | --- |
| `totalActive` | not `verified`, not `cancelled` (a completed report stays active pending verification) | Correct; matches the approved business decision |
| `pendingReview` | `submitted` OR `under_review` | Correct; identical to the "Pending Review" filter tab |
| `inProgress` | `assigned` OR `in_progress` OR `on_hold` | Correct; identical to the "In Progress" filter tab |
| `resolvedThisWeek` | `verified` **and** `updated_at` inside the Philippine calendar week | Correct; `created_at` is never used |
| `urgentHazards` | `is_urgent_hazard` **OR** `confirmed_priority = 'critical'` | Correct; identical to the "Urgent & Critical" filter tab |
| "Campus Facilities / N Zones" | Complete RLS-visible set, active reports only | Fixed; refuses to publish a truncated count |
| "All Active (N)" tab | The authoritative server-side total | Fixed; the dashboard discloses a truncated page |

A regression test asserts that each KPI status set is byte-identical to the corresponding UI
filter, so the two cannot drift apart. A failed KPI query renders **"Unavailable"**, never `0`.

---

## 9. Verification Status and Remaining Blockers

**Verified locally:** the whole DAL/action/component path against mocked clients (189 unit
tests); the visibility model as an executable matrix; the SQL defect class with a static
detector; the build, the type check and the lint.

**Verified against the remote:** every database behaviour, using a role-simulation harness that
switches to the real `authenticated` role with a simulated JWT and always rolls back —
25/25 RLS checks, 42/42 lifecycle checks, 12/12 account-management checks.

**Not verified (needs an authorized authenticated session):**

| Behaviour | Blocker |
| --- | --- |
| A live submission creating a real report row | No authorized session; creating remote test records is out of scope |
| A live attachment upload to the `report-attachments` bucket | Same |
| The authenticated UI rendering real data in a browser | Same |
| A live role change committed to the remote | The harness proves the command; the transaction is rolled back by design |

**No remaining database-side blocker for the technician workflow.** The 42702 defect is repaired
and applied; the lifecycle, the assignment rules, the completion contract, the verification
contract, the audit trail and the privilege posture are all verified against the live database.
