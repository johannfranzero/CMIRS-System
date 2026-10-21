# Phase 4C.6 — Owner Decision Summary

**Current status:** `NO-GO`  
**Purpose:** Collect explicit project-owner decisions for all 23 pending Phase 4C notification decisions.  
**Status rule:** This summary preserves every current `PENDING` status. It does not approve, reject, defer, or implement any decision.

## How to Use This Summary

For each ID, select one documented option or explicitly select the stated deferral where available. Security requirements are not optional shortcuts: requesting a different architecture requires a security-equivalent redesign and a fresh review. The approved delivery boundary remains **in-app notifications only**; external channels are out of scope.

## Product Behavior Decisions

These are product preferences because they define notification recipients, workflow meaning, and user-facing behavior. `P-01` through `P-05` and `P-09` are needed to establish the initial event and recipient matrix. `P-06` through `P-08` may defer only by explicit owner instruction.

### P-01 — Coordinator Audience

- **Question:** Who receives coordinator-targeted events?
- **Options:** All active coordinators; future on-call/team group.
- **Recommendation and rationale:** All active coordinators, because no group/on-call model exists.
- **MVP impact:** Blocks the MVP; it determines recipients for submission and completed/verification-required events.
- **Dependencies:** Defines recipients used by `S-02` RPC contracts and `S-03` per-recipient event keys; applies to `P-09` urgent presentation.
- **Classification:** Product preference.

### P-02 — Actor Notification

- **Question:** Does an actor receive an event when also a recipient?
- **Options:** Include actor; exclude actor.
- **Recommendation and rationale:** Exclude actor to avoid redundant alerts for reporter, technician, and coordinator actions.
- **MVP impact:** Blocks the MVP; it applies to every event recipient calculation.
- **Dependencies:** Required by the recipient selection in `S-02` and duplicate/noise handling in `S-03`.
- **Classification:** Product preference.

### P-03 — Completed Event

- **Question:** Does `completed` emit both `status_changed` and `verification_required`?
- **Options:** Both events; verification-required only; status-changed only.
- **Recommendation and rationale:** Both, because the workflow documents both state change and coordinator verification work.
- **MVP impact:** Blocks the MVP; it controls reporter/technician versus coordinator delivery and potential duplicate UI items.
- **Dependencies:** Sets completed-event behavior for `S-02` and the corresponding distinct event keys in `S-03`; depends on `P-01` and `P-02` recipient rules.
- **Classification:** Product preference.

### P-04 — Triage Without Assignment

- **Question:** May triage set report status to `assigned` with no assignment row?
- **Options:** Preserve current behavior; require `under_review`; require assignment in the same command.
- **Recommendation and rationale:** Do not permit `assigned` without a new assignment; use the assignment RPC for that transition so a technician recipient and accountable assignment exist.
- **MVP impact:** Blocks the MVP; it affects valid report state, technician availability, and the RPC contract.
- **Dependencies:** Constrains `S-02` triage and assignment commands and recipient rules for `P-01` through `P-03`.
- **Classification:** Product preference.

### P-05 — Same-Technician Reassignment

- **Question:** What happens if the requested technician is already active?
- **Options:** Reject/no-op; state update without event; create a new reassignment event.
- **Recommendation and rationale:** Reject as no-op with no notification to avoid duplicate assignment history and duplicate notices.
- **MVP impact:** Blocks the MVP; it defines reassignment idempotency and event semantics.
- **Dependencies:** Required by the assignment/reassignment command in `S-02` and duplicate prevention in `S-03`.
- **Classification:** Product preference.

### P-06 — Priority Event

- **Question:** Is `priority_changed` included in the first backend release?
- **Options:** Include now; defer.
- **Recommendation and rationale:** Defer until core lifecycle notifications are validated; inclusion requires event-key support and recipient checks for reporter and technician.
- **MVP impact:** Can defer; it must be explicitly excluded from the initial event matrix if deferred.
- **Dependencies:** If included, expands `S-02` and `S-03` with priority recipient and uniqueness rules; if deferred, requires a later approved event slice.
- **Classification:** Product preference; explicitly deferrable.

### P-07 — Comment/Request-Information Event

