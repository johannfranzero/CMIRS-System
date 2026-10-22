# CMIRS — Phase 4H: Technician Role, Assignment, and Completion Workflow

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Continues:** `docs/frontend/PHASE_4G_TECHNICIAN_WORKFLOW_REPORT.md`, `docs/frontend/PHASE_4D_1_VERIFICATION_REPORT.md`
**Reference:** the screen recording of 2026-10-21

---

## 1. Summary of the Three Observed Issues

| # | Observed | Investigation | Outcome |
| --- | --- | --- | --- |
| 1 | A logged-in **Maintenance Technician** could reach **Submit Report** and filed a new report (RPT-000045, RPT-000044, RPT-000008, RPT-000009 — all four were submitted by `test-tech@cmirs.internal`) | The role matrix in `docs/ROLES.md` and the decision register in `docs/database-design/OPEN_DECISIONS.md` **contradict each other** on this point — see §2 | **Fixed.** Submission is now restricted to the reporter roles and enforced **on the server** |
| 2 | **RPT-000045** stayed `submitted` / "Pending Triage" with **no active technician assignment** | The assignment path was probed against the live database: the coordinator can read the technician directory, can read the report, and the assignment command succeeds. The report simply had not been assigned yet | **Mechanism verified working** (probe 5/5). The report has since been assigned in the live system (see §5) |
| 3 | The technician's **Operational Action Controls** showed only "Cancel Report" — no Start Work / Mark as Completed / Needs Further Repair | Two causes: (a) the work controls are correctly gated on an **active assignment**, and RPT-000045 had none; (b) the panel opened on an `overview` tab that renders **nothing**, so the viewer had to guess which tab held their action | **Fixed.** The panel now opens on the tab that holds the viewer's next action and states what the report is waiting for |

**Verification:** `tsc` **0 errors** · `eslint` **0 errors / 0 warnings** · `next build` **succeeds** ·
**221 unit tests, 221 pass, 0 fail** · **107/107 remote database checks pass** across six harnesses ·
9/9 route probes · 0 console errors in headless Chrome.

---

## 2. Role Permissions — What the Documentation Actually Says

The brief asked me to inspect the intended permissions before restricting anything. The
documentation is **internally contradictory**, and the contradiction is the root of issue 1.

| Source | Statement |
| --- | --- |
| `docs/ROLES.md` — role-permission matrix | "Submit new report": Student ✅ · Coordinator ✅ · **Technician ✅** · Administrator — · Management — |
| `docs/ROLES.md` — Maintenance Technician responsibilities | "View reports assigned to them. Update the status of their assigned work. Log work performed…" — **submission is not listed** |
| `docs/ROLES.md` — role summary | Student "Submit and track maintenance reports"; Technician "Inspect and perform assigned repairs" |
| `docs/database-design/OPEN_DECISIONS.md:40` | `PD-R6 | ROLES.md | **OWNER APPROVED** | All authenticated roles may submit reports` |
| `docs/database-design/DATA_DICTIONARY.md` | technician / administrator / management — "May submit reports (APPROVED PD-R6)"; `reporter_id` — "Any authenticated role may submit (APPROVED PD-R6)" |
| `docs/ROLES.md` — PD-R6 | Still listed as an **open** decision: "Currently marked as not permitted. Decide whether administrative users should also be able to report maintenance issues." |
| `config/navigation.ts` (implementation) | The `Submit Report` entry carried `allowedRoles: USER_ROLES` with the comment "Approved PD-R6: All 5 roles permitted to submit" |

So a prior decision (PD-R6) allowed every role to submit, it was implemented that way, and
`docs/ROLES.md` was never updated to match. **Your instruction in this task is the most recent
statement of intent from the owner**, so it takes precedence, and I applied it and corrected the
records so the documentation and the implementation now agree:

