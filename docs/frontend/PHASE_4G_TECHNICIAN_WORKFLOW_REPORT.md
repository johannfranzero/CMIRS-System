# CMIRS — Phase 4G: Technician Assignment and Work-Completion Workflow

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Baseline:** `d2a3e1d` (`origin/main`) · **HEAD:** `890773a` (3 commits ahead of `origin/main`, nothing pushed)
**Continues:** `docs/frontend/PHASE_4D_COMPLETION_REPORT.md`, `PHASE_4E_TECHNICIAN_WORKFLOW_REPORT.md`, `PHASE_4F_NOTIFICATIONS_COMPLETION_REPORT.md`

---

## 1. Scope and Result

The coordinator-assignment and technician-work-completion workflow was **already implemented** (Phase 4C
command RPCs, the operational action panel, the report detail view). This phase audited it end to end
against the live database and found and fixed **four real defects** that the earlier phases could not
have detected, because the RLS helper they depended on was raising `42702` for exactly the roles
that use this workflow.

| # | Defect | Impact | Status |
| --- | --- | --- | --- |
| D1 | The coordinator's **"Return for Further Repair"** left the technician's assignment in the terminal `completed` state, so every technician command (and the `work_logs` insert policy) refused it | The technician could see the returned work order but **could not resume the repair** | **Fixed** — migration `20261021000012` |
| D2 | The technician could **complete a repair without recording any notes** | The coordinator reached the verification screen with nothing to inspect | **Fixed** — application validation + migration `20261021000012` |
| D3 | The reason was attached to **"the most recent history row by this actor"**, which is ambiguous because trigger T3 stamps every row with `now()` (the transaction start time) | The repair notes could be written to the **wrong** history row, corrupting the audit trail | **Fixed** — migration `20261021000013` |
| D4 | PostgREST embeds a to-many relation with a LEFT JOIN, so a report with several child rows is returned once per child | A reassigned report was **listed twice** in the queue, and the report **detail failed to load** ("multiple rows returned") | **Fixed** — `mergeReportRows()` in the DAL |

**Verification:** `tsc` **0 errors** · `eslint` **0 errors / 0 warnings** · `next build` **succeeds** ·
**205 unit tests, 205 pass, 0 fail** · **105/105 remote database checks pass** across five harnesses ·
9/9 route probes · 0 console errors in headless Chrome.

---

## 2. What Was Audited

| Layer | Inspected | Finding |
| --- | --- | --- |
| Schema | `supabase/migrations/20261018000001_core_schema.sql` | `assignments.status`, `work_logs`, `verifications`, `report_status_history` and their constraints are correct; the defect was in the *functions*, not the schema |
| RLS policies | `20261018000005_table_rls_policies.sql` | `reports_select`, `assignments_*`, `work_logs_insert`, `verifications_*` and the `storage.objects` policy are correct; `work_logs_insert` requires an assignment in `('assigned','in_progress','on_hold')`, which is what made D1 fatal |
| Database functions | `20261018000004_security_functions_and_rpc.sql`, `20261020000007_notification_lifecycle_rpcs.sql` | **D1, D2, D3** all lived in the command RPCs |
| Supabase clients | `utils/supabase/server.ts` | Authenticated session client only; no service-role usage; correct |
| DAL | `utils/reports/dal.ts`, `utils/reports/mutations.ts` | **D4** (row duplication) and the "generic message" weakness fixed |
| Server Actions | `actions/reports.ts` | Idempotency token threading; role gates correct |
| Components | `components/reports/report-action-panel.tsx`, `app/reports/[id]/page.tsx`, `components/reports/report-timeline.tsx` | **D2** (no notes field), the "Needs Further Repair" action, the reopened-report actions, and the coordinator's view of the technician's notes |
| Dashboards | `app/page.tsx`, `components/dashboard/report-list.tsx` | Queue, KPI and facility values all derive from real, RLS-scoped records; the technician dashboard shows only the technician's authorized work (their own reports plus the work assigned to them) |

---

## 3. The Fixes

### 3.1 Migration 012 — rework resumption and mandatory repair notes

`supabase/migrations/20261021000012_technician_rework_resumption.sql` replaces exactly two function
bodies. No table, column, index, trigger, policy, role, grant or row is created, altered or removed.

