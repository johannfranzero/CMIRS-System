# CMIRS — Phase 4C.2 Notification Backend Implementation Specification

**Date:** 2026-10-20  
**Status:** Read-only, implementation-ready proposal. No application, migration, function, policy, remote, or test-runner change was made.  
**Scope:** Atomic in-app notification creation for approved report lifecycle commands only.

## 1. Scope and Design Basis

This specification implements the Phase 4C.1 recommendation: narrowly scoped, transaction-safe PostgreSQL command RPCs invoked by the existing authenticated Server Actions. It does not authorize implementation yet.

The local project requirements mandate in-app notifications and exclude email, SMS, and push for MVP (`README.md` D7; `docs/WORKFLOW.md:342`). Existing `notifications` RLS intentionally permits only recipient reads and `is_read` acknowledgment; it has no authenticated insert path (`supabase/migrations/20261018000005_table_rls_policies.sql:433`). Therefore, a post-mutation TypeScript insert is both non-atomic and blocked by the intended security model.

All proposed names, tables, migrations, and function contracts below are recommendations. Existing behavior is explicitly labelled **Current**; future behavior is labelled **Proposed**.

## 2. Current Lifecycle Operation Trace

| Operation | Current caller / Server Action | Current DAL function and writes | Current authorization | Existing focused tests | Notification status |
|---|---|---|---|---|---|
| Report creation | Any active authenticated role → `submitReportAction` | `createReportRecord`: one `reports` insert; T2 assigns report number | Server active-profile check; `reports_insert` requires `reporter_id = auth.uid()`, `submitted`, null priority | `report-actions.test.mjs` submit tests; `mutation-dal.test.mjs` creation/validation/error tests | None |
| Triage / priority | Coordinator → `triageReportAction` | `triageReportRecord`: updates `confirmed_priority` and `status` (`under_review` or `assigned`) | Server role check; `reports_update_coordinator` | Triage tests in both files | None |
| Assignment / reassignment | Coordinator → `assignTechnicianAction` | `assignTechnicianToReport`: update prior active assignments, insert new assignment, then update report to `assigned` | Server role/active-technician checks; assignment/report policies | Assignment/reassignment and partial-failure tests in both files | None |
| Assignment decline | Assigned technician → `declineAssignmentAction` | `declineAssignmentViaRpc`: calls existing `decline_assignment` RPC | Server role check; RPC verifies caller owns an `assigned` assignment | Decline tests in both files | None; documented decline event/type remains unapproved |
| Work status / cancellation | Reporter, technician, or coordinator → `transitionReportStatusAction` | `transitionReportStatusRecord`: may update an assignment, then updates report status; coordinator cancellation separately cancels active assignments | Server state/role checks; reports and assignments update policies | Status-transition tests in both files | None |
| Work log | Technician → `createWorkLogAction` | `createWorkLogRecord`: one `work_logs` insert | Server role/assignment check; `work_logs_insert` | Work-log tests in both files | No documented notification event |
| Verification / resolution | Coordinator → `verifyReportAction` | `verifyReportRecord`: insert verification, then update report to `verified`/`reopened` | Server separation-of-duties checks; `verifications_insert_coordinator` | Verification/rejection tests in both files | None |
| Comments / request for information | No implemented UI/action | No current application writer; schema/RLS permits comment insert | `report_comments_insert` supports documented roles | RLS source/test planning only | Deferred; no request classification or recipient rule |

### Current database writers and transaction boundaries

- **Application writes:** `utils/reports/mutations.ts` is the sole application DAL writer for reports, assignments, verifications, work logs, and the existing decline RPC. `actions/reports.ts` is the only current lifecycle Server Action module.
- **Database writers:** T1 updates timestamps; T2 generates report numbers; T3 inserts status history; T4 creates a default profile; T5 locks attachment counts. Existing RPCs are `soft_delete_attachment` and `decline_assignment` (`20261018000003_triggers.sql`, `20261018000004_security_functions_and_rpc.sql`).
- **Local SQL fixtures:** `supabase/tests/database_test_suite.sql` writes report/assignment rows directly inside `BEGIN`/`ROLLBACK`. It is a local schema test fixture, not an application writer.
- **Current defect relevant to this work:** assignments, cancellation, and verification span distinct PostgREST requests. A later failure can leave earlier source mutations committed; adding a separate notification request cannot make that atomic.

## 3. Current-to-Proposed Architecture

### Current