- **Question:** What constitutes additional-information request and who is the relevant coordinator?
- **Options:** Typed comment event; new workflow action/state; defer.
- **Recommendation and rationale:** Defer because there is no current UI/action/classification and the recipient rule is incomplete.
- **MVP impact:** Can defer; implementation now would invent workflow behavior.
- **Dependencies:** A later decision must define the trigger, coordinator ownership, and any `S-02` command/event contract.
- **Classification:** Product preference; explicitly deferrable.

### P-08 — Assignment-Decline Event

- **Question:** Should technician decline notify coordinator(s)?
- **Options:** Add approved enum/event; no notification; overload an existing type.
- **Recommendation and rationale:** Defer; never overload an existing type because the current enum has no decline type and recipient scope is unapproved.
- **MVP impact:** Can defer; it is not part of the initial backend event matrix.
- **Dependencies:** A later workflow and event-type decision are required before `S-02` can support decline notices.
- **Classification:** Product preference; explicitly deferrable.

### P-09 — Urgent Hazard Presentation

- **Question:** How is urgent submission represented?
- **Options:** `report_submitted` with urgent marker; new event type.
- **Recommendation and rationale:** Use `report_submitted` with a minimum necessary urgent marker because the enum has no urgent type and coordinator attention is documented.
- **MVP impact:** Blocks the MVP; it determines the payload contract for urgent coordinator attention.
- **Dependencies:** Uses the coordinator audience in `P-01`; is implemented by submission behavior in `S-02` and protected by minimal-payload requirements in `S-05`.
- **Classification:** Product preference.

### P-10 — Retention and Read Timestamp

- **Question:** How long are notifications retained, and is `read_at` needed?
- **Options:** Indefinite plus `is_read`; retention/archival policy; add `read_at`.
- **Recommendation and rationale:** Use `is_read` only for MVP and approve an explicit retention review before scale; this avoids a premature schema/UI commitment while acknowledging storage and privacy obligations.
- **MVP impact:** Retention direction blocks the MVP; the `read_at` portion can defer if the owner explicitly accepts `is_read` only.
- **Dependencies:** Sets notification storage and inbox behavior; a later `read_at` decision may require a migration and UI update in `I-06`.
- **Classification:** Product preference; retention is mandatory now, `read_at` is deferrable.

## Security and Database Architecture Requirements

These seven decisions are mandatory security requirements for any approved notification-bearing lifecycle implementation. They are not permission to weaken atomicity, least privilege, or RLS boundaries. The owner can request a redesign, but no implementation may replace them with an unsafe shortcut.

### S-01 — Creation Mechanism

- **Question:** How are lifecycle changes and notifications made atomic?
- **Options:** Narrow command RPCs; trigger-only creation; post-mutation app insert.
- **Recommendation and rationale:** Narrow `SECURITY DEFINER` command RPCs. Trigger-only creation cannot make current multi-request commands atomic, and app inserts are unsafe/blocked.
- **MVP impact:** Blocks the MVP; it selects the transaction boundary, rollback behavior, recipient context, and RLS safety model.
- **Dependencies:** Governs `S-02` through `S-07` and the additive design in `I-01`.
- **Classification:** Mandatory security and database architecture requirement.

### S-02 — RPC Contracts

- **Question:** Approve the proposed submit, triage, assign/reassign, status, and verification RPC boundaries?
- **Options:** Approve as specified; reduce initial event commands; redesign.
- **Recommendation and rationale:** Approve the five proposed contracts, with priority/comment/decline events deferred, so Server Actions and DAL calls have explicit authorization and state-transition boundaries.
- **MVP impact:** Blocks the MVP; it determines the exact lifecycle commands, authorization, and Server Action/DAL migration.
- **Dependencies:** Requires `P-01` through `P-05`, `P-09`, and the retention direction in `P-10`; implements `S-01` and carries `S-03` through `S-07` controls.
- **Classification:** Mandatory security and database architecture requirement.

### S-03 — Command Replay and Idempotency

