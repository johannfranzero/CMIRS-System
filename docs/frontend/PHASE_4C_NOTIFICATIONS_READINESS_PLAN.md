# CMIRS — Phase 4C Notifications Readiness Plan

**Date:** 2026-10-20  
**Status:** Read-only audit and proposed plan; no notification implementation has started.  
**Scope:** In-app notifications only, subject to the approvals and database work described below.

## 1. Executive Summary

The approved CMIRS documentation requires in-app notifications for report-lifecycle events and explicitly places email, SMS, and push delivery out of scope for the MVP. The local schema already contains a `notifications` table, a ten-value `notification_type` enum, recipient-only read access, and recipient-only `is_read` updates. It does not provide an ordinary authenticated `INSERT` policy, a notification trigger, a notification creation RPC, application DAL/actions, types, route, list UI, unread count, or preferences model.

The current header contains only a static, non-navigating bell and red dot. No application feature creates, reads, lists, or acknowledges notifications. Report lifecycle mutations use the authenticated server-side Supabase client and are generally multi-statement operations. Adding a best-effort application insert after those mutations would permit lifecycle success without notification delivery and could produce duplicates on retries; it would also be denied by the current notification RLS contract.

**Recommendation:** approve a small in-app-only MVP, but first approve a single, transaction-safe notification-creation design and its supporting migration/RLS changes. Do not build a frontend that represents delivery as complete until the creation path is in place and its RLS behavior is authorized for remote verification.

## 2. Source Requirements and Evidence

### Confirmed requirements

| Requirement | Evidence | Planning consequence |
|---|---|---|
| MVP delivery is in-app only; email, SMS, and push are out of scope. | `README.md` decision D7; `docs/WORKFLOW.md`; `docs/database-design/SCHEMA_PROPOSAL.md` | Do not add a provider, credentials, worker, or browser push subscription. |
| Coordinators receive new-submission, completed-work, and verification-required notifications. | `docs/ROLES.md` coordinator responsibilities; `docs/WORKFLOW.md` lifecycle stages | Submission and completion events belong in the MVP event set. |
| Reporters receive status-change notifications. | `docs/ROLES.md` student/personnel responsibilities; `docs/WORKFLOW.md` Notifications | Status changes must be recipient-scoped and link only to reports the recipient may view. |
| Technicians receive new-assignment and status-change notifications. | `docs/ROLES.md` technician responsibilities; `docs/WORKFLOW.md` Notifications | Assignment and status events must use the active/affected technician relationship. |
| The workflow documents priority, comment, reassignment, cancellation, and verification outcomes as notification events. | `docs/WORKFLOW.md` Notifications; `docs/DATABASE.md` `notification_type` | Include only events whose lifecycle action and recipient rule are currently approved. |
| Notification records are recipient-owned: users can read their own notifications and mark only `is_read`. | `docs/SECURITY.md`; `supabase/migrations/20261018000005_table_rls_policies.sql` | The UI must never query or mutate another recipient's record. |

### Important source qualification

Several Phase 0 documents describe planned behavior, while the migration files define the currently available local contract. This plan treats the local migrations and application source as implementation facts, uses the workflow and role documents as product requirements, and labels any new behavior below as a recommendation or approval request.

## 3. Current Implementation Inventory

### Implemented database contract (local migration source)

- `supabase/migrations/20261018000001_core_schema.sql` defines `notification_type` with: `report_submitted`, `report_assigned`, `status_changed`, `priority_changed`, `comment_added`, `verification_required`, `verification_complete`, `verification_failed`, `report_reassigned`, and `report_cancelled`.
- The same migration defines `public.notifications`: `id`, `recipient_id`, `type`, `title`, `message`, nullable `report_id`, `is_read`, and `created_at`.
- `supabase/migrations/20261018000002_performance_indexes.sql` indexes recipient, recipient/read state, and report ID.
- `supabase/migrations/20261018000005_table_rls_policies.sql` allows authenticated users to select rows where `recipient_id = auth.uid()` and update only their own `is_read`. Column grants revoke broad update access and grant update only on `is_read`.
- There is no notification `INSERT` or `DELETE` policy in the local RLS migration and no notification trigger in `supabase/migrations/20261018000003_triggers.sql`.

