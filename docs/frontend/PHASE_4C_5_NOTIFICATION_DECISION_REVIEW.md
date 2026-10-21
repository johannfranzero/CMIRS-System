# Phase 4C.5 — Notification Decision Review and Approval Preparation

**Current readiness:** `NO-GO`  
**Purpose:** Owner-facing decision sheet derived from the Phase 4C.2 specification, Phase 4C.3 checklist, and Phase 4C.4 approval resolution.  
**Decision status rule:** This document does not approve, reject, or defer any item. It preserves the Phase 4C.4 register: one approved scope decision and 23 pending decisions.

## 1. Owner Summary

The notification MVP is limited to **in-app notifications**. That delivery boundary is the only approved decision. The remaining work is not ready to start because the event/recipient rules, atomic command architecture, idempotency, direct-write restriction strategy, and local implementation/test authorization remain pending.

The owner needs to make product choices where multiple safe behaviors are possible, and authorize the proposed security architecture and bounded local work. Several items may be deferred, but only through an explicit owner decision; a planning recommendation is not a deferral.

**Register count:** 24 decisions — `APPROVED`: 1; `PENDING`: 23; `REJECTED`: 0; `DEFERRED`: 0.

## 2. Approved Scope

| ID | Decision | Options | Documented recommendation | Current status | Plain-language impact | Blocks implementation | Owner decision |
|---|---|---|---|---|---|---|---|
| SCP-01 | Delivery scope | In-app only; add external delivery channels | In-app only; email, SMS, and push out of scope | `APPROVED` | The MVP stores and displays notices inside CMIRS only; it does not send external messages. | No | `APPROVED — existing project decision D7` |

## 3. Product Behavior Decisions Requiring Owner Approval

These are genuine product/workflow choices. The architecture cannot infer them safely because they determine who receives a notification and when.

| ID | Question | Options from source | Documented recommendation | Current status | Plain-language impact | Blocks implementation | Owner decision |
|---|---|---|---|---|---|---|---|
| P-01 | Who receives coordinator-targeted events? | All active coordinators; future on-call/team group; no coordinator notification | All active coordinators | `PENDING` | Sets who is alerted for submitted, unassigned, completed, and urgent reports. | Yes | `AWAITING OWNER INPUT` |
| P-02 | Should an actor receive a notification for their own action? | Include actor; exclude actor | Exclude actor | `PENDING` | Controls whether users receive redundant alerts for actions they just performed. | Yes | `AWAITING OWNER INPUT` |
| P-03 | What is emitted when a report is completed? | Both `status_changed` and `verification_required`; verification-required only; status-changed only | Both events with distinct meanings | `PENDING` | Determines whether completion creates separate status and coordinator-verification notices. | Yes | `AWAITING OWNER INPUT` |
| P-04 | Can triage set `assigned` without a technician assignment? | Preserve current behavior; require `under_review`; require assignment in the same command | Do not permit `assigned` without a new assignment; use assignment RPC | `PENDING` | Prevents an assigned report with no technician recipient or accountable assignee. | Yes | `AWAITING OWNER INPUT` |
| P-05 | What happens when assigning the already-active technician? | Reject/no-op; state update without event; create new reassignment event | Reject as no-op with no notification | `PENDING` | Prevents duplicate assignment history and needless notices. | Yes | `AWAITING OWNER INPUT` |
| P-06 | Is `priority_changed` in the first backend release? | Include now; defer | Defer until core lifecycle notifications are validated | `PENDING` | Inclusion adds an event, recipient rules, and duplicate protection; deferral omits it from the initial event set. | No, if explicitly deferred | `AWAITING OWNER INPUT` |
| P-07 | Is there a comment/additional-information notification? | Typed comment event; new workflow action/state; defer | Defer | `PENDING` | No current workflow identifies the relevant coordinator or a typed request; implementing it now would guess at product behavior. | No, if explicitly deferred | `AWAITING OWNER INPUT` |
| P-08 | Should assignment decline notify coordinators? | Add approved enum/event; no notification; overload an existing type | Defer; never overload an existing type | `PENDING` | A new decline workflow/event cannot be safely represented by a different event type. | No, if explicitly deferred | `AWAITING OWNER INPUT` |
| P-09 | How is an urgent submission represented? | `report_submitted` with urgent marker; new event type | Existing `report_submitted` with a minimum necessary urgent marker | `PENDING` | Determines the safe, recognizable urgent indication without inventing a new unapproved event type. | Yes | `AWAITING OWNER INPUT` |
| P-10 | What are retention and read-state requirements? | Indefinite plus `is_read`; retention/archival policy; add `read_at` | Use `is_read` only for MVP; approve an explicit retention review before scale | `PENDING` | Retention affects privacy and storage; `read_at` affects schema and UI history. | Yes for retention direction; `read_at` may defer | `AWAITING OWNER INPUT` |

