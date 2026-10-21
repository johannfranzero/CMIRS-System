# CMIRS — Phase 4C.3 Notification Approval Checklist

**Purpose:** decision checklist before Phase 4C backend implementation.  
**Status:** recommendations only; no unresolved behavior is approved by this document.

## Confirmed Scope

- MVP delivery is **in-app only**. Email, SMS, push, preferences, broadcasts, and notification administration remain out of scope.
- Recipient-owned notification reads and `is_read` acknowledgment remain the security baseline.
- Required lifecycle notification creation must be atomic; application-level post-mutation inserts are not an approved option.

## Product Decisions

| Decision | Question requiring approval | Supported alternatives | Impact | Recommendation | Required now? |
|---|---|---|---|---|---|
| Coordinator audience | Who receives coordinator-targeted events? | All active coordinators; future on-call/team group | Determines recipients for submission and completed/verification-required events. | All active coordinators, because no group/on-call model exists. | **Yes** |
| Actor notification | Does an actor receive an event when also a recipient? | Include actor; exclude actor | Affects duplicate/noisy notifications for reporter, technician, and coordinator actions. | Exclude the actor; it avoids redundant alerts. | **Yes** |
| Completed event | Does `completed` emit both `status_changed` and `verification_required`? | Both events; verification-required only; status-changed only | Controls reporter/technician vs coordinator delivery and potential duplicate UI items. | Both, because the workflow documents both state change and coordinator verification work. | **Yes** |
| Triage without assignment | May triage set report status to `assigned` with no assignment row? | Preserve current behavior; require `under_review`; require assignment in the same command | Affects valid state, technician recipient availability, and RPC contract. | Do not permit `assigned` without a new assignment; use assignment RPC for that transition. | **Yes** |
| Same-technician reassignment | What happens if the requested technician is already active? | Reject/no-op; state update without event; create a new reassignment event | Affects assignment history and duplicate notification semantics. | Reject as no-op with no notification. | **Yes** |
| Priority event | Is `priority_changed` included in the first backend release? | Include now; defer | Inclusion requires event-key support and recipient checks for reporter/technician. | Defer until core lifecycle notifications are validated. | Can defer |
| Comment/request-info event | What constitutes additional-information request and who is the relevant coordinator? | Typed comment event; new workflow action/state; defer | No current UI/action/classification exists; recipient rule is incomplete. | Defer. | Can defer |
| Assignment decline event | Should technician decline notify coordinator(s)? | Add approved enum/event; no notification; overload an existing type | Current enum has no decline type and recipient scope is unapproved. | Defer; never overload an existing type. | Can defer |
| Urgent hazard presentation | How is urgent submission represented? | `report_submitted` with urgent marker; new event type | Enum has no urgent type; coordinator attention is documented. | Use `report_submitted` with minimum necessary urgent marker. | **Yes** |
| Retention/read timestamp | How long are notifications retained, and is `read_at` needed? | Indefinite + `is_read`; retention/archival policy; add `read_at` | Affects schema, storage growth, privacy, and UI history. | MVP uses `is_read` only; approve an explicit retention review before scale. | Retention: **Yes**; `read_at`: can defer |

## Security and Architecture Decisions

| Decision | Question requiring approval | Supported alternatives | Impact | Recommendation | Required now? |
|---|---|---|---|---|---|
| Creation mechanism | How are lifecycle changes and notifications made atomic? | Narrow command RPCs; trigger-only creation; post-mutation app insert | Determines rollback, recipient context, and RLS safety. | Narrow `SECURITY DEFINER` command RPCs. Trigger-only design cannot make current multi-request commands atomic; app inserts are unsafe/blocked. | **Yes** |
| RPC contracts | Approve the proposed submit, triage, assign/reassign, status, and verification RPC boundaries? | Approve as specified; reduce initial event commands; redesign | Determines Server Action/DAL migration and exact authorization. | Approve the five proposed contracts, with priority/comment/decline events deferred. | **Yes** |
| Command replay | Approve `p_request_id`, receipt storage, and per-recipient event-key uniqueness? | Receipt + event keys; source-only keys without command replay; no idempotency | Determines retry safety and duplicate prevention. | Receipt table plus event-key uniqueness. | **Yes** |
| Notification insert surface | May a client or generic function insert notification rows? | Generic authenticated insert; service-role app client; internal command/helper only | Generic paths permit forged recipient/content or bypass least privilege. | Internal helper callable only by authorized command RPCs; no service role in web app. | **Yes** |
| Function hardening | Must all new privileged functions follow fixed path/grant rules? | Existing hardened convention; broader defaults | Controls `SECURITY DEFINER` escalation risk. | Fixed `search_path`, qualified names, `auth.uid()` checks, revoke `PUBLIC`, grant `authenticated` only, minimal returns. | **Yes** |
| Direct lifecycle DML | Should direct authenticated writes be restricted after RPC migration? | Retain direct policies; restrict covered writes after conversion; blanket removal | Retaining writes allows bypass; blanket removal risks breaking workflows. | Staged restriction only after each legitimate writer is converted and tested. | **Yes** |
| Rollback | How is a failed rollout reversed? | Revert action only; restore exact policy/action pair; broad temporary bypass | Impacts availability and security during recovery. | Restore only the matching prior policy/privilege and Server Action together; never use a service role or broad insert policy. | **Yes** |