### Implemented application behavior

- `components/layout/header.tsx` renders an icon-only button labelled “View notifications,” but it has no link, action, fetched count, or state. Its red dot is static.
- There is no `/notifications` route, notification component, client/server type, DAL, transform, Server Action, recipient resolver, or application event dispatcher in `app`, `components`, `actions`, `utils`, or `types`.
- `actions/reports.ts` delegates report submission, triage, assignment/reassignment, assignment decline, status transitions, work logs, and verification to `utils/reports/mutations.ts`.
- `utils/reports/mutations.ts` uses the existing authenticated server-side Supabase client and RLS. Submission, assignment/reassignment, status transition, and verification contain multiple independent database operations. Assignment decline alone calls the existing `decline_assignment` RPC.
- No current mutation writes a notification. The application does not currently expose report comments or an “additional information requested” action, despite the local `report_comments` schema and documented future workflow.

### Existing reusable conventions

- `utils/auth/server.ts`: `requireAuth` and `requireRole` supply server-side guards and active-profile enforcement.
- `utils/supabase/server.ts`: the canonical cookie-bound authenticated Supabase server client; it is not a service-role client.
- `utils/reports/dal.ts`, `utils/settings/dal.ts`, and `utils/reports/analytics-runtime.ts`: narrow selects, exact counts, explicit limits, sanitized failure states, and fail-closed incomplete-data behavior.
- `types/reports.ts`, `types/mutations.ts`, and `utils/reports/transform.ts`: server-to-UI type/transform conventions.
- `tests/unit/*.test.mjs`: Node test runner, fixtures, and mocked Supabase query-chain tests. Phase 4B added runtime mocks for Settings and Analytics DALs.
- `docs/frontend/PHASE_4A_STORAGE_IMPLEMENTATION_REPORT.md`: attachment workflows already authorize server-side actions and must remain unaffected.

### Prior Phase 4B findings

- `docs/frontend/PHASE_4B_READINESS_REPORT.md` and `docs/frontend/PHASE_4B_3_SETTINGS_REPORT.md` correctly excluded notification preferences because no preferences schema or policy exists.
- `docs/frontend/PHASE_4B_1_LOCATIONS_REPORT.md`, `docs/frontend/PHASE_4B_2_ANALYTICS_REPORT.md`, and `docs/frontend/PHASE_4B_3_SETTINGS_REPORT.md` establish the project convention of displaying safe error/incomplete states rather than sample or partial data.
- No `docs/frontend/PHASE_4B_INTEGRATION_REVIEW.md` file was present during this audit.

## 4. Confirmed Gaps and Unresolved Decisions

### Confirmed gaps

1. **No creation path:** RLS permits recipient select/update but no ordinary authenticated insert. A user-scoped server client cannot create notifications for coordinators, reporters, or technicians.
2. **No atomic lifecycle integration:** current application mutations span separate statements. A post-mutation insert would not be atomic with report, assignment, and verification state changes.
3. **No frontend implementation:** the header indicator is a static placeholder; there is no inbox, unread count, pagination, acknowledgement action, navigation route, loading state, or error state.
4. **No idempotency data:** the current table has no event identifier, actor ID, delivery state, or uniqueness mechanism to prevent duplicate rows under retries/replays.
5. **No read timestamp:** `is_read` supports read/unread state but not `read_at`. A timestamp is optional for MVP and would require a schema decision.
6. **No preferences or external delivery infrastructure:** there is no preferences table, email-provider dependency/configuration, SMTP configuration inspected from a safe template, or push-subscription storage.
7. **No implemented comments/request-for-information feature:** `comment_added` exists in the enum, but “request additional information” has no present action, message classification, recipient-selection rule, or UI implementation.