## 4. Security and Database Architecture Requirements

These controls are not interchangeable convenience preferences. If the owner chooses the proposed notification-bearing lifecycle architecture, the documented safeguards are mandatory to keep report mutation and notification creation atomic, least-privilege, and non-forgeable. The owner may request a redesign, but implementation must not weaken these protections.

| ID | Question | Options from source | Documented recommendation | Current status | Plain-language impact | Blocks implementation | Owner decision |
|---|---|---|---|---|---|---|---|
| S-01 | How are lifecycle changes and notifications made atomic? | Narrow command RPCs; trigger-only creation; post-mutation app insert | Narrow lifecycle-specific `SECURITY DEFINER` command RPCs | `PENDING` | A successful report change and its required notices succeed or fail together; application post-mutation inserts are unsafe and blocked. | Yes | `AWAITING OWNER INPUT` |
| S-02 | Which lifecycle RPC boundaries are approved? | Approve proposed submit, triage, assign/reassign, status, and verification commands; reduce initial commands; redesign | Five proposed RPCs, with priority/comment/decline deferred | `PENDING` | Defines the only approved paths for notification-bearing report changes and their authorization checks. | Yes | `AWAITING OWNER INPUT` |
| S-03 | How are command replay and duplicate notices prevented? | Receipt plus event keys; source-only keys without replay; no idempotency | Request receipt plus per-recipient event-key uniqueness | `PENDING` | A retry returns the original result without creating duplicate reports or notifications. | Yes | `AWAITING OWNER INPUT` |
| S-04 | Who may insert notification rows? | Generic authenticated insert; service-role app client; internal command/helper only | Internal helper callable only by authorized command RPCs; no service role in web app | `PENDING` | Stops clients from forging notification recipients or content. | Yes | `AWAITING OWNER INPUT` |
| S-05 | What hardening applies to privileged functions? | Existing hardened convention; broader defaults | Fixed `search_path`, qualified references, `auth.uid()` authorization, least-privilege grants, revoked `PUBLIC`, minimal returns | `PENDING` | Prevents `SECURITY DEFINER` functions from becoming a privilege-escalation or data-disclosure path. | Yes | `AWAITING OWNER INPUT` |
| S-06 | When are direct lifecycle table writes restricted? | Retain direct policies; restrict covered writes after conversion; blanket removal | Staged restriction after each legitimate writer is converted and tested | `PENDING` | Removes notification bypasses without breaking existing report workflows. | Yes | `AWAITING OWNER INPUT` |
| S-07 | How is a failed rollout reversed? | Revert action only; restore matching policy/action pair; broad temporary bypass | Restore only the matching prior policy/privilege and Server Action; never use broad bypass | `PENDING` | Protects availability while avoiding a security-reducing emergency path. | Yes | `AWAITING OWNER INPUT` |

## 5. Technical Implementation Authorizations

These items turn approved requirements into bounded engineering work. They are not product-semantics choices, but they still need authorization because they create migrations, test environments, policy release gates, or user-visible UI.

| ID | Question | Options from source | Documented recommendation | Current status | Plain-language impact | Blocks implementation | Owner decision |
|---|---|---|---|---|---|---|---|
| I-01 | May the additive migration phase be created after review? | Approve additive phase; request redesign; no backend work | Approve only the additive phase first | `PENDING` | Allows receipt/event-key/index/function additions without immediately removing working write paths. | Yes | `AWAITING OWNER INPUT` |
| I-02 | When may direct-DML restrictions be released? | Stage after conversion; restrict immediately; retain indefinitely | Separate gated release after local validation | `PENDING` | Protects current workflows while actions are converted; a later release removes the bypass. | No for additive work; yes before restriction release | `AWAITING OWNER INPUT` |
| I-03 | May local database/function validation run? | Local database tests; mocked tests only | Authorize isolated local validation before any remote test | `PENDING` | Mocks cannot prove SQL transactions, function grants, RLS behavior, or trigger interaction. | Yes | `AWAITING OWNER INPUT` |
| I-04 | May mocked/unit tests be updated? | Approve; defer | Approve with backend implementation | `PENDING` | Covers input mapping, role errors, RPC handling, and local regressions without remote data. | Yes | `AWAITING OWNER INPUT` |
| I-05 | May remote integration/RLS testing run later? | Approve separate remote plan; defer remote verification | Keep separate and defer until local success | `PENDING` | Remote checks prove deployed grants, RLS, `auth.uid()`, concurrency, and cleanup; they are not covered by local tests. | No for local work; yes before deployment/release | `AWAITING OWNER INPUT` |
| I-06 | May inbox, read/unread actions, bell, and responsive UI be built? | Backend only; backend then UI | Defer to a separate Phase 4C UI approval | `PENDING` | Keeps the interface from implying delivery before backend/RLS truthfulness is proven. | No for backend-only work; yes for the complete in-app MVP | `AWAITING OWNER INPUT` |