`Server Action → authenticated Supabase client → one or more table INSERT/UPDATE calls → existing triggers/RLS`

The server validates input and role, but authenticated clients can also call RLS-permitted table writes directly. Required notification creation cannot be enforced.

### Proposed

`Server Action → authenticated Supabase client → narrow lifecycle command RPC → locked/authorized source mutation + notification helper + existing triggers → one committed result`

The Server Action remains responsible for form parsing, canonical TypeScript validation, sanitized UX errors, and cache revalidation. The RPC becomes authoritative for identity, role, ownership, state, recipient selection, mutation, and notification delivery. No application layer supplies recipient IDs, notification copy, actor IDs, or a privileged client.

## 4. Common RPC Contract Rules

### Common input and output rules

- All IDs are `uuid`; text values use the existing validation bounds before invoking an RPC.
- Every **new** notification-bearing command receives `p_request_id uuid`: a client/server-generated idempotency token. This is a proposed new contract; current payloads do not contain it.
- No RPC accepts `reporter_id`, `actor_id`, `recipient_id`, role, notification type, title, message, report number, or event key from the caller.
- Success returns only the existing action’s narrow identifiers/status/timestamps. It never returns notification rows, recipient IDs, or notification body text.
- Failure raises a controlled, generic database error for one of: unauthenticated/inactive, forbidden, not found, invalid state/input, idempotency-key mismatch, or internal delivery failure. The Server Action maps it to existing sanitized form-state errors and does not expose SQL/RLS details.

### Proposed idempotency support

The current schema cannot safely replay an unknown response for report creation, nor can it record a command-wide retry. Add a proposed private table such as `public.lifecycle_command_receipts`:

| Column | Purpose |
|---|---|
| `id uuid PK` | Durable command/event namespace. |
| `actor_id uuid NOT NULL` | Derived from `auth.uid()`. |
| `command_name text NOT NULL` | Fixed allowed command name. |
| `request_id uuid NOT NULL` | `p_request_id` supplied by the authenticated caller. |
| `request_hash text NOT NULL` | Server-computed canonical payload hash; prevents reuse with different arguments. |
| `report_id uuid NULL` | Result/report scope only. |
| `result jsonb NOT NULL` | Minimal successful return fields only; not notification content. |
| `created_at timestamptz NOT NULL` | Audit/expiry basis. |

Create a unique key on `(actor_id, command_name, request_id)`. Within the command transaction, insert/select the receipt under lock. A matching committed receipt returns its stored minimal result without repeating source changes. A different hash fails safely. A failed command rolls back its receipt, source changes, and notification rows together.

Add a nullable immutable `event_key text` to `public.notifications` with a unique partial index on `(event_key, recipient_id)` where `event_key IS NOT NULL`. The command derives keys from its receipt ID and event type, for example `command:<receipt-id>:report_assigned`; a command with multiple event types uses one distinct key per type. Existing rows must not be presumed absent, so nullable/partial migration is required before any non-null enforcement.

## 5. Proposed RPC Contract Table

| Proposed RPC | Exact parameters | Success return | Current operation replaced | Notification-bearing event(s) | Approval dependency |
|---|---|---|---|---|---|
| `submit_report_with_notifications` | `p_title text`, `p_description text`, `p_category_id uuid`, `p_location_id uuid`, `p_is_urgent_hazard boolean`, `p_request_id uuid` | `report_id uuid`, `report_number text`, `status public.report_status`, `created_at timestamptz` | `createReportRecord` | `report_submitted` | All-active-coordinator audience; urgent presentation |
| `triage_report_with_notifications` | `p_report_id uuid`, `p_confirmed_priority public.priority_level`, `p_target_status public.report_status`, `p_request_id uuid` | `report_id uuid`, `status public.report_status`, `confirmed_priority public.priority_level` | `triageReportRecord` | `status_changed`; optionally `priority_changed` | Priority event and `assigned` without assignment semantics |
| `assign_or_reassign_report_with_notifications` | `p_report_id uuid`, `p_technician_id uuid`, `p_notes text`, `p_request_id uuid` | `assignment_id uuid`, `report_id uuid`, `technician_id uuid`, `status public.assignment_status`, `was_reassignment boolean` | `assignTechnicianToReport` | `report_assigned` **or** `report_reassigned` | Same-technician reassignment/self-notification |
| `transition_report_status_with_notifications` | `p_report_id uuid`, `p_target_status public.report_status`, `p_reason text`, `p_request_id uuid` | `report_id uuid`, `previous_status public.report_status`, `new_status public.report_status` | `transitionReportStatusRecord` | `status_changed`, `verification_required`, `report_cancelled` as applicable | Completed dual-event semantics; actor suppression |
| `verify_report_with_notifications` | `p_report_id uuid`, `p_is_satisfactory boolean`, `p_notes text`, `p_request_id uuid` | `verification_id uuid`, `report_id uuid`, `is_satisfactory boolean`, `new_status public.report_status` | `verifyReportRecord` | `verification_complete` **or** `verification_failed` | Actor suppression; affected-technician definition |