## Implementation and Test Authorizations

| Decision | Question requiring approval | Supported alternatives | Impact | Recommendation | Required now? |
|---|---|---|---|---|---|
| Additive migration design | Approve creation of receipt/event-key/index/function migrations after review? | Approve additive phase; request redesign; no backend work | Enables RPCs without immediately breaking current writes. | Approve only the additive migration phase first. | **Yes** before editing |
| Policy restriction release | Approve later RLS/privilege restrictions only after RPC/action conversion? | Stage after conversion; restrict immediately; retain indefinitely | Immediate restriction can break existing workflows; indefinite retention leaves bypass. | Separate gated release after local validation. | **Yes**, but later execution gate |
| Local database validation | Authorize a local Supabase CLI/PostgreSQL test environment and rollback-scoped SQL tests? | Local database tests; mocked tests only | Mocks cannot verify SQL transaction, grants, trigger interaction, or RLS behavior. | Authorize isolated local validation before any remote test. | **Yes** before running |
| Mocked/unit validation | Approve updates to existing action/DAL runtime mocks and unit suites? | Approve; defer | Verifies input mapping, role errors, RPC result handling, and regressions locally. | Approve with backend implementation. | **Yes** before editing |
| Remote integration/RLS | Authorize remote testing after local gates pass? | Approve separate remote plan; defer remote verification | Required to confirm deployed grants, ownership, RLS, `auth.uid()`, concurrency, and cleanup. | Keep separately authorized and deferred until local success. | Can defer, but release risk remains |
| UI work | Authorize inbox, read/unread action, bell, and responsive UI after backend truthfulness? | Backend only; backend then UI | UI must not imply delivery before backend/RLS validation. | Defer to a separate Phase 4C UI approval. | Can defer |

## Mandatory Approval Set Before Backend Implementation

Approve all of the following together:

- [ ] In-app-only scope and core event set.
- [ ] All-active-coordinator audience.
- [ ] Actor exclusion rule.
- [ ] Completed dual-event rule.
- [ ] No `assigned` status without an assignment.
- [ ] Same-technician reassignment is a no-op/rejection.
- [ ] Urgent submissions use `report_submitted` with an urgent marker.
- [ ] Retention direction for MVP (`is_read` only; no `read_at` now).
- [ ] Narrow transaction-safe command RPC architecture.
- [ ] Five-RPC contract scope and deferred priority/comment/decline events.
- [ ] Request receipt/event-key idempotency design.
- [ ] No generic insert/service-role application bypass.
- [ ] Staged direct-DML restriction and paired rollback strategy.
- [ ] Additive migration review and local validation authorization.

## Final Approval Matrix

| Approval category | Must approve before backend implementation | May defer | Separate authorization required |
|---|---|---|---|
| **Product** | Coordinator audience; actor rule; completed dual event; triage/assignment rule; same-tech rule; urgent presentation; core event set; MVP retention direction | Priority events; comments/request-info; assignment-decline events; `read_at`; UI scope | N/A |
| **Security** | Command RPC architecture; receipt/event-key idempotency; no generic insert; function hardening; staged DML restrictions; rollback strategy | Final retention/archival mechanism after MVP | Policy-restriction deployment gate |
| **Implementation** | Additive migration design; Server Action/DAL RPC conversion; mocked/unit test updates | Inbox/bell UI | Local database environment and SQL test execution |
| **Remote testing** | N/A for local backend work | Remote verification may remain deferred | Remote Supabase/RLS/concurrency test plan, disposable fixtures, cleanup, and explicit permission |

## Boundary Confirmation

This checklist consolidates the Phase 4C planning documents only. It does not approve or implement any option. No application code, existing documentation, schema, migration, RLS policy, environment file, remote Supabase state, dependency, commit, or push was changed; no integration test was run.