## 6. Decisions That May Be Safely Deferred

The following decisions are eligible for deferral, but their status remains `PENDING` until the owner explicitly selects the deferral. Deferral does not silently remove a requirement; it defines what the first release excludes.

| Decision | Safe deferral boundary | Dependency created by deferral |
|---|---|---|
| P-06 — Priority event | Exclude `priority_changed` from the first backend event matrix. | Add priority recipients, event keys, and tests in a later approved slice. |
| P-07 — Comment/request-info | Do not add comment/request-info notifications until a typed workflow and coordinator rule exist. | Later design must define the triggering action, ownership, and recipient set. |
| P-08 — Assignment decline | Do not add a decline notification until a dedicated event/workflow is approved. | Later work needs a new enum/event contract; do not overload existing types. |
| P-10 — `read_at` portion | Keep existing `is_read` only for MVP. | A later migration/UI decision is needed if audit-grade read timestamps are required. Retention direction still requires approval now. |
| I-02 — Restriction release | Keep current direct writes while additive RPCs/actions are implemented and locally validated. | The later release must inventory every writer, restrict only converted paths, and carry paired rollback. |
| I-05 — Remote testing | Complete only local work and make no deployment/release claim. | Remote RLS, grants, concurrency, cleanup, and deployed behavior remain unverified. |
| I-06 — UI work | Implement no inbox/bell UI in the backend stage. | The in-app MVP remains incomplete until a separate UI approval and accessibility review. |

## 7. Dependencies and Minimum Approval Set

### Dependencies

- `P-01`, `P-02`, `P-03`, `P-04`, `P-05`, and `P-09` define the recipient and event matrix used by `S-02` RPC contracts and `S-03` idempotency keys.
- `P-10` determines whether the initial storage/UI contract remains `is_read` only and establishes the retention direction for notification rows.
- `S-01` selects the atomicity boundary. `S-02` then defines the command interfaces, while `S-04`, `S-05`, and `S-07` are mandatory constraints on those commands.
- `S-03` must be designed with the final approved event matrix; otherwise retry handling could duplicate or omit notices.
- `S-06` depends on every legitimate report lifecycle writer being converted and tested. `I-02` is the separate release authorization for that restriction.
- `I-01`, `I-03`, and `I-04` authorize the first bounded engineering/testing phase. `I-05` is required only before remote verification, deployment, or release claims. `I-06` follows a stable backend contract.

### Minimum approvals to begin a safe local backend phase

1. Confirm `SCP-01` remains the in-app-only boundary.
2. Decide `P-01` through `P-05`, `P-09`, and the retention direction in `P-10`.
3. Explicitly approve or defer `P-06`, `P-07`, and `P-08`; defer the `read_at` portion of `P-10` only if `is_read` is accepted for MVP.
4. Approve the security model in `S-01` through `S-07`, including the staged—not immediate—direct-DML restriction approach.
5. Authorize the additive migration design, local database/function validation, and mocked/unit validation in `I-01`, `I-03`, and `I-04`.
6. Leave `I-02`, `I-05`, and `I-06` pending only if their stated deferral boundaries are accepted: no policy restriction release, no remote testing/deployment, and no UI completion claim.

Until this set is recorded, the `NO-GO` status remains in effect.

## 8. Compact Owner Approval Matrix

Every field below is intentionally blank pending an explicit project-owner decision. Mandatory security controls are listed as requirements, not optional shortcuts.