### Decisions requiring owner approval before implementation

| Decision | Why it is needed |
|---|---|
| Notification creation mechanism | Existing documents leave PD-D6 as a recommendation. Choose between database triggers and a transactional lifecycle RPC redesign; do not add a permissive client insert policy. |
| Minimum initial event set | Confirm whether the MVP begins with the core required events only or includes priority, reassignment, cancellation, and verification outcomes immediately. |
| Actor/self-notification rule | The documentation names recipients but does not state whether an actor also receives a notification when they are a recipient. Recommend suppressing self-notifications unless explicitly required. |
| Coordinator audience | “Coordinators” currently means active coordinator profiles; there is no on-call/team routing model. Confirm whether all active coordinators should receive each coordinator event. |
| Additional-information semantics | Decide whether this is a typed comment event, a new report state/action, or out of the Phase 4C MVP. |
| Declined-assignment event | Current enum lacks `assignment_declined`; prior database documentation flags it as undecided. Do not overload another type without approval. |
| Retention and read timestamp | Decide whether the MVP retains records indefinitely with `is_read` only, and whether a future `read_at`/archival policy is required. |

## 5. Recommended MVP Scope

**Recommended MVP:** authenticated, RLS-scoped in-app inbox and unread count, one notification row per approved recipient/event, deterministic bounded loading, and recipient-owned read acknowledgment. Keep email, SMS, push, preference controls, notification administration, bulk mark-all-read, deletion, and cross-user notification viewing out of scope.

Start with events explicitly tied to current implemented actions and the approved workflow:

1. report submitted;
2. technician assigned/reassigned;
3. report status changed, including completed;
4. verification satisfactory/failed; and
5. cancellation only after its recipient rule and atomic lifecycle path are confirmed.

Do not include additional-information requests, comments, assignment decline, escalation, SLA alerts, or management broadcasts until their product rules, schema support, and authoritative triggering action exist.

The inbox should fetch the recipient’s newest page only (recommended 25 rows), ordered by `created_at DESC, id DESC`, with an explicit “load more” cursor. Exact count may be used for the unread badge only if the response includes a trustworthy exact count; otherwise display no numeric badge rather than a misleading number. A successful empty page is an empty state. Query failures show an unavailable state. A bounded page is not described as the complete history.

## 6. Notification Event and Recipient Matrix

The table separates documented requirements from recommendation. “Actor excluded” is proposed behavior pending approval, not a confirmed requirement.

| Event | Triggering action/state | Intended recipients | Type | MVP status | Notes and duplicate control |
|---|---|---|---|---|---|
| Report submitted | Successful insert with `submitted` | All active coordinators | `report_submitted` | Required | One row per recipient per report-create event; urgent-hazard wording may be in message, not a new type. |
| Priority changed | Coordinator changes `confirmed_priority` | Reporter and active assigned technician | `priority_changed` | Documented; phase after core | Emit only when value actually changes; do not expose priority to users who cannot view the report. |
| Technician assigned | New active assignment | New assigned technician | `report_assigned` | Required | One row per assignment event; actor normally differs from recipient. |
| Technician reassigned | Previous active assignment superseded and new one created | Previous and new technician | `report_reassigned` | Documented; phase after core | Deduplicate if IDs are the same; do not confuse with first assignment. |
| Status changed | Authoritative report status transition | Reporter and active assigned technician | `status_changed` | Required | Emit only when old/new status differ; recommended to suppress actor recipient. |
| Work completed | Transition to `completed` | All active coordinators | `verification_required` | Required | This is a status outcome with its dedicated enum type. |
| Verification satisfactory | Verification plus transition to `verified` | Reporter and affected technician | `verification_complete` | Required | Must be coupled to the verification result, not inferred from a generic update alone. |
| Verification failed/reopened | Unsatisfactory verification plus `reopened` | Affected technician | `verification_failed` | Required | Reporter notification is not explicitly required by the workflow; do not add without approval. |
| Report cancelled | Approved cancellation transition | Reporter and assigned technician, if any | `report_cancelled` | Documented; approval needed | Current mutation makes multiple updates; must be atomic with recipient calculation. |
| Comment added | Future comment action | Reporter, assigned technician, relevant coordinator | `comment_added` | Deferred | “Relevant coordinator” and additional-information classification are unresolved. |
| Assignment declined | Existing decline RPC | Coordinator(s) | No current enum | Deferred | Requires a new approved enum/type and explicit recipient rule. |

