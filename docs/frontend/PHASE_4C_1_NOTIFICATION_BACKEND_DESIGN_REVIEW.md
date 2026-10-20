# CMIRS — Phase 4C.1 Notification Backend Design Review

**Date:** 2026-10-20  
**Status:** Read-only architecture review and proposed design. No implementation, migration, policy, remote query, or integration test was performed.  
**Scope:** Transaction-safe creation of approved in-app notification records with report-lifecycle changes. Email, SMS, push, preferences, and notification UI are out of scope.

## 1. Existing Database and Application Findings

### Existing local database contract

- `supabase/migrations/20261018000001_core_schema.sql:100` defines a ten-value `notification_type` enum: `report_submitted`, `report_assigned`, `status_changed`, `priority_changed`, `comment_added`, `verification_required`, `verification_complete`, `verification_failed`, `report_reassigned`, and `report_cancelled`.
- `supabase/migrations/20261018000001_core_schema.sql:260` defines `public.notifications` with immutable content fields (`recipient_id`, `type`, `title`, `message`, optional `report_id`, `is_read`, and `created_at`). It has no event/source key, actor, retry key, read timestamp, or delivery-attempt state.
- `supabase/migrations/20261018000002_performance_indexes.sql:51` provides recipient, recipient/read-state, and report indexes, but none for a cursor order or idempotency.
- `supabase/migrations/20261018000005_table_rls_policies.sql:433` permits a user to select only rows where `recipient_id = auth.uid()`. Its update policy and column grant permit only that recipient to update `is_read`; there is no authenticated notification `INSERT` or `DELETE` policy.
- `supabase/migrations/20261018000003_triggers.sql` contains secure trigger precedents—report numbering, immutable report fields, status-history insertion, profile creation, and attachment-limit locking—but no notification trigger.
- `supabase/migrations/20261018000004_security_functions_and_rpc.sql` uses `SECURITY DEFINER`, a fixed `search_path`, revoked `PUBLIC` execution, and explicit authenticated grants for `get_user_role`, `can_view_report`, `soft_delete_attachment`, and `decline_assignment`.

### Existing application mutation contract

- `actions/reports.ts` supplies authenticated Server Actions and delegates persistence to `utils/reports/mutations.ts` using the cookie-bound authenticated server Supabase client in `utils/supabase/server.ts`.
- `createReportRecord` performs a single `reports` insert. Existing trigger T2 generates the report number during that insert.
- `assignTechnicianToReport` separately reassigns old active assignments, inserts a new assignment, then updates the report status. Its own source and unit tests identify a possible partial failure after an assignment has been created.
- `transitionReportStatusRecord` separately updates assignment state when required and then updates the report. Coordinator cancellation separately cancels assignments before updating the report.
- `verifyReportRecord` inserts a verification row and then separately updates the report to `verified` or `reopened`; it reports the existing partial-failure case if the status update fails after verification insertion.
- `declineAssignmentViaRpc` is the only lifecycle mutation already delegated to a transaction-scoped database RPC. It does not create a notification and no approved `assignment_declined` notification type exists.
- No mutation writes a notification, and no notification DAL, recipient resolver, Server Action, inbox route, or functional bell exists. `components/layout/header.tsx:67` is a static placeholder only.

### Existing authorization and ownership facts

- All five active authenticated roles may create a `submitted` report; `reports_insert` requires `reporter_id = auth.uid()`, `submitted`, and no confirmed priority.
- Coordinators can triage, assign/reassign, cancel non-terminal reports, and verify under the existing role/RLS constraints. Technicians own their qualifying assignment actions. Reporters can cancel only their own `submitted` or `under_review` reports.
- `public.can_view_report(UUID)` centralizes report visibility: oversight roles see all, reporters see their reports, and technicians see reports with a non-declined assignment. A notification must not grant access beyond that existing predicate.

## 2. Exact Evidence and File References