| Decision ID | Question | Options | Recommendation | Mandatory or deferrable | Owner decision |
|---|---|---|---|---|---|
| SCP-01 | Delivery scope | In-app only; external channels | In-app only | Already approved | `APPROVED — existing decision D7` |
| P-01 | Coordinator audience | All active; on-call/team; none | All active | Mandatory | `AWAITING OWNER INPUT` |
| P-02 | Notify actor | Include; exclude | Exclude | Mandatory | `AWAITING OWNER INPUT` |
| P-03 | Completed event count | Both; verification only; status only | Both | Mandatory | `AWAITING OWNER INPUT` |
| P-04 | Triage without assignment | Preserve; `under_review`; assignment command | Require assignment command | Mandatory | `AWAITING OWNER INPUT` |
| P-05 | Same technician reassignment | Reject/no-op; no-event update; new event | Reject/no-op | Mandatory | `AWAITING OWNER INPUT` |
| P-06 | Priority event | Include; defer | Defer | Deferrable | `AWAITING OWNER INPUT` |
| P-07 | Comment/request-info event | Typed event; workflow; defer | Defer | Deferrable | `AWAITING OWNER INPUT` |
| P-08 | Assignment-decline event | New event; none; overload | Defer; do not overload | Deferrable | `AWAITING OWNER INPUT` |
| P-09 | Urgent representation | Urgent marker; new type | Marker | Mandatory | `AWAITING OWNER INPUT` |
| P-10 | Retention/read timestamp | `is_read`; retention policy; `read_at` | `is_read` MVP; retention review | Retention mandatory; `read_at` deferrable | `AWAITING OWNER INPUT` |
| S-01 | Atomic creation design | RPCs; triggers; app insert | Command RPCs | Mandatory security requirement | `AWAITING OWNER INPUT` |
| S-02 | Lifecycle command set | Approve five; reduce; redesign | Five RPCs | Mandatory security requirement | `AWAITING OWNER INPUT` |
| S-03 | Replay/duplicates | Receipt+keys; source keys; none | Receipt+keys | Mandatory security requirement | `AWAITING OWNER INPUT` |
| S-04 | Insert surface | Generic; service role; internal helper | Internal helper only | Mandatory security requirement | `AWAITING OWNER INPUT` |
| S-05 | Function hardening | Hardened convention; broad defaults | Hardened convention | Mandatory security requirement | `AWAITING OWNER INPUT` |
| S-06 | Direct DML | Retain; staged restriction; blanket removal | Staged restriction | Mandatory security requirement | `AWAITING OWNER INPUT` |
| S-07 | Rollback | Action only; paired restore; broad bypass | Paired restore | Mandatory security requirement | `AWAITING OWNER INPUT` |
| I-01 | Additive migrations | Approve; redesign; no work | Approve additive phase | Mandatory for local backend work | `AWAITING OWNER INPUT` |
| I-02 | Restriction release | Stage; immediate; retain | Later gated release | Deferrable until release | `AWAITING OWNER INPUT` |
| I-03 | Local database tests | Local DB; mocks only | Isolated local validation | Mandatory for backend validation | `AWAITING OWNER INPUT` |
| I-04 | Mocked/unit tests | Approve; defer | Approve with backend | Mandatory for local backend work | `AWAITING OWNER INPUT` |
| I-05 | Remote tests | Separate approval; defer | Defer until local success | Deferrable for local work; mandatory before release | `AWAITING OWNER INPUT` |
| I-06 | Inbox/bell UI | Backend only; backend then UI | Separate UI approval | Deferrable for backend; mandatory for complete MVP | `AWAITING OWNER INPUT` |

## 9. Current Decision

**`NO-GO` remains in effect.** No pending decision has been approved, rejected, or deferred by this review. The next permitted action is collection of explicit owner decisions using the matrix above, followed by a fresh readiness assessment. This document does not authorize source changes, migrations, local database work, remote Supabase operations, integration testing, deployment, commits, or pushes.

## Source Boundary

- `docs/frontend/PHASE_4C_2_NOTIFICATION_BACKEND_SPEC.md`
- `docs/frontend/PHASE_4C_3_NOTIFICATION_APPROVAL_CHECKLIST.md`
- `docs/frontend/PHASE_4C_4_NOTIFICATION_APPROVAL_RESOLUTION.md`

No application code, tests, migrations, SQL functions, database schema, RLS policy, environment file, dependency, remote Supabase resource, commit, or push was changed for this decision review.