- **Question:** Approve `p_request_id`, receipt storage, and per-recipient event-key uniqueness?
- **Options:** Receipt plus event keys; source-only keys without command replay; no idempotency.
- **Recommendation and rationale:** Receipt table plus event-key uniqueness, which makes retries safe and prevents duplicate report/notification effects.
- **MVP impact:** Blocks the MVP; it determines replay safety and duplicate prevention.
- **Dependencies:** Must match the final event matrix from `P-01` through `P-09` and is added through `I-01`/implemented in `S-02`.
- **Classification:** Mandatory security and database architecture requirement.

### S-04 — Notification Insert Surface

- **Question:** May a client or generic function insert notification rows?
- **Options:** Generic authenticated insert; service-role app client; internal command/helper only.
- **Recommendation and rationale:** Internal helper callable only by authorized command RPCs; no service role in the web app. Generic paths permit forged recipient/content or bypass least privilege.
- **MVP impact:** Blocks the MVP; it prevents forged notifications and an authorization bypass.
- **Dependencies:** Enforced by `S-01`, `S-02`, `S-05`, and the staged write restrictions in `S-06`.
- **Classification:** Mandatory security requirement.

### S-05 — Function Hardening

- **Question:** Must all new privileged functions follow fixed path/grant rules?
- **Options:** Existing hardened convention; broader defaults.
- **Recommendation and rationale:** Fixed `search_path`, qualified names, `auth.uid()` checks, revoked `PUBLIC`, `authenticated` execution only, and minimal returns to control `SECURITY DEFINER` escalation risk.
- **MVP impact:** Blocks the MVP; it protects identity, privilege, and notification/report data.
- **Dependencies:** Applies to every function selected by `S-01`/`S-02` and supports the insert boundary in `S-04`.
- **Classification:** Mandatory security requirement.

### S-06 — Direct Lifecycle DML

- **Question:** Should direct authenticated writes be restricted after RPC migration?
- **Options:** Retain direct policies; restrict covered writes after conversion; blanket removal.
- **Recommendation and rationale:** Staged restriction only after each legitimate writer is converted and tested. Retaining writes permits notification bypass; blanket removal risks breaking workflows.
- **MVP impact:** Blocks the secure MVP architecture; its release can occur later only after conversion and testing.
- **Dependencies:** Depends on `S-02`, `I-01`, `I-02`, `I-03`, and `I-04`; rollback requires `S-07`.
- **Classification:** Mandatory security and database architecture requirement.

### S-07 — Rollback

- **Question:** How is a failed rollout reversed?
- **Options:** Revert action only; restore exact policy/action pair; broad temporary bypass.
- **Recommendation and rationale:** Restore only the matching prior policy/privilege and Server Action together; never use a service role or broad insert policy.
- **MVP impact:** Blocks the MVP; it defines failure recovery without bypassing security.
- **Dependencies:** Required by `S-01`, `S-02`, `S-06`, and the rollout/restriction stage in `I-02`.
- **Classification:** Mandatory security requirement.

## Technical Implementation and Test Authorizations

These are controlled execution decisions. They do not change product semantics, but authorize the engineering steps needed to implement and validate the approved requirements.

### I-01 — Additive Migration Design

- **Question:** Approve creation of receipt/event-key/index/function migrations after review?
- **Options:** Approve additive phase; request redesign; no backend work.
- **Recommendation and rationale:** Approve only the additive migration phase first, enabling RPCs without immediately breaking current writes.
- **MVP impact:** Blocks safe backend implementation; no database function, constraint, grant, or policy migration may be created before this is authorized.
- **Dependencies:** Requires approved `S-01` through `S-07` and the product event matrix; precedes `I-02` through `I-04`.
- **Classification:** Technical implementation authorization.

### I-02 — Policy Restriction Release

- **Question:** Approve later RLS/privilege restrictions only after RPC/action conversion?
- **Options:** Stage after conversion; restrict immediately; retain indefinitely.
- **Recommendation and rationale:** Separate gated release after local validation. Immediate restriction can break workflows; indefinite retention leaves a bypass.
- **MVP impact:** Can defer for additive work, but blocks the direct-DML restriction release.
- **Dependencies:** Requires complete `S-02` conversion, `S-06`, `S-07`, and local success under `I-03`/`I-04`.
- **Classification:** Technical implementation authorization; explicitly deferrable until the restriction release.