`decline_assignment`, work-log insertion, attachments, and comments are not replaced in this notification backend slice. Comments and declined assignment require separately approved event semantics before their write paths are changed.

## 6. Detailed RPC Specifications

### 6.1 `submit_report_with_notifications`

- **Identity/authorization:** Require non-null `auth.uid()` and an active profile with one of the five canonical roles. Derive `reporter_id` exclusively from `auth.uid()`.
- **State and source checks:** Validate title/description/category/location/urgent values against existing application/database rules. Preserve current initial state: `status = 'submitted'`, `confirmed_priority = NULL`. Preserve T2 report-number generation.
- **Transaction:** lock/create the idempotency receipt; insert report; query active coordinator profiles; insert notification rows; store minimal return result; commit once.
- **Recipients:** active profiles where role is `coordinator`. Do not use an unapproved on-call/team concept. De-duplicate recipient IDs. Whether the reporter receives a self-notification is not documented; none is created unless separately approved.
- **Event/payload:** `report_submitted`; title and message contain only a generic submission label, report number, and optional urgent marker. Do not include description, reporter email, attachments, or location detail beyond what approval permits.
- **Idempotency:** one receipt per actor/request ID; delivery key `command:<receipt-id>:report_submitted`. A replay returns the original report result and does not create new report or notification rows.

### 6.2 `triage_report_with_notifications`

- **Identity/authorization:** active authenticated coordinator only; derive actor from `auth.uid()`.
- **State and source checks:** lock the report; reject `verified`/`cancelled`; preserve current accepted target values only (`under_review` or `assigned`). The current code permits `assigned` without a technician assignment, so the specification must not pretend an assigned technician exists.
- **Transaction:** receipt lock; read old status/priority; update report; T3 writes status history if status changes; create approved events; store result; commit.
- **Recipients/events:** a changed status may create `status_changed` for the reporter and an active assigned technician **only if one exists**. A priority event is created only if `confirmed_priority` actually changes and the owner approves `priority_changed` for this first backend slice.
- **Idempotency:** `command:<receipt-id>:status_changed` and, if approved, `command:<receipt-id>:priority_changed`.
- **Blocking decision:** approve whether triage may produce `assigned` without an assignment, or constrain the RPC to `under_review` and use the assignment RPC for all `assigned` transitions. This existing mismatch must be resolved before notification recipient behavior is implemented.

### 6.3 `assign_or_reassign_report_with_notifications`

- **Identity/authorization:** active authenticated coordinator only.
- **State and relationship checks:** lock target report and all active assignments in deterministic ID order; reject `verified`/`cancelled`; verify target technician exists, is active, and has role `technician`.
- **Transaction:** receipt lock; capture current active assignment/technician IDs; reject or no-op an assignment to the already active technician according to an approved product rule; mark previous active rows `reassigned`; insert new `assigned` row; set report to `assigned` when required; create event rows; store result; commit.
- **Recipients/events:** first assignment sends `report_assigned` to the new technician. Reassignment sends one `report_reassigned` event to the previous and new technician after recipient de-duplication. The coordinator actor is not an implicit recipient.
- **Minimal payload:** report number/title and “assigned/reassigned” status only; omit assignment notes, prior-technician identity, and report description.
- **Idempotency:** event key `command:<receipt-id>:report_assigned` or `command:<receipt-id>:report_reassigned`; unique `(event_key, recipient_id)` prevents duplicate delivery during a replay.
- **Open decision:** whether a reassignment to the same technician is rejected as a no-op (recommended), creates an assignment update without notification, or creates a new notification. Do not decide silently.

### 6.4 `transition_report_status_with_notifications`