| Evidence | Local source | Architectural implication |
|---|---|---|
| In-app only MVP (D7) | `README.md`; `docs/WORKFLOW.md:342` | Do not design external delivery or provider credentials. |
| Required event/recipient list | `docs/WORKFLOW.md:346` | The event matrix below is derived from documented lifecycle recipients, not role guesses. |
| Notifications are system/trigger-only for inserts | `docs/SECURITY.md:154`; `docs/database-design/RLS_POLICY_PROPOSAL.md:413` | A user-scoped application insert is intentionally unavailable. |
| Recipient select and acknowledgment-only update | `supabase/migrations/20261018000005_table_rls_policies.sql:433` | Preserve recipient ownership; do not add generic client writes. |
| Secure trigger conventions | `supabase/migrations/20261018000003_triggers.sql:9`, `:84`, `:151` | Trigger functions use `SECURITY DEFINER` and fixed search paths; the design must retain this discipline if triggers are added. |
| Secure RPC conventions | `supabase/migrations/20261018000004_security_functions_and_rpc.sql:84`, `:123` | Existing privileged functions validate role and ownership with `auth.uid()`, then revoke `PUBLIC` execution. |
| Existing status audit source | `supabase/migrations/20261018000003_triggers.sql:84` | Status-history rows provide a stable source event ID after a report-status update. |
| Existing partial composite mutations | `utils/reports/mutations.ts:315`, `:550`, `:870` | Per-request PostgREST calls cannot make assignment/cancellation/verification plus notifications one transaction. |
| Local test coverage acknowledges partial failure | `tests/unit/mutation-dal.test.mjs:363`; `tests/unit/report-actions.test.mjs:283` | The new design must remove—not merely report—partial success for notification-bearing lifecycle commands. |
| Existing local SQL test approach | `supabase/tests/database_test_suite.sql:1` | A rollback-scoped local PostgreSQL/Supabase CLI test can validate database atomicity after separate authorization. |

## 3. Comparison of Creation Approaches

### Approach A — Database-transactional creation

#### A1. Notification-only database triggers

**How it would work:** `AFTER INSERT/UPDATE` triggers on `reports`, `assignments`, `verifications`, or possibly `report_status_history` would calculate recipients and insert notification rows inside the statement transaction.

**Strengths**

- A notification insert rolls back when its source row statement rolls back.
- Direct table writes that pass current RLS cannot silently bypass the trigger.
- Existing T2, T3, and T5 prove the codebase already uses hardened trigger functions, fixed search paths, and database enforcement.
- A trigger on `report_status_history` can use the newly created history ID as a stable source identity for a status event.

**Limitations**

- A trigger only shares a transaction with one SQL statement, not with the full multi-request Server Action. For example, the current assignment path performs old-assignment update, new-assignment insert, and report update as separate requests; verification inserts a row and updates the report in separate requests.
- Cancellation and reassignment recipient selection needs pre-change assignment context. Once current code has changed an assignment to `cancelled` or `reassigned`, a generic status trigger cannot safely know which technician was affected without additional event context; selecting all historical assignments risks notifying the wrong user.
- A trigger on assignment insert cannot unambiguously distinguish a first assignment from a reassignment without reliable command context or a carefully designed source-event model.
- Trigger-only idempotency is difficult for priority changes and repeated status cycles unless every notification is tied to a durable source-event ID.

**Conclusion:** triggers are valuable for simple, row-local integrity/audit behavior, but trigger-only notification creation is insufficient to make today’s multi-statement lifecycle commands transaction-safe end-to-end.

#### A2. Transaction-safe lifecycle RPCs

**How it would work:** a narrowly scoped `SECURITY DEFINER` RPC performs one authorized business command—such as submission, assignment/reassignment, status transition, verification, or cancellation—locks/reads its source rows, mutates all required rows, and inserts the exact notification recipients before returning. PostgreSQL treats the function call as one transaction: a raised error rolls back the report change and all notification rows.

**Strengths**

- Makes each composite lifecycle command atomic, including report/assignment/verification rows, status history trigger effects, and notification rows.
- Captures the pre-change assigned technician before status/assignment changes, eliminating the ambiguity in cancellation/reassignment recipients.
- Centralizes actor, role, state-machine, active-recipient, and self-notification checks next to the authoritative mutation.
- Uses the existing `decline_assignment` and `soft_delete_attachment` precedent: `SECURITY DEFINER`, fixed search path, explicit `auth.uid()` checks, revoked `PUBLIC` execution, and authenticated-only execute grants.
- Avoids a service-role client and preserves recipient RLS; callers never provide arbitrary recipients or notification message text.

**Costs/constraints**

- Requires a deliberate migration and a controlled refactor from multi-request DAL orchestration to RPC calls.
- To guarantee delivery, direct lifecycle DML that can bypass the RPC must be removed/restricted for the covered commands, or a carefully designed backstop must be added. Leaving current direct write policies unchanged permits a malicious authenticated caller to create lifecycle state without the notification command.
- Each RPC must reproduce or consolidate existing server/RLS validations without weakening them; tests must cover five roles and stale/concurrent state.

### Approach B — Application-level creation after the lifecycle mutation

**How it would work:** the Server Action/DAL executes the current report mutation, then submits a separate `.from('notifications').insert(...)` request.

**Advantages**

- Smallest TypeScript-only change if notification insertion were permitted.
- Notification templates could be colocated with UI/action code.