All messages should contain the least data necessary: event title, report reference/title, state summary, timestamp, and a report route only. Do not duplicate attachments, private storage paths, profile data, full work-log content, verification notes, or other users’ identities into the notification body.

## 7. Delivery-Channel Recommendation

### In-app notifications — recommended and required

This is the documented MVP channel. It can be delivered through the existing authenticated Supabase client, server rendering, RLS, and a small client component for read acknowledgment. The implementation must offer a list, a truthful unread indicator, accessible empty/loading/error states, keyboard navigation, and a safe route to an RLS-protected report.

### Email — explicitly out of scope

No approved requirement, provider dependency, safe-template configuration, sending worker, bounce handling, retry policy, or credential management was found. Adding email would expand privacy, operational, and failure-recovery scope. It requires separate product, provider, secret-management, retention, and reliability approval.

### Browser/mobile push — explicitly out of scope

No requirement or subscription schema exists. Push would require permission UX, browser subscription storage, a VAPID/key-management design, revocation, delivery failures, and mobile support. It is not justified for the current MVP.

## 8. Proposed Database and RLS Design

### Current security baseline

The current table already supports least-privilege recipient reading and acknowledgment: a recipient can select their own rows and update only `is_read`; broad update is revoked. There is no user-facing insert/delete path. This is appropriate and must be preserved.

### Creation-design options

1. **Application-level inserts after lifecycle mutations — not recommended.** They would be subject to the existing insert denial, would need a policy/security bypass to notify other users, cannot make the multi-statement mutations atomic, and are vulnerable to missed or duplicate notifications on retries.
2. **Transaction-safe lifecycle RPCs — viable but larger.** Convert each canonical lifecycle operation to a narrowly scoped RPC that validates the actor, changes the report/assignment/verification, and inserts notifications in one transaction. This is explicit but requires redesigning several current mutation paths and careful RPC authorization.
3. **Narrow database triggers/functions for canonical lifecycle events — recommended for the approved mandatory event set, subject to schema/security review.** Triggers execute in the transaction that changes reports, assignments, or verifications, so rollback rolls back notifications and direct RLS-compliant lifecycle changes cannot bypass the event. They must be narrowly defined, inspect old/new values, use minimum-necessary content, select only active recipients, and avoid recursive/unrelated updates.

Before adopting option 3, approve a migration that adds reliable idempotency. Recommended minimum additions are an immutable event key (or source event ID) plus a unique recipient/event constraint. Consider `actor_id` only if it is needed to enforce the approved self-notification rule. Add `read_at` only if the product needs it; `is_read` is sufficient for the initial read/unread MVP.

### Proposed RLS and data rules

- Retain current recipient-only select and `is_read`-only update controls.
- Do **not** add a broad authenticated insert policy and do not use a service-role client in the web application.
- Creation functions/triggers must compute recipients from authoritative report, assignment, verification, and active-profile data; callers must not supply arbitrary `recipient_id`, title, or message.
- Notification rows must reference only reports the calculated recipient may view under the current report visibility model. Opening the link must still rely on the report page’s existing RLS/auth checks.
- Add a stable ordering index suitable for the inbox cursor if query analysis shows the existing recipient/read indexes are insufficient (for example recipient plus creation time and ID).
- Define retention/archival explicitly before unbounded growth becomes an issue. Do not delete user records merely to clear an inbox.

## 9. Proposed Frontend and Backend Architecture