- **Identity/authorization:** derive actor/role from active `auth.uid()` profile.
- **Permitted transitions to preserve from current code:**
  - reporter: `submitted`/`under_review` → `cancelled` only;
  - coordinator: non-terminal cancellation; `on_hold` → `in_progress`; may place work on hold under current code;
  - assigned technician: eligible assignment → `in_progress`, `on_hold`, or `completed` according to current state checks;
  - no direct `verified`/`reopened` transition; verification RPC owns those;
  - no direct assignment transition; assignment RPC owns it.
- **State/transaction checks:** lock report and affected active assignment(s); verify terminal/state/role relationship; require existing reason rules (`on_hold`, `cancelled`, and `reopened` where applicable); capture current technician before cancellation/completion updates; apply assignment side effects and report update in one transaction; T3 inserts status history; create approved events; store result.
- **Recipients/events:**
  - every approved ordinary status change: reporter plus affected active/just-completed technician, subject to self-notification decision;
  - `completed`: additionally all active coordinators receive `verification_required`;
  - `cancelled`: reporter plus technician captured before cancellation, if any, receive `report_cancelled`.
- **Idempotency:** `command:<receipt-id>:status_changed`, `:verification_required`, or `:report_cancelled`; the receipt prevents command replay. The newly inserted status-history row is retained as the audit source, but no notification contract relies only on trigger ordering.
- **Open decision:** whether completed emits both `status_changed` and `verification_required`. The workflow lists both rules; owner approval must settle UX duplication before implementation.

### 6.5 `verify_report_with_notifications`

- **Identity/authorization:** active authenticated coordinator only.
- **State/relationship checks:** lock report and affected assignment(s); require report status `completed`; reject a verifier who is the reporter or who served as the technician, matching current app and `verifications_insert_coordinator` rules.
- **Transaction:** receipt lock; capture the completed technician; insert verification; update report to `verified` if satisfactory or `reopened` otherwise; T3 creates status history; create event; store result; commit.
- **Recipients/events:** satisfactory result creates `verification_complete` for reporter and affected technician. Unsatisfactory result creates `verification_failed` for affected technician only, as documented. Do not add a reporter failure notification without approval.
- **Minimal payload:** report number/title and verified/reopened outcome. Do not include verification notes.
- **Idempotency:** `command:<receipt-id>:verification_complete` or `:verification_failed`; unique recipient deliveries plus receipt replay behavior.

## 7. SECURITY DEFINER Threat Review

Every proposed command and the private notification helper must meet all safeguards below.

| Threat / control | Required safeguard |
|---|---|
| Search-path hijack | `SECURITY DEFINER`, `SET search_path = public, auth, pg_temp`, and qualified `public.*`/`auth.*` references, matching existing functions. |
| Caller identity spoofing | Ignore user/role/recipient IDs in inputs; use `auth.uid()` and `public.get_user_role()` inside the function. |
| Role/relationship bypass | Re-check active profile, role, report state, reporter ownership, assignment ownership, technician target, and verification separation of duties inside each RPC. |
| Overbroad execution | `REVOKE ALL ON FUNCTION ... FROM PUBLIC`; grant `EXECUTE` only to `authenticated`; no anonymous access. Function owner must be a tightly controlled migration/database role. |
| Forged notifications | No generic notification insert function or policy. Only command functions call a private helper with server-derived recipients/type/content. |
| Data disclosure | Returns minimal existing action results only. Use controlled/sanitized errors; never return recipient IDs, raw notification rows, notes, emails, or SQL details. |
| Partial mutation/delivery | Raise on any source/notification/receipt failure so PostgreSQL rolls back all work in one transaction. |
| Direct DML bypass | Replace/restrict direct authenticated lifecycle writes only after audited migration sequencing in Section 8. |
| Replay/concurrent duplicate | Per-actor command receipt uniqueness, row locks, deterministic lock order, event-key delivery uniqueness, and replays that return the prior minimal result. |

The existing authenticated DAL changes from direct `.from(...).insert/update()` calls to authenticated `.rpc(...)` calls. `requireAuth`/`requireRole`, TypeScript validation, and sanitized error handling remain defense-in-depth. RLS remains authoritative for reads and acknowledges; it no longer serves as the sole write gate for notification-bearing lifecycle commands.

## 8. Direct-DML Restriction Plan

### 8.1 Current policies and legitimate writers