**Failures and security concerns**

- It is blocked by design: there is no authenticated `INSERT` policy for notifications. Relaxing that policy would let a caller forge recipients/content or would require a bypassing service role, both contrary to the current security model.
- Requests are separate transactions. A successful report/assignment/verification can commit before the notification request fails; conversely retrying after an uncertain response can duplicate delivery.
- The existing assignment and verification paths already have documented partial mutations. A post-mutation notification request compounds the inconsistency rather than fixing it.
- The application must enumerate protected recipient profile rows and author message bodies under the caller’s RLS scope, creating unnecessary disclosure and authorization complexity.
- Compensation/cleanup cannot reliably restore report state, status history, assignments, or verifications after a notification failure.

**Conclusion:** do not use application-level post-mutation insertion for required lifecycle notifications. It is neither atomic nor compatible with the current least-privilege RLS contract.

## 4. Recommended Architecture and Transaction Flow

### Recommendation: narrow command RPCs, not notification-only triggers

Adopt **one explicit transaction-safe database command RPC per current composite lifecycle operation**, invoked only by the existing authenticated Server Actions. This fits the project’s existing privileged-RPC conventions and is safer than a trigger-only design because recipient selection depends on the command’s pre-change state.

Recommended command boundaries (proposed names only):

1. `submit_report_with_notifications` — inserts the submitted report, lets existing T2 generate its number, identifies active coordinators, and creates `report_submitted` rows.
2. `assign_or_reassign_report_with_notifications` — locks the report and active assignments, captures the previous technician(s), reassigns old rows, inserts the new assignment, sets the report status, and creates assignment/reassignment rows.
3. `transition_report_status_with_notifications` — locks the report and active assignment, applies approved status/cancellation side effects, relies on T3 status history, then creates status/completion/cancellation rows using the same command context.
4. `verify_report_with_notifications` — locks the completed report and relevant assignment, validates separation of duties, inserts verification, transitions to `verified` or `reopened`, and creates the corresponding verification row(s).
5. Keep `decline_assignment` unchanged until an `assignment_declined` notification type and coordinator recipient rule are separately approved.

The existing Server Actions remain the application entry point for form validation and UX. Their mutation DAL calls become `.rpc(...)` calls with only validated user input. They must not construct recipient IDs, notification titles, messages, or privileged actor IDs.

### Required transaction flow

For every command:

1. Require an authenticated `auth.uid()` and fetch the caller role using the existing helper.
2. Lock the report and affected active assignment rows in a deterministic order (`FOR UPDATE`) before recipient/state decisions.
3. Re-validate the existing role, ownership, state-transition, active-profile, and separation-of-duties rules inside the RPC.
4. Capture recipient IDs from authoritative state **before** changing assignments/statuses; restrict recipients to active profiles and de-duplicate IDs.
5. Perform all source mutations. Existing T2/T3 continue to execute in the transaction.
6. Derive a stable source event key, insert notification rows through one internal helper, and rely on a unique constraint to make a replay idempotent.
7. Return the existing narrow action result. Any error raises/returns failure so PostgreSQL rolls back source mutations and notification rows together.

This recommendation does **not** claim the existing remote database has these guarantees; it is the design required before Phase 4C implementation.

## 5. Event and Recipient Matrix

“Required” means documented in `docs/WORKFLOW.md`. The exact behavior listed as “approval needed” is not silently assumed.

| Source command/event | Documented recipients | Existing type | Recommendation | Open point |
|---|---|---|---|---|
| Submitted report | Active maintenance coordinators | `report_submitted` | Include in first backend slice. If `is_urgent_hazard`, use the same event with a high-priority presentation marker; do not invent an enum value. | Confirm all active coordinators rather than an on-call group. |
| Confirmed priority changes | Reporter; active assigned technician | `priority_changed` | Defer until a durable priority-change source/idempotency key is approved, unless included in the triage RPC with a dedicated source-event record. | Confirm priority-change history/key design and self-notification rule. |
| First technician assignment | New technician | `report_assigned` | Include in first backend slice. Source key derives from new assignment ID. | None beyond actor suppression policy. |
| Reassignment | Previous technician; new technician | `report_reassigned` | Include only in the command RPC that captures old/new assignment IDs together. | Confirm whether both event rows use one command event or assignment source keys. |
| Ordinary status transition | Reporter; affected assigned technician | `status_changed` | Include for approved state changes. Source key derives from the resulting status-history ID. | Confirm whether the acting recipient is suppressed. |
| Completed / awaiting verification | Active maintenance coordinators | `verification_required` | Include with transition to `completed`; it is distinct from generic status change. | Confirm whether a reporter/technician additionally receive the generic `status_changed` event. |
| Satisfactory verification | Reporter; affected technician | `verification_complete` | Include with `verified` transition. | Confirm actor suppression. |
| Failed verification / reopened | Affected technician | `verification_failed` | Include with `reopened` transition. | Do not notify reporter unless requirements are expanded. |
| Cancellation | Reporter; active assigned technician, if any | `report_cancelled` | Include only once cancellation recipient capture is in the transaction-safe RPC. | Reporter can cancel pre-assignment; no technician exists then. |
| Comment / request for information | Reporter; assigned technician; relevant coordinator | `comment_added` | Out of this backend slice: no application comment action/classification is implemented. | Define “relevant coordinator” and typed request semantics. |
| Assignment declined | Coordinator(s) implied by workflow | None | Deferred; retain existing decline RPC without notification. | Requires approved enum value and recipient rule. |