The following are **recommended new paths**, not existing files:

| Proposed path | Responsibility |
|---|---|
| `types/notifications.ts` | Narrow database/UI models, event labels, and paginated result states. |
| `utils/notifications/transform.ts` | Pure mapping, safe notification copy, cursor handling, and display formatting. |
| `utils/notifications/dal.ts` | Authenticated recipient-only list/count reads with field-minimal selects, bounds, cursor, and sanitized failures. |
| `utils/notifications/mutations.ts` | Recipient-owned acknowledgment update only; no arbitrary notification creation. |
| `actions/notifications.ts` | Server Action that authenticates first and invokes only the narrow acknowledge mutation. |
| `app/notifications/page.tsx` | `requireAuth('/notifications')`, server-rendered inbox, error/empty/incomplete states. |
| `components/notifications/notification-list.tsx` | Accessible list, load-more interaction, and read state. |
| `components/notifications/notification-bell.tsx` | Replaces the static header button with a keyboard-accessible link/popover only after unread data is truthful. |

Use the existing `AppShell`, `Link`, shared `Button`, `Card`, `Badge`, auth helpers, and Supabase server client. Keep the data fetch server-side; use a small client component only where optimistic/read acknowledgment interaction is needed. Do not add polling, realtime subscriptions, or a chart/UI dependency until separately approved.

## 10. Proposed Implementation Phases and Task Dependencies

### Phase 4C.1 — Product and database design approval

- Approve the event matrix, self-notification behavior, all-coordinator audience, retention, and initial scope.
- Choose and document the transaction-safe creation mechanism.
- Produce (but do not apply until approved) a migration/RLS review for idempotency, creation, ordering, and optional `read_at` needs.
- **Exit criterion:** a reviewed, least-privilege creation design that cannot accept arbitrary client recipients/content.

### Phase 4C.2 — Authoritative event creation

- Implement the approved database mechanism and align lifecycle mutations only as required by that mechanism.
- Ensure event rows are created or rolled back with the source lifecycle event.
- Preserve all existing report, attachment, dashboard, and role guards.
- **Exit criterion:** each approved event creates exactly one recipient row per approved recipient, with no rows for unauthorized or inactive recipients.

### Phase 4C.3 — Read-only inbox and acknowledgment

- Add types, DAL, server guard, page, bounded pagination, unread indicator, and recipient-owned mark-as-read action.
- Replace the static bell only after the unread query has truthful empty/error/incomplete behavior.
- **Exit criterion:** no notification content or count is presented as complete when the query is unavailable or incomplete.

### Phase 4C.4 — Local and authorized remote verification

- Add deterministic local mocks/unit coverage first.
- Obtain separate authorization before a remote RLS/integration run using disposable fixtures and verified cleanup.
- **Exit criterion:** all local tests pass; live RLS/atomicity verification is either passed under approval or recorded as a release blocker.

## 11. Testing and Acceptance Criteria

### Local mocked/unit tests

- Recipient resolver cases for every approved event: active coordinators, reporter, active/new/previous technician, no-assignment, duplicate recipient, inactive profile, and actor suppression if approved.
- Notification DAL query-chain mocks: success, empty, query error, exact-count missing, count/page mismatch, cursor boundary, and stable ordering.
- Inbox transforms/UI state tests: loading, empty, unavailable, incomplete, no additional page, link target, and safe message rendering.
- Acknowledgment tests: requires authenticated user, sends only `is_read`, treats zero updated rows as inaccessible/not found, and never changes title/message/recipient/type.
- Lifecycle contract tests: each approved source event emits the expected type/recipient set, status-only updates do not emit duplicates, and failure/rollback produces no delivery claim.
- Regression tests for report submission, assignment, decline, status transition, verification, attachments, role-aware dashboard, analytics fail-closed behavior, and Settings completeness.

### Remote integration tests — separate authorization required