| Table / policy | Current legitimate writers | Proposed action in this scope | Breakage analysis |
|---|---|---|---|
| `reports_insert` | `submitReportAction`/`createReportRecord`; local SQL test fixture | Replace direct authenticated submit with submission RPC after it is deployed; adjust app/tests first | Breaking if Server Action changes before RPC exists; local superuser fixtures may still need explicit RPC contract tests. |
| `reports_update_coordinator` | triage, assignment, coordinator hold/cancel, verification status updates | Replace after all corresponding RPCs exist | Broad current policy covers multiple operations; removing early breaks all coordinator workflows. |
| `reports_update_reporter_cancel` | reporter cancellation action | Replace only when status RPC handles reporter cancellation | Keep until migration and action switch are verified. |
| `reports_update_technician_hold` | technician start/hold/resume/completion action | Replace only when status RPC handles all supported technician transitions | Do not remove while direct status Server Action remains. |
| `assignments_insert_coordinator`, `assignments_update_coordinator` | assignment/reassignment/cancellation action | Replace only when assignment/status RPCs are live | Must preserve coordinator cancellation and reassignment behavior atomically. |
| `assignments_update_technician_work` | technician status action | Replace only when status RPC owns all work state changes | Must not affect read visibility or work-log policy. |
| `assignments_update_technician_decline` | existing `decline_assignment` RPC; direct authenticated update is also presently possible | Leave unchanged in first slice because decline notification/type is unresolved | If decline notifications are later approved, move this command to the same RPC-only model. |
| `verifications_insert_coordinator` | verification action | Replace only after verification RPC is live | Must preserve D2/PD-R4 checks in RPC before policy restriction. |
| `report_status_history_insert` | T3 trigger; no current application DAL writer | Restrict direct authenticated insert after proving T3 continues under secure function ownership | Do not break automatic audit history; verify local owner/RLS behavior first. |
| `work_logs_insert` | work-log action | No change: no approved notification event | Remains a direct authenticated lifecycle-adjacent writer. |
| `report_comments_insert` | no current app writer; future direct API is possible under RLS | No change in this slice | Must be revisited before `comment_added` notification work. |

### 8.2 Safe migration sequence

1. **Approve scope:** event matrix, self-notification rule, coordinator audience, triage/assignment semantics, and idempotency receipt design.
2. **Additive schema migration:** add receipt/event-key support and indexes without removing any current policy or action path. Provide a rollback migration that drops only newly unused objects after verifying no command uses them.
3. **Function migration:** add private notification helper and all approved command RPCs. Retain direct RLS policies initially. Add local SQL rollback tests for success, failure, replay, and concurrency.
4. **Application integration change:** switch one Server Action/DAL command at a time to its RPC; preserve result shapes and add mocked `.rpc` runtime tests. Release only after local tests pass.
5. **Restriction migration:** after every legitimate production command for a covered table uses an RPC, remove/tighten only the matching direct authenticated policies/privileges. Do not change `SELECT`, attachment, work-log, comment, role-management, or unrelated policies.
6. **Post-restriction verification:** prove direct authenticated writes fail, every approved RPC succeeds for its authorized role, and no unconverted action/table writer remains.
7. **Remote gate:** only under separate authorization, validate deployed ownership, grants, RLS, `auth.uid()` behavior, rollback, and cleanup with disposable fixtures.

### 8.3 Rollback strategy

- Before policy restriction, rollback means reverting the Server Action to the existing direct DAL while leaving additive functions/tables unused.
- After a restriction migration, rollback must restore only the exact prior direct policies/privileges and revert the affected Server Action atomically in the same release. Do not drop receipts/events that are already referenced by notification rows.
- Never use a service role or a temporary broad notification insert policy as a rollback shortcut.

## 9. Event Semantics and Unresolved Decisions

### Mandatory documented events

`docs/WORKFLOW.md:346` documents: submission, urgent-hazard attention, assignment, status change, priority change, comment, completion awaiting verification, verification success/failure, reassignment, and cancellation. Existing enum support is absent only for assignment decline; current app support is absent for comments/request-information.

### Decisions that require approval before code

1. Are **all active coordinators** the required coordinator audience, or is an unimplemented on-call/group model required?
2. Are actors excluded when they also satisfy a recipient rule? The recommended default is exclusion, but it is not a documented requirement.
3. Does transition to `completed` create both a generic `status_changed` and `verification_required` row?
4. Must a triage transition to `assigned` be disallowed without a new assignment? Current code permits it, but it leaves no technician recipient.
5. Is assignment to the same active technician a rejected no-op, a state update without notification, or a new notification event?
6. Is `priority_changed` in the first backend release? If yes, the receipt/event-key design above must be approved.
7. What is the retention policy, and is `read_at` required beyond current `is_read`?
8. What exact comment/request-for-information event and “relevant coordinator” definition should be implemented later?