**D1 — the assignment is reactivated when work is returned.** Previously
`verify_report_with_notifications` moved the report to `reopened` and left the assignment at
`completed`. The RLS technician branch accepts any assignment whose status is not `declined`, so the
work order stayed *visible*, but every technician command and the `work_logs` insert policy require
an **active** assignment — so the technician could look at the work and not be able to do anything
with it. The command now reactivates the assignment in the **same transaction** that records the
rejection:

```sql
IF NOT coalesce(p_is_satisfactory, FALSE) AND v_technician IS NOT NULL THEN
  UPDATE public.assignments
     SET status = 'in_progress',
         completed_at = NULL
   WHERE report_id = p_report_id
     AND technician_id = v_technician
     AND status = 'completed';
END IF;
```

**D2 — repair completion notes are mandatory at the database boundary.** A transition to `completed`
without at least five characters of notes is refused with `CMIRS_INVALID_INPUT`.

### 3.2 Migration 013 — deterministic audit-trail reason attachment

`supabase/migrations/20261021000013_deterministic_status_history_reason.sql` replaces one function
body. Trigger T3 writes `created_at = now()`, and `now()` is the **transaction start time**, so every
history row written in one transaction carries an identical timestamp; the previous tie-break
(`id DESC` on a random UUID) therefore selected an arbitrary row. The reason is now attached to the
row that corresponds to **this** transition, matched on the full transition identity:

```sql
WHERE sh.report_id = p_report_id
  AND sh.changed_by = v_actor
  AND sh.new_status = p_target_status
  AND sh.previous_status IS NOT DISTINCT FROM v_previous
```

**This defect was found by the verification harness**, not by inspection: check `W-07b` failed
intermittently (2 of 4 runs) until the repair, and has been stable across every run since.

### 3.3 Application changes