**Permitted to submit:** Student / School Personnel, Maintenance Coordinator (the coordinator may
raise a report on the user's behalf).
**Not permitted:** Maintenance Technician, School Administrator, School Management.

`docs/ROLES.md` (matrix, all four role definitions, PD-R6, and the stale status header),
`docs/database-design/OPEN_DECISIONS.md` (PD-R6 → withdrawn) and
`docs/database-design/DATA_DICTIONARY.md` (role table and the `reporter_id` note) were all
updated to record this, dated 2026-10-21.

> **If you intended PD-R6 to stand** (all five roles may submit), say so and I will revert the
> restriction — it is a single constant, `REPORT_SUBMITTER_ROLES` in `types/auth.ts`, plus the
> three enforcement points and the documentation rows.

---

## 3. What Was Implemented

### A. Role permissions — enforced on the server

| File | Change |
| --- | --- |
| `types/auth.ts` | **NEW** `REPORT_SUBMITTER_ROLES` (`student_personnel`, `coordinator`) and `canSubmitReport(role)` — the single source of truth |
| `actions/reports.ts` | `submitReportAction` **refuses** a submission from any other role, before the DAL and before the database command are reached. The message is explicit and names the alternative |
| `app/reports/new/page.tsx` | The route redirects a role that may not report to `/unauthorized` |
| `config/navigation.ts` | Both submission entries ("Report Issue" and "Submit Report") are restricted to the reporter roles |
| `components/layout/mobile-nav.tsx` | The elevated **quick-submit** control — the one the technician actually used — is role gated; for other roles the slot is disabled and labelled rather than a live link |
| `app/page.tsx` | The dashboard "Submit Report" call to action is role gated |
| `components/dashboard/report-list.tsx` | The empty-queue "Submit a Maintenance Report" action is role gated (it was previously limited to students only, so a coordinator saw no call to action) |

**Defense in depth at the database layer** — `supabase/migrations/20261021000014_restrict_report_submission_roles.sql`
is **prepared and locally validated but NOT applied** (applying a remote RLS change needs your
explicit authorization). It replaces the `reports_insert` policy with the same predicate plus
`public.get_user_role() IN ('student_personnel', 'coordinator')`. The application path is
unaffected: `public.submit_report_with_notifications(...)` is `SECURITY DEFINER` and executes as the
table owner, so RLS is not applied to it.

### B. Coordinator assignment

The path was traced end to end and **works**; it is verified against the live database by
`scripts/remote-coordinator-assignment-probe.sql` (5/5 PASS):

| Probe | Result |
| --- | --- |
| The coordinator can read the eligible technician directory (`profiles` where `role='technician'` and `is_active`) — 1 real account, no mock data | PASS |
| The coordinator can read a submitted report | PASS |
| The assignment command succeeds for a submitted report | PASS |
| After the assignment the report is `assigned` with an active assignment row | PASS |
| A duplicate assignment of the same technician is refused as a no-op (approved decision P-05) | PASS |

The assignment persists the technician, the dispatcher and the assignment date, moves the report to
`assigned`, and notifies the technician — all in one database transaction.

### C. Technician work controls

| Requirement | Implementation |
| --- | --- |
| Work actions only for the **assigned** technician and only when the status permits | `isAssignedTech` is derived from the report's own active assignment (`assignmentsList` → `technicianId === user.id`); every gate (`canTechStart`, `canTechResume`, `canTechComplete`, `canTechHold`, `canTechLogWork`) requires the technician role **and** the assignment **and** an eligible status |
| **Start Work** | `transition_report_status_with_notifications` → `in_progress`; the assignment follows and `started_at` is stamped |
| **Mark as Completed** | → `completed`. **Repair notes are required** — the form collects them, the server validates them, and the database refuses a completion without at least five characters (migration 012) |
| **Needs Further Repair** | The hold control, relabelled **"Needs Further Repair (Put Work On Hold)"**, with a **required reason** that is recorded in the status history and shown to the coordinator |
| Work notes and status history persisted in the existing model | Repair notes → `report_status_history.reason` (attached to this exact transition by migration 013); hours and descriptions → `work_logs`; assignment lifecycle → `assignments` |
| Loading / success / error states, no duplicate submissions | `useActionState` pending states on every control, an explicit error banner, the single-flight lock and the server-side idempotency token (`p_request_id`) |

### D. Completion verification

| Requirement | Implementation | Verified |
| --- | --- | --- |
| Completion sends the report for verification, never resolves it | The command moves the report to `completed`; only the verification command may move it to `verified` or `reopened` | 21/21 workflow checks, W-08 |
| The coordinator inspects the notes and evidence | The verification panel now shows the technician's **completion notes**, **latest work log** and **evidence count** before the decision | Local test + 42/42 notification checks |
| Verify or return for further work | `verify_report_with_notifications` → `verified` or `reopened` | W-11, W-12 |
| History preserved, unauthorized changes prevented | The status history is append-only; the command re-derives the actor, re-checks the role, the report state and the separation of duties | W-10, W-10b, W-10c, W-15 |

### E. A regression in my own earlier work, found and fixed

While restoring the navigation I found that the **"All Reports" entry had been lost** during the
uncommitted Phase 4E/4F work — the `/reports` queue had **no navigation entry at all**. It is
restored, and a regression test now asserts it stays.

---

## 4. The Files Changed

| File | Change |
| --- | --- |
| `types/auth.ts` | `REPORT_SUBMITTER_ROLES` + `canSubmitReport()` |
| `actions/reports.ts` | Server-side role authorization in `submitReportAction` |
| `app/reports/new/page.tsx` | Route guard → `/unauthorized` |
| `config/navigation.ts` | Both submission entries restricted; "All Reports" restored |
| `components/layout/mobile-nav.tsx` | The quick-submit control is role gated |
| `app/page.tsx` | The dashboard call to action is role gated |
| `components/dashboard/report-list.tsx` | The empty-queue call to action is role gated |
| `components/reports/report-action-panel.tsx` | Default tab per role/status, a status-aware "next step" note, `activeTab` is now a per-report override |
| `supabase/migrations/20261021000014_restrict_report_submission_roles.sql` | **NEW — prepared, validated, NOT applied** (RLS defence in depth) |
| `tests/unit/phase-4h-technician-workflow.test.mjs` | **NEW — 16 tests** |
| `scripts/remote-coordinator-assignment-probe.sql` | **NEW — 5 checks** |
| `docs/ROLES.md`, `docs/database-design/OPEN_DECISIONS.md`, `docs/database-design/DATA_DICTIONARY.md` | The submit permission is recorded consistently (PD-R6 withdrawn) |

**Not changed:** any table, column, index, trigger or RLS policy on the remote; the schema; the
notification design; the `can_view_report` helper; the existing data.

---

## 5. Live State Observed During This Work

| Record | State | Note |
| --- | --- | --- |
| `RPT-000045` | `assigned`, active assignment to `test-tech@cmirs.internal` | The coordinator assignment has since been performed in the live system. With the assignment in place the technician's **Work Order Controls** now apply and the panel opens on them |
| `RPT-000044`, `RPT-000008`, `RPT-000009` | `submitted`, reported by `test-tech@cmirs.internal` | **Left untouched** — they are legitimate project records, not test artefacts. They pre-date the restriction, so they remain valid |
| Remote totals | 5 reports · 1 assignment · 5 notifications · 1 status-history row | Unchanged by this phase; every harness rolls back |

---

## 6. Tests and Actual Results

### 6.1 New unit suite — `tests/unit/phase-4h-technician-workflow.test.mjs` (16 tests, all passing)

| Test | Covers |
| --- | --- |
| only Student / Personnel and Maintenance Coordinator may file a report | the permission table, every role, and the undefined/null cases |
| the Server Action refuses a submission from a role that may not report | the command is **never invoked** for a technician / administrator / management |
| the Server Action accepts a submission from a reporter role | the happy path, and that the reporter identity is never taken from the client |
| the submit entry points are hidden from the roles that may not report | both navigation entries, the mobile quick-submit control, the dashboard CTA, and that "All Reports" stays reachable |
| the `/reports/new` route refuses a role that may not report | the route guard |
| the coordinator assignment path uses a database-backed technician directory | the real `profiles` query, and that no fixture fallback exists |
| the assignment command refuses a technician that is not an active technician | the command error path |
| the work controls are shown only for the assigned technician | the gate and every action's precondition |
| the work-order controls offer start, complete and further repair | the three actions and the tab label |
| the panel opens on the tab that holds the viewer's next action | the technician / coordinator defaults and the hint |
| completion requires repair notes and is rejected without them | server-side validation before the command runs |
| completion moves the report to awaiting verification, never to resolved | the target status and the two forbidden ones |
| only a coordinator may verify, and verification is the resolving step | the command and its result |
| a technician cannot verify their own repair | the DAL refuses **and** the command is not invoked |
| the prepared RLS migration restricts submission to the reporter roles | the policy content and that it alters nothing else |
| the assignment probe and workflow harness exist | the verification tooling |

### 6.2 Actual results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **Success** — `✓ Compiled successfully in 4.5s`, 13/13 static pages |
| `node --test tests/unit/*.test.mjs` | **221 tests · 221 pass · 0 fail** |
| `node scripts/probe-local-routes.mjs` | **9/9 PASS**, no server-action loader error |
| `node scripts/verify-in-browser.mjs` | **0 console errors, 0 page exceptions** |

**Suite progression:** 137/133/4 (baseline) → 163/161/2 → 189/189/0 → 205/205/0 → **221/221/0**.

### 6.3 Remote verification (107 checks, all passing)

| Harness | Checks | Result |
| --- | --- | --- |
| `remote-rls-verification.sql` | 25 | 25/25 PASS |
| `remote-notification-lifecycle-verification.sql` | 42 | 42/42 PASS |
| `remote-account-management-verification.sql` | 12 | 12/12 PASS |
| `remote-technician-workflow-verification.sql` | 21 | 21/21 PASS |
| `remote-report-merge-verification.sql` | 5 | 5/5 PASS |
| `remote-coordinator-assignment-probe.sql` | 5 | 5/5 PASS |
| **Total** | **110** | **110/110 PASS** |

Every harness runs inside a transaction that is always rolled back; the remote data set is
unchanged by them.

---

## 7. Locally Tested vs Live Authenticated Behaviour

| Behaviour | How it was verified | Status |
| --- | --- | --- |
| The submit permission and its server enforcement | Unit tests against the real `submitReportAction` with a mocked client | **Locally verified** |
| The route guard, the navigation and the CTA gating | Source-level assertions in the unit suite | **Locally verified** |
| The work controls, their gating and the default tab | Source-level assertions in the unit suite | **Locally verified** |
| Completion requires notes; the report awaits verification | Unit tests + 21/21 remote lifecycle checks | **Locally and remotely verified** |
| The coordinator can read the technician directory and assign | 5/5 remote probe as the real coordinator role | **Remotely verified (role simulated)** |
| The technician can read only their assigned work | 25/25 remote RLS checks | **Remotely verified (role simulated)** |
| Separation of duties on verification | 21/21 remote checks (technician, reporter, administrator all refused) | **Remotely verified (role simulated)** |
| The live authenticated UI rendering of the work controls | — | **UNVERIFIED** — no authorized session is available to this phase, so the signed-in screens were never rendered in a browser |
| The live RLS restriction on a direct insert by a technician | — | **UNVERIFIED** — migration 014 is prepared and validated but **not applied** |

### Remaining blockers

| # | Blocker | How to close it |
| --- | --- | --- |
| 1 | **No authorized authenticated session** — the five Gate E.3 accounts exist but no password is documented anywhere, and none was created. Every database check was made with a **role simulation** (the real `authenticated` role with a simulated JWT), not a real sign-in. | Supply credentials for an existing test account through a secret channel; then sign in as `test-tech@cmirs.internal` and `test-coord@cmirs.internal` and walk the workflow once. |
| 2 | **Migration 014 is not applied**, so a direct PostgREST insert by a technician is still possible at the database layer. The application path is already blocked. | `npx supabase db push --linked --dry-run` then `npx supabase db push` — needs your explicit authorization for that operation. |
| 3 | **The signed-in UI was not walked through in a browser.** The route and console checks pass (0 errors, 0 exceptions), but the panels themselves were never rendered with a session. | Manual pass with the two test accounts. |
| 4 | **The four technician-submitted reports** (RPT-000008, 000009, 000044, 000045) pre-date the restriction. RPT-000045 is now assigned; the other three remain `submitted`. | Optionally close or cancel them as the coordinator. They were left untouched. |
| 5 | **The working tree is uncommitted** — the branch is 3 commits ahead of `origin/main`; nothing was committed or pushed. | Review, commit, push. This phase was instructed not to commit, push or deploy. |

---

## 8. Addendum — "Encountered two children with the same key" (application shell)

**Reported:** a console error on every authenticated page:
`Encountered two children with the same key, '/reports/new'` — `components/layout/sidebar.tsx:75`.

**Root cause.** The navigation is rendered with a key derived from the destination
(`key={item.href}`). When the Phase 4E/4F work replaced the "All Reports" entry
(`/reports`) with a second "Report Issue" entry pointing at `/reports/new`, the navigation
ended up with **two entries for the same destination**:

```
name: 'Report Issue',   href: '/reports/new'
name: 'Submit Report',  href: '/reports/new'
```

React therefore rendered two children with the same key in the sidebar **and** in the mobile
drawer, which React reports as an error and which can make links be duplicated or dropped.

**Fix (three parts).**

| Part | Change |
| --- | --- |
| Data | The duplicate entry was removed. The navigation is back to one entry per destination — `Dashboard`, **All Reports** (`/reports`), **Submit Report** (`/reports/new`, restricted to the reporter roles), `Notifications`, `Campus Locations`, `Operations Analytics`, `Settings`. The `/reports` queue stays reachable from the navigation, which it had lost in the earlier work. |
| Keys | Both renderers now key by `href` **and** label — `key={`${item.href}-${item.name}`}` — so a future duplicate destination degrades gracefully instead of producing an error. |
| Guard | `config/navigation.ts` asserts the invariant in development: a duplicate destination logs a clear `[CMIRS] Duplicate navigation destination "…"` error naming the entry, instead of surfacing as an anonymous React warning. |

**Verification.** Two new regression tests in `tests/unit/phase-4h-technician-workflow.test.mjs`:

1. *the navigation has no duplicate destinations* — parses the configuration and asserts every `href` is distinct.
2. *rendering the navigation produces no duplicate React key warning* — rebuilds the entries and renders them through `react-dom/server` with the sidebar's key expression, capturing `console.error` and asserting that no "same key" warning is produced.

Both tests were **proven to fail** when the duplicate entry is temporarily restored
(3 failures, including the React-level one) and pass with the fix in place.

**Final state:** `tsc` **0 errors** · `eslint` **0 errors / 0 warnings** · `next build` **succeeds**
· **223 unit tests, 223 pass, 0 fail** · headless Chrome reports **0 console errors and 0 page
exceptions** on every route.