## 10. Implementation and Testing Sequence

| Step | Prerequisites / expected files | Acceptance criteria | Rollback consideration |
|---|---|---|---|
| 1. Approve event rules | Owner approval; this specification | Event matrix and all open recipient decisions are resolved in writing | No code/migration to roll back |
| 2. Design migrations | Proposed next migration(s) under `supabase/migrations/` | Additive receipt/event-key/index/function/policy design is reviewed against current six migrations | Keep direct policies unchanged at this stage |
| 3. Local schema/function validation | Authorized local Supabase CLI/PostgreSQL only; `supabase/tests` additions | Function compile, grants, RLS, transaction rollback, and trigger interaction pass inside rollback-scoped tests | Drop un-applied local database or revert additive migration |
| 4. Unit/mocked tests | `tests/unit/mutation-dal.test.mjs`, `tests/unit/report-actions.test.mjs`, new RPC mock helpers | Inputs, sanitized failures, role guard, result mapping, and no post-mutation notification insert are covered | No external state |
| 5. Remote integration gate | Separate written authorization and disposable fixture plan | RLS, function ownership, grants, direct-DML denial, replay, and cleanup verified remotely | Restore exact policy release only if required; no manual data edits |
| 6. Server Action/DAL integration | `actions/reports.ts`, `utils/reports/mutations.ts`, types/validation as needed | Each converted action invokes only the approved RPC and preserves form result behavior | Revert action plus corresponding policy restriction together |
| 7. Inbox/read behavior | Later approved notification DAL/actions/page | Recipient-only bounded list and `is_read` acknowledgment, with empty/error/incomplete states | Independent of command RPC creation |
| 8. Bell/responsive UI | Later approved header/component changes | Bell reflects truthful unread data and links to an accessible inbox | Keep static placeholder until data path is valid |
| 9. Regression/security review | Full local unit suite, TypeScript, lint; separately approved remote stage | Existing reports, attachments, dashboards, analytics, Locations, and Settings remain correct | Address only notification-related regressions |

## 11. Test Matrix

| Area | Local mocked/unit coverage | Local database coverage | Remote-only coverage |
|---|---|---|---|
| Submission | payload/result mapping, generic errors, request-ID forwarding | atomic report + coordinator notifications; replay returns same report | actual RLS/function ownership and coordinator scope |
| Triage | coordinator guard, status/priority mapping | priority/status event only on real change | real RLS and assigned-without-technician boundary |
| Assignment/reassignment | target technician validation, RPC result mapping | row locks, old/new recipients, same-tech rule, rollback | concurrent command race and deployed grants |
| Status/cancellation | state/role mapping, no direct notification insert | assignment/report/history/notifications roll back together | direct writes denied, all roles scoped correctly |
| Verification | separation-of-duties mapping | verification/report/event rollback and outcome recipients | live RLS function behavior |
| Idempotency | request ID/result replay mapping | same receipt/key does not duplicate source or recipients | concurrent client retry behavior |
| Notification RLS | DAL/action query mocks | policy/column-grant regression tests | recipient isolation, content tamper denial, direct insert/delete denial |
| Regression | existing report action/DAL, attachment, analytics/settings tests | migration test suite updates | authorized full integration only |

Do not run the current remote RLS runner for this work without separate approval. Its existing notification fixture assumptions are not aligned with the local notification insert policy or enum and require their own maintenance review.

## 12. Approval Checklist Before Implementation

- [ ] Approve in-app-only scope and exclude email/SMS/push/preferences.
- [ ] Approve the lifecycle RPC set and direct-DML restriction strategy.
- [ ] Approve `p_request_id`, receipt storage, event-key uniqueness, and retention approach.
- [ ] Approve all-coordinator audience, self-notification behavior, same-technician reassignment behavior, and completed dual-event behavior.
- [ ] Resolve triage-to-`assigned` without assignment behavior.
- [ ] Approve/defer priority, comments/request-information, and assignment-decline events explicitly.
- [ ] Approve additive migration review before any schema/function/policy edits.
- [ ] Approve local database test environment use before executing local SQL tests.
- [ ] Approve remote RLS/integration testing separately after local validation.

## Boundary Confirmation

This specification was produced from local source and documentation. No application code, migration, function, trigger, table, index, policy, Storage setting, environment file, dependency, remote Supabase data, Git commit, or push was changed. No remote operation or RLS integration runner was executed.