- Recipient can select only their own notification and update only their own `is_read`.
- Recipient cannot insert, delete, change title/message/type/report/recipient, or acknowledge another user’s row.
- Creation mechanism honors role/ownership, active recipients, duplicate prevention, retry behavior, and transaction rollback.
- Report links remain RLS-protected even if a stale notification exists.
- Cross-role tests cover all five canonical roles plus unauthenticated access.

### Acceptance criteria

1. The MVP implements only approved in-app events and recipients.
2. A lifecycle operation and its required notifications commit/roll back together, or the UI clearly reports delivery failure without claiming completion; the former is preferred.
3. No user can read, create, change, or acknowledge another recipient’s notification.
4. Lists are bounded and cursor-paginated; unread totals and visible rows are never represented as complete when their completeness is unknown.
5. The bell/list are usable by keyboard and screen readers, with labelled controls and announced error/empty outcomes.
6. Existing report, attachment, dashboard, analytics, location, and settings behavior remains unchanged except for the approved notification integration.

## 12. Security and Privacy Considerations

- Use `requireAuth` before every notification route/action and the authenticated server-side Supabase client only.
- Rely on RLS for recipient isolation; server checks are additive, not a bypass.
- Do not include service-role credentials, signed attachment URLs, storage paths, email addresses, full verification notes, or other recipients in notification content.
- Re-authorize report navigation independently of notification ownership; a notification must not grant report access.
- Treat notification titles/messages as untrusted data at render time; render as text, not HTML.
- Preserve the current immutable-content/`is_read`-only protection and avoid client-supplied recipient/content inserts.
- Avoid realtime/polling until rate, authorization, connection, and privacy implications are explicitly reviewed.

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Missed/duplicate notifications after retries | Transaction-safe source mechanism plus a unique event/recipient idempotency design. |
| Privilege escalation through arbitrary recipient insertion | No client insert policy; internal creation computes recipients from authoritative data. |
| Notification link leaks report access | Existing report route auth/RLS remains the final authorization check. |
| Misleading unread count/history | Exact count only when available; cursor pagination and explicit unavailable/incomplete states. |
| Notification schema grows without retention | Approve retention/archival before bulk growth; begin with bounded UI reads. |
| Existing RLS runner cannot validate the new design as-is | Do not run it in Phase 4C planning. Its local fixture inserts notifications as a coordinator despite no insert policy and uses `assignment_created`, which is not in the local enum; align it only in a separately approved test-maintenance task. |
| Scope expansion into email/push/preferences | Keep all external channels and preference controls explicitly out of scope for MVP. |

## 14. Explicit Out-of-Scope Items

- Email, SMS, browser push, mobile push, SMTP/provider configuration, credentials, delivery workers, retry queues, and delivery analytics.
- Notification preferences, quiet hours, subscriptions, per-event opt-outs, and administrative broadcasts.
- Report comments and “additional information requested” UX until separately scoped.
- Assignment-decline notification type until approved.
- Notification deletion, bulk deletion, cross-user viewing, export, and administrator moderation.
- Realtime subscriptions, polling, webhooks, analytics charts, and any Phase 4D remote testing without separate authorization.
- Changes to existing attachment Storage behavior, report visibility, roles, migrations, RLS, or policies during the planning task.

## 15. Authorization and Verification Prerequisites for Future Work

Before Phase 4C implementation begins, obtain explicit approval for:

1. The recommended MVP event set and recipient matrix, including self-notification and all-coordinator behavior.
2. The database notification-creation mechanism and any required migration/RLS/index/idempotency changes.
3. The exact user-facing content and retention/read-timestamp policy.
4. The proposed frontend paths and bounded inbox/unread-count behavior.
5. A later, separately authorized remote RLS/integration plan; it must not use service-role access in the application, must use disposable fixtures, and must include cleanup/rollback verification.

This audit did not query Supabase, execute Storage/RPC operations, run the deferred RLS runner, inspect `.env.local`, install dependencies, modify application/schema/policy files, or change Git history.