### I-03 — Local Database Validation

- **Question:** Authorize a local Supabase CLI/PostgreSQL test environment and rollback-scoped SQL tests?
- **Options:** Local database tests; mocked tests only.
- **Recommendation and rationale:** Authorize isolated local validation before any remote test because mocks cannot verify SQL transactions, grants, trigger interaction, or RLS behavior.
- **MVP impact:** Blocks backend validation; local proof is required before requesting remote access.
- **Dependencies:** Follows `I-01`; validates `S-01` through `S-07` and gates `I-05`.
- **Classification:** Technical implementation and security-validation authorization.

### I-04 — Mocked/Unit Validation

- **Question:** Approve updates to existing action/DAL runtime mocks and unit suites?
- **Options:** Approve; defer.
- **Recommendation and rationale:** Approve with backend implementation to verify input mapping, role errors, RPC result handling, and regressions locally.
- **MVP impact:** Blocks local backend implementation and validation.
- **Dependencies:** Follows final `S-02` contracts and supports `I-01`/`I-03` without contacting remote Supabase.
- **Classification:** Technical implementation authorization.

### I-05 — Remote Integration/RLS Verification

- **Question:** Authorize remote testing after local gates pass?
- **Options:** Approve separate remote plan; defer remote verification.
- **Recommendation and rationale:** Keep separately authorized and deferred until local success. Remote testing is required to verify deployed grants, ownership, RLS, `auth.uid()`, concurrency, and cleanup.
- **MVP impact:** Can defer for local work; blocks deployment, release, and any claim of deployed RLS correctness.
- **Dependencies:** Requires `I-01`, `I-03`, and `I-04` to pass first, plus a separate remote fixture/cleanup authorization.
- **Classification:** Technical implementation authorization; explicitly deferrable for local-only work.

### I-06 — Inbox and Bell UI Work

- **Question:** Authorize inbox, read/unread action, bell, and responsive UI after backend truthfulness?
- **Options:** Backend only; backend then UI.
- **Recommendation and rationale:** Defer to a separate Phase 4C UI approval so the UI never implies notification delivery before the backend/RLS behavior is valid.
- **MVP impact:** Can defer for backend-only work; blocks completion of the full in-app MVP.
- **Dependencies:** Requires stable `S-02` contracts, approved `P-10` read model, local validation under `I-03`/`I-04`, and later remote authorization before release.
- **Classification:** Technical implementation authorization; explicitly deferrable for a backend stage.

## Minimum Decisions Needed to Start Safely

To replace the current `NO-GO` with a limited local-backend authorization, the owner must:

1. Select options for `P-01` through `P-05`, `P-09`, and the retention direction in `P-10`.
2. Select or explicitly defer `P-06`, `P-07`, and `P-08`; explicitly defer `read_at` only if `is_read` is accepted for MVP.
3. Approve the mandatory security architecture and safeguards in `S-01` through `S-07`.
4. Authorize `I-01`, `I-03`, and `I-04` for a bounded local-only implementation and validation phase.
5. State whether `I-02`, `I-05`, and `I-06` remain deferred under their documented boundaries: no restriction release, no remote operations/deployment, and no UI completion claim.

## How to Submit and Record Decisions

Submit a written owner response using `ID = selected option` for every item above, including explicit `defer` selections where offered. State any scope boundary for authorizations such as local-only testing or a later remote-testing gate.

In the next approval-recording phase, each response should be cited as approval evidence, the decision register should update only the selected IDs from `PENDING` to the appropriate status, and readiness should be reassessed against the remaining blockers. Until that record is created and reviewed, `NO-GO` remains in effect.

## Source Boundary

- `docs/frontend/PHASE_4C_3_NOTIFICATION_APPROVAL_CHECKLIST.md`
- `docs/frontend/PHASE_4C_4_NOTIFICATION_APPROVAL_RESOLUTION.md`
- `docs/frontend/PHASE_4C_5_NOTIFICATION_DECISION_REVIEW.md`

No application code, tests, migrations, SQL functions, database schema, RLS policy, environment file, dependency, remote Supabase resource, integration test, commit, or push was changed for this summary.