All events must de-duplicate recipient IDs. The product decision on self-notifications must be explicit; the recommended default is to exclude the actor when the actor also appears in a recipient set.

## 6. Proposed Database Changes, If Approved

The following are proposals only; no migration is created or applied by this review.

### Required for safe implementation

1. Add a nullable immutable `event_key` to `public.notifications` and create a unique partial index on `(event_key, recipient_id)` where `event_key IS NOT NULL`. This permits a staged migration if pre-existing rows cannot be assumed empty.
2. Add an ordering index appropriate for the planned inbox cursor, for example `(recipient_id, created_at DESC, id DESC)`, after reviewing query plans.
3. Add a private SQL helper (not executable by `authenticated`) that accepts only a server-computed event key, type, report ID, recipient IDs, and constrained title/message inputs; it de-duplicates recipients and uses conflict handling against the unique event key.
4. Add the narrow `SECURITY DEFINER` command RPCs described above. Each must set `search_path = public, auth, pg_temp`, revoke `PUBLIC` execute, grant only `authenticated` execute, call `auth.uid()`/`get_user_role()`, and validate all existing lifecycle conditions.
5. Restrict or replace direct authenticated write paths for report/assignment/verification mutations covered by an RPC. Without this change, direct RLS-permitted writes can bypass mandatory notification creation. Retain required read RLS and non-lifecycle table permissions.

### Optional, separately approved additions

- A durable `notification_events` ledger may be preferable to an `event_key` column if future delivery channels/auditing require an actor, source table/ID, payload version, or delivery state. It is not required for the first in-app-only MVP if each command can derive stable keys from report, assignment, verification, and status-history IDs.
- `read_at` should be added only if the product needs a timestamp; existing `is_read` is sufficient for the MVP acknowledgment state.
- A priority-change audit/source table is needed before repeated identical priority cycles can receive a collision-safe idempotency key.

## 7. RLS and Security Implications

- Preserve notification recipient `SELECT` and recipient-owned `is_read` update policies exactly in principle; no UI/action needs permission to insert, delete, alter content, alter recipient, or alter type.
- Do not add a generic `notifications_insert` policy. Notification creation is internal to trusted database functions invoked as part of an authorized lifecycle command.
- A `SECURITY DEFINER` RPC must not trust client-supplied reporter, technician, coordinator, recipient, report number, title, message, event key, or actor values. It derives all of them from locked database rows and `auth.uid()`.
- Use qualified object names and the existing fixed search path. Revoke default execution from `PUBLIC` before granting narrowly to `authenticated`.
- Re-check report visibility with existing `can_view_report` behavior when selecting recipients; notification possession must never become an authorization grant. The report page still independently performs its own authorization and RLS query.
- Notification copy must contain only an event label, report number/title where approved, state summary, and a route identifier. Exclude reporter/technician emails, full descriptions, comments, verification notes, attachment metadata, private storage paths, and signed URLs.
- The application server remains cookie/JWT scoped and does not use a service role. Server Actions provide defense-in-depth validation but database validation remains authoritative.

## 8. Duplicate Prevention and Error Handling

### Duplicate prevention

- Each database command creates a stable event key from its durable source: report ID for submission, assignment ID(s) for assignment/reassignment, verification ID for verification outcomes, and status-history ID for state-derived events.
- The partial unique index `(event_key, recipient_id)` makes recipient rows idempotent. The internal helper uses `ON CONFLICT DO NOTHING` only for that key, not to conceal unrelated database errors.
- Recipient selection uses `SELECT DISTINCT`/set semantics and filters inactive profiles before insert.
- Repeated lifecycle attempts must either fail their existing state precondition or resolve to the same source event key. Retrying a command after an unknown response must never create a second notification for the same source event.