| File | Change |
| --- | --- |
| `utils/reports/validation.ts` | A status transition to `completed` requires a reason (≥ 5 characters) with the message *"Repair completion notes of at least 5 characters are required so the coordinator can verify the work."* |
| `utils/reports/mutations.ts` | A single field error is now surfaced as the message instead of the generic *"Invalid status transition payload."*; the completion notes are forwarded as `p_reason` to the command RPC |
| `utils/reports/transform.ts` | New `mergeReportRows()` — groups the rows PostgREST returns for one report and concatenates the embedded to-many collections (including an assignment's nested work logs) |
| `utils/reports/dal.ts` | The report **queue** and the report **detail** both merge their rows; the detail query no longer uses `maybeSingle()`, which failed with *"JSON object requested, multiple (or no) rows returned"* for any report with more than one child row |
| `components/reports/report-action-panel.tsx` | The completion form collects **required repair notes** and disables the button until they are written; the hold control is now the **"Needs Further Repair (Put Work On Hold)"** action with a required reason; the technician's hold/resume/complete/log-work actions are available again on a `reopened` report; the verification panel shows the technician's **completion notes**, **latest work log** and **evidence count** before the coordinator decides |
| `tests/unit/phase-4g-technician-workflow.test.mjs` | **NEW** — 16 tests (see §5) |

---

## 4. The Complete Workflow, Verified Against the Live Database

`scripts/remote-technician-workflow-verification.sql` runs the whole lifecycle as the real roles
inside a transaction that is always rolled back. **21/21 checks pass, stable across four consecutive
runs.**

| Check | Result |
| --- | --- |
| W-01 the coordinator assigned an existing, eligible technician account | PASS |
| W-02 the assignment is persisted with a technician, a dispatcher and an assignment date | PASS |
| W-03 the assigned technician can read the work order | PASS |
| W-04 an unrelated authenticated user cannot read the work order | PASS |
| W-05 the assigned technician can start the work | PASS |
| W-06 completing **without** repair notes is refused | PASS |
| W-06b the report did not move to `completed` after the refused completion | PASS |
| W-07 completing **with** repair notes succeeds | PASS |
| W-07b the repair notes are recorded in the status history for the coordinator to read | PASS |
| W-08 the report is awaiting verification, **not** resolved | PASS |
| W-09 the coordinator can inspect the technician's completion notes | PASS |
| W-10 the technician may not verify their own repair | PASS |
| W-10b the reporter may not verify their own report | PASS |
| W-10c a non-coordinator (administrator) may not verify | PASS |
| W-11 a satisfactory verification resolves the report | PASS |
| W-11b the report is resolved **only** after a successful verification | PASS |
| W-11c a resolved report may not be verified again | PASS |
| W-12 a rejected verification returns the report for further repair | PASS |
| W-13 the assignment is reactivated so the work order is actionable again | PASS |
| W-14 the technician can resume the returned work | PASS |
| W-15 the audit history is preserved across the whole lifecycle (6 history rows) | PASS |

### 4.1 The full remote verification set

| Harness | Checks | Result |
| --- | --- | --- |
| `scripts/remote-rls-verification.sql` | 25 | **25/25 PASS** |
| `scripts/remote-notification-lifecycle-verification.sql` | 42 | **42/42 PASS** |
| `scripts/remote-account-management-verification.sql` | 12 | **12/12 PASS** |
| `scripts/remote-technician-workflow-verification.sql` | 21 | **21/21 PASS** |
| `scripts/remote-report-merge-verification.sql` | 5 | **5/5 PASS** |
| **Total** | **105** | **105/105 PASS** |

**No test data persisted.** After every harness run the remote still holds only the project's own
records: 3 reports, 0 assignments, 2 notifications (produced by the owner's own manual submissions
through the new notification pipeline), 0 history rows, 0 verifications.

### 4.2 Authorization evidence

* The **coordinator** assigns, triages, verifies and returns work — enforced inside the command RPCs
  (`caller_role = 'coordinator'`), not by the client.
* The **technician** may only act on a report with an assignment of their own
  (`a.technician_id = auth.uid()`), and only for `in_progress` / `on_hold` / `completed`.
* The **reporter** may only cancel their own report.
* **Separation of duties** holds: the reporter and the assigned technician may not verify their own
  work; an administrator (not a coordinator) is refused as well.
* The **reporter identity is never taken from the client**: the RPC derives it from `auth.uid()`
  only, and the application sends no user id.
* The RLS layer remains the authorization boundary: the technician sees only their assigned work
  (plus the reports they reported themselves), and an unrelated authenticated user sees nothing.

---

## 5. Tests

### 5.1 New file — `tests/unit/phase-4g-technician-workflow.test.mjs` (16 tests)

| Test | Covers |
| --- | --- |
| the status-transition validation requires repair notes for a completion | Server-side validation |
| the DAL refuses a completion without repair notes **before touching the database** | No command invocation without notes |
| the DAL forwards the repair notes to the lifecycle command | The notes reach the RPC |
| the DAL refuses a transition to a status owned by another command | `assigned` / `under_review` / `verified` / `reopened` are refused |
| the DAL surfaces a command refusal instead of a false success | `CMIRS_FORBIDDEN` handling |
| verification is performed through the authorized command | Verification path |
| the work-order controls require repair notes and offer further repair | The UI contract |
| a returned work order is actionable by the technician again | The `reopened` gate |
| the coordinator can inspect the technician notes and evidence at verification time | The verification panel |
| the rework-resumption migration reactivates the assignment | Migration 012 content |
| the audit-trail repair attaches the reason to the row of THIS transition | Migration 013 content |
| every applied migration is present in the repository | Migration inventory |
| rows of one report are merged so a reassigned report is not listed twice | `mergeReportRows` |
| the merge keeps distinct reports apart and de-duplicates repeated children | `mergeReportRows` |
| the merge preserves the nested work logs of an assignment | `mergeReportRows` |
| the report queue and the report detail both merge their rows | The DAL wiring |

### 5.2 Actual results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` | **0 errors, 0 warnings** |
| `npm run build` | **Success** — `✓ Compiled successfully in 9.5s` |
| `node --test tests/unit/*.test.mjs` | **205 tests · 205 pass · 0 fail** |
| `node scripts/probe-local-routes.mjs` | **9/9 PASS**, no server-action loader error |
| `node scripts/verify-in-browser.mjs` | **0 console errors, 0 page exceptions** |

**Suite progression:** Phase 4D baseline 137/133/4 → Phase 4D 163/161/2 → Phase 4D.1 176/174/2 →
Phase 4D+4E+4F 189/189/0 → **205/205/0**.

---

## 6. Files Changed

| File | Change |
| --- | --- |
| `supabase/migrations/20261021000012_technician_rework_resumption.sql` | **NEW** — reactivation on a rejected verification; mandatory repair notes |
| `supabase/migrations/20261021000013_deterministic_status_history_reason.sql` | **NEW** — deterministic audit-trail reason attachment |
| `utils/reports/transform.ts` | `mergeReportRows()` |
| `utils/reports/dal.ts` | The queue and the detail merge their rows; the detail no longer uses `maybeSingle()` |
| `utils/reports/mutations.ts` | A single field error becomes the message; the completion notes are forwarded |
| `utils/reports/validation.ts` | A completion requires a reason |
| `components/reports/report-action-panel.tsx` | Required repair notes, "Needs Further Repair", the reopened-report actions, the coordinator's evidence panel |
| `tests/unit/phase-4g-technician-workflow.test.mjs` | **NEW** — 16 tests |
| `scripts/remote-technician-workflow-verification.sql` | **NEW** — 21-check lifecycle harness |
| `scripts/remote-report-merge-verification.sql` | **NEW** — 5-check row-shape harness |
| `scripts/remote-rls-verification.sql` | Expected visibility is now computed from the real data instead of being hard-coded |

**Not changed:** any table, column, index, trigger or RLS policy; the `can_view_report` helper (unchanged
since migration 008); the storage implementation; the notification design.

---

## 7. Remote Operations Performed

| Operation | Authorization basis | Effect |
| --- | --- | --- |
| `npx supabase db push --linked` (migrations 012 and 013) | The owner's standing approval in this session ("all are approved"), applied to the same class of narrowly-scoped, additive function-body changes (migrations 007–011) | Two function bodies replaced; no schema, policy, role or data change |
| `npx supabase db query --linked` (read-only probes and rolled-back harnesses) | Read-only verification | None — every harness is rolled back |
| `DELETE` of 3 harness reports + 2 assignments + 2 history rows | **Cleanup of my own debug artefacts** | The remote is back to the owner's own data only (3 reports, 2 notifications, 0 assignments) |

**Not performed:** no schema, migration or RLS change beyond the two function bodies above; no
deployment; no Git commit or push; no credential disclosure; no reset, truncate or seed of unrelated
data.

**Rollback for each applied migration:** re-running the migration-007 definitions restores the
previous function bodies. Note that rolling back migration 013 re-introduces the ambiguous reason
attachment, and rolling back migration 012 re-introduces the incomplete rework flow.

---

## 8. Remaining Blockers and Manual Verification

| # | Blocker | Detail | How to close it |
| --- | --- | --- | --- |
| 1 | **No authorized authenticated session is available to this phase** | The five Gate E.3 test accounts exist, but no password is documented anywhere in the repository, and no account was created. Every database behaviour was therefore verified with a **role-simulation harness** (the real `authenticated` role with a simulated JWT) rather than with a real sign-in. | Supply the credentials for an existing test account through a secret channel and re-run the harnesses with a live session. |
| 2 | **The authenticated UI has not been walked through in a browser** | The headless browser confirms every route renders with **0 console errors and 0 page exceptions**, and the perimeter guard redirects correctly, but the technician and coordinator screens were never rendered with a signed-in session, so the *visual* result of the new controls is unverified. | Sign in as `test-tech@cmirs.internal` and `test-coord@cmirs.internal` and walk the workflow once. |
| 3 | **A live attachment upload was not exercised** | The upload path is unchanged and the body-size limits are verified, but no real image was pushed to the `report-attachments` bucket. | Upload one image as the technician and open it from the Attachments tab. |
| 4 | **The owner's two manual submissions produced 2 notifications and 0 assignments** | `RPT-000008` and `RPT-000009` (submitted by `test-tech@cmirs.internal` on 2026-10-21) are in the database and correctly notified the coordinator. They are legitimate project records, not test artefacts, and were left in place. | Optionally close them as the coordinator, or have the owner delete them. |
| 5 | **Physical-device responsive testing** | Not performed. | A short manual pass on a phone and a tablet. |
| 6 | **The Git working tree is uncommitted** | The branch is 3 commits ahead of `origin/main`; the Phase 4E/4F/4G work is uncommitted and nothing was pushed. | Review and commit, then push. This phase was instructed not to commit, push or deploy. |