### Error and rollback behavior

- Any validation, row-lock, source mutation, recipient lookup, or notification insert failure causes the RPC to fail and the full command transaction to roll back. Do not report the lifecycle success while withholding its required notification.
- The existing Server Action returns a sanitized error and revalidates only after RPC success. It must not attempt a second, application-level notification insert or compensation write.
- True duplicate user submissions remain a separate report-submission idempotency decision: a retry that creates a different report ID is a distinct report and therefore correctly produces distinct notifications. If product requirements demand submission deduplication, add a separate client-operation key to the report-creation command.
- Log diagnostic database/application errors only through existing secure server logging; never return SQL details, recipient lists, or notification content to unauthorized clients.

## 9. Testing and Acceptance Criteria

### Local tests after approval

- Unit-test each command’s input/authorization boundary with the existing Server Action and DAL mock conventions.
- Add local database/SQL tests, executed only in an authorized local Supabase CLI/PostgreSQL environment and wrapped in `BEGIN`/`ROLLBACK`, for transaction rollback, idempotency, locked reassignment/cancellation recipients, inactive-recipient filtering, and minimum notification content.
- Test every approved event matrix row, duplicate recipient set, self-notification decision, terminal/stale state, role denial, and failure during notification insertion.
- Verify unchanged recipient isolation: own select succeeds; own `is_read` succeeds; cross-user select/update, content changes, direct insert, and delete fail.
- Regression-test report submission, assignment, cancellation, status transitions, verification, attachment upload/deletion, report detail authorization, analytics fail-closed behavior, and Settings completeness.

### Separate remote authorization required

- Execute remote RLS/integration tests only with explicit approval, disposable fixtures, and cleanup. Do not run the current deferred runner as part of this design task.
- Validate actual function ownership/`SECURITY DEFINER` behavior, `auth.uid()` propagation, grants, direct-DML denial, rollback, concurrent command behavior, and all five role scopes.
- The current `tests/integration/rls-runner.ts` notification fixtures require a separate maintenance review before use: it attempts coordinator inserts despite no notification insert policy and uses `assignment_created`, which is not in the local `notification_type` enum.

### Acceptance criteria

1. Every approved lifecycle command changes its source rows and notification rows atomically, or neither persists.
2. A caller cannot bypass required notification creation through direct lifecycle DML.
3. No caller can forge recipients/content or access another recipient’s notifications.
4. Every delivered row maps to one approved event/source and one active authorized recipient, with a stable duplicate-prevention key.
5. Current report, attachment, dashboard, and role protections remain intact.

## 10. Risks, Open Questions, and Approval Checkpoints

### Risks

| Risk | Mitigation |
|---|---|
| Security-definer function expands privilege | Keep commands narrow, validate `auth.uid()` and state in-function, fix search path, revoke `PUBLIC`, and test direct-DML denial. |
| RPC refactor diverges from existing validation | Reuse validation contracts and port each critical check; retain Server Action validation as defense in depth. |
| Trigger ordering/audit source assumptions | Do not make notification correctness depend solely on trigger order; command RPCs own event creation and can query/capture the source ID in their locked transaction. |
| Duplicate rows on retry | Stable source event keys plus unique recipient delivery constraint. |
| Incorrect historical technician recipient | Capture affected assignment IDs before updates inside the same locked command. |
| Existing direct RLS writes bypass commands | Make policy/privilege redesign an explicit prerequisite, not an afterthought. |
| Scope creep to email/push/preferences | Keep only in-app rows and recipient acknowledgment in the approved implementation slice. |

### Open questions requiring product/security approval

1. Confirm the first implementation event set, especially priority changes, reassignment, cancellation, and whether `completed` emits both generic status and verification-required rows.
2. Confirm whether all active coordinators receive coordinator events and whether actors receive notifications about actions they performed.
3. Approve direct lifecycle-write restriction in favor of command RPCs; this changes the current authorized mutation path even though it strengthens guarantees.
4. Approve the event-key schema strategy versus a normalized `notification_events` ledger.
5. Decide notification retention and whether `read_at` is needed.
6. Define additional-information/comment and declined-assignment notifications before adding types or handlers.

### Approval checkpoint

Do not begin implementation until the owner approves the command-RPC approach, event matrix, recipient/self-notification rules, idempotency schema, and required RLS/privilege migration scope. No remote behavior has been verified by this review.

## Review Boundary Confirmation

This review used local source and documentation only. It did not connect to Supabase, execute remote queries/RPCs/Storage operations, run the RLS integration runner, modify application code, modify migrations/schema/RLS/storage policies, inspect `.env.local`, install dependencies, commit, or push.
