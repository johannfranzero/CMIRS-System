# Phase 4C.4 — Notification Approval Resolution and Implementation Readiness

**Status:** `NO-GO` for Phase 4C implementation and deployment  
**Assessment date:** 2026-10-20  
**Scope:** Documentation-only approval resolution based on the four Phase 4C planning documents and local source inspection.

## 1. Executive Summary

Phase 4C planning defines an in-app-notification MVP and proposes a security-focused backend architecture, but it does not contain explicit approval for the remaining product, security, or rollout choices. The only evidenced scope decision is the existing project decision `D7`: in-app notifications are in scope, while email, SMS, and push delivery are out of scope.

Implementation is **not ready**. It is blocked by unresolved recipient and event semantics, approval of the lifecycle-RPC and direct-DML restriction approach, idempotency and rollback decisions, and authorization for both local implementation work and separately gated remote RLS/integration verification. The planning documents are recommendations and specifications; they are not implementation approval.

Local source inspection confirms a notifications table and recipient-owned read/update RLS policy definitions exist, while notification lifecycle RPCs, creation integration, notification DAL/actions, inbox route, and functional bell do not. This is source evidence only; it does not verify deployed schema, RLS behavior, or remote Supabase state.

## 2. Decision Register

### Status method

`APPROVED` requires an explicit user instruction or an existing authoritative project decision. A recommendation in a Phase 4C planning document is not approval. `PENDING` means an owner must make the stated choice before the affected work proceeds. No explicit rejection or approved deferral was found.

| ID | Topic | Options presented | Source recommendation | Status | Approval evidence | Implementation impact | Blocks MVP |
|---|---|---|---|---|---|---|---|
| SCP-01 | Delivery scope | In-app only; add external delivery channels | In-app only; email, SMS, and push out of scope | `APPROVED` | Existing authoritative project decision `D7`, recorded by the Phase 4C planning sources | Limits the MVP to in-app storage, inbox, unread state, and report links | No |
| P-01 | Coordinator audience | All active coordinators; on-call/group routing; no coordinator notification | Notify all active coordinators | `PENDING` | No explicit approval found | Determines recipients for submitted, unassigned, and urgent reports | Yes |
| P-02 | Actor notification | Exclude actor; include actor | Exclude actor | `PENDING` | No explicit approval found | Affects recipient filtering for every lifecycle event | Yes |
| P-03 | Completed-report events | Emit status and verification events; emit status only; emit verification only | Emit both, with distinct meanings | `PENDING` | No explicit approval found | Determines event keys, duplicate rules, and recipient experience | Yes |
| P-04 | Triage without assignment | Allow status-only triage; require assignment; add a separate triage action | Do not produce an assigned state without a technician | `PENDING` | No explicit approval found | Governs allowed transition validation and assignment recipients | Yes |
| P-05 | Same-technician reassignment | Reject/no-op; allow a duplicate assignment event | Reject or no-op | `PENDING` | No explicit approval found | Controls idempotency and reassignment notifications | Yes |
| P-06 | Priority events | Notify on priority change; defer priority notifications | Defer from the initial event set | `PENDING` | No explicit approval found | Adds or excludes priority event types and recipients | No, if explicitly deferred |
| P-07 | Comment/additional-information events | Notify for comments/request-info; defer them | Defer until requirements identify the workflow | `PENDING` | No explicit approval found | Requires confirmed comment/request-info ownership and event semantics | No, if explicitly deferred |
| P-08 | Assignment-decline events | Add a decline workflow/event; defer it | Defer until a decline workflow exists | `PENDING` | No explicit approval found | Cannot be implemented without an approved lifecycle operation | No, if explicitly deferred |
| P-09 | Urgent-hazard presentation | Use an urgent marker; introduce a new notification type | Use a marker, not a new type | `PENDING` | No explicit approval found | Affects payload schema and coordinator notification presentation | Yes |
| P-10 | Retention and read timestamp | Retain until report retention; define another period; add `read_at`; use `is_read` only | Use existing retention; keep `is_read` only initially | `PENDING` | No explicit approval found | Affects retention policy and whether a migration is needed | Yes |
| S-01 | Notification creation mechanism | Narrow lifecycle RPCs; triggers; post-mutation application insert | Narrow lifecycle-specific RPCs | `PENDING` | No explicit approval found | Defines atomicity boundary and which application writes remain valid | Yes |
| S-02 | RPC contracts | Implement proposed lifecycle commands; revise or narrow the command set | Five lifecycle-specific RPCs, subject to approved events | `PENDING` | No explicit approval found | Defines parameters, state transitions, returns, and notification creation points | Yes |
| S-03 | Command replay/idempotency | Client request IDs; another durable replay rule; no replay support | Optional request ID with durable event uniqueness | `PENDING` | No explicit approval found | Determines retry-safe behavior and required schema/function changes | Yes |
| S-04 | Notification insert surface | RPC/helper-only inserts; generic authenticated inserts | RPC/helper-only insert path | `PENDING` | No explicit approval found | Prevents arbitrary client notification creation | Yes |
| S-05 | Function hardening | Apply all specified safeguards; select an alternative security model | Fixed `search_path`, `auth.uid()` checks, qualified references, least privilege, revoked `PUBLIC` execution | `PENDING` | No explicit approval found | Required design for every proposed `SECURITY DEFINER` RPC | Yes |
| S-06 | Direct lifecycle DML | Preserve direct writes; restrict only after conversion; tighten immediately | Restrict in a staged migration after all legitimate writers use RPCs | `PENDING` | No explicit approval found | Changes RLS/write paths and creates a migration-release dependency | Yes |
| S-07 | Failure/rollback behavior | Atomic all-or-nothing command; best-effort notification insert | Atomic rollback of report mutation and notification inserts | `PENDING` | No explicit approval found | Defines error semantics and prevents report changes without mandatory notices | Yes |
| I-01 | Additive migration design | Approve proposed additive schema/function changes; revise them | Approve a narrow additive initial migration | `PENDING` | No implementation authorization found | Required before creating database-function, constraint, grant, or policy migrations | Yes |
| I-02 | Direct-DML restriction release | Apply with initial migration; perform after conversion and verification; do not apply | Separate, gated later release | `PENDING` | No implementation authorization found | Can remain later, but must be decided before its release | No for additive work; yes before restriction release |
| I-03 | Local database/function validation | Authorize local validation; choose an approved alternative | Validate functions and policy behavior locally before remote work | `PENDING` | No implementation/test authorization found | Needed to establish local behavior for migrations and RPCs | Yes |
| I-04 | Mocked/unit validation | Authorize local mocked tests; choose an approved alternative | Add focused mocked and unit coverage | `PENDING` | No implementation/test authorization found | Covers recipient selection, action/DAL contracts, incomplete data, and UI states | Yes |
| I-05 | Remote integration/RLS verification | Authorize separately; defer; do not run | Separately gated remote verification after local validation | `PENDING` | No remote-testing authorization found | Required before relying on deployed RPC, RLS, and concurrency behavior | No for local implementation; yes before deployment/release |
| I-06 | Inbox and bell UI work | Include in the first implementation stage; defer after backend; revise scope | Implement after backend contracts and authorization decisions | `PENDING` | No implementation authorization found | Requires approved event contract, notification read model, and UI behavior | No for backend-only work; yes for the complete in-app MVP |

**Recorded decisions:** 24 total — `APPROVED`: 1; `PENDING`: 23; `REJECTED`: 0; `DEFERRED`: 0.

## 3. Security and Architecture Gates

| Gate | Documented design | Implemented feature found locally | Verified behavior | Readiness and next action |
|---|---|---|---|---|
| Narrow lifecycle-specific `SECURITY DEFINER` RPCs | Proposed by the backend review and specification | No notification lifecycle RPC found | Not verified | Obtain `S-01`/`S-02` approval before implementation |
| Fixed `search_path` and explicit `auth.uid()` authorization | Required safeguard in the specification | Existing unrelated database-function conventions exist; proposed RPCs do not | Not verified for proposed functions | Approve `S-05`; enforce and review in each migration |
| Atomic lifecycle mutation plus notification creation | Required for mandatory events | No atomic notification-producing mutation path found | Not verified | Approve `S-01` and `S-07`; validate locally before any remote work |
| Idempotency and duplicate-event prevention | Proposed event-key/unique-constraint approach | No lifecycle event key or notification creation path found | Not verified | Approve `S-03` and event semantics first |
| Minimal RPC return values | Required by the specification | No proposed RPC return contract implemented | Not verified | Include in approved RPC contracts |
| Recipient-only reads and permitted `is_read` updates | Existing table RLS policy design | Local migration defines own-row select and `UPDATE(is_read)` scope | Source-inspected only; remote behavior not verified | Preserve during design; remote RLS test remains separately gated |
| No generic client notification inserts | Required boundary | Local policy source does not show a generic notification `INSERT` policy | Source-inspected only; deployed policy not verified | Preserve the boundary; approve `S-04` and test it in authorized environments |
| Staged restriction of direct lifecycle table writes | Proposed after conversion to RPCs | Existing report lifecycle writes remain available through current paths | Not verified | Approve `S-06`; inventory legitimate writers and stage the restriction with rollback |
| Rollback and failure behavior | All-or-nothing transaction behavior required | No notification mutation transaction exists | Not verified | Approve `S-07`; test mutation and insert failures locally and remotely when authorized |
| Authorization and RLS integration testing | Planned as a separate post-local gate | No authorized remote execution performed | Not verified | Obtain `I-05` authorization only after local acceptance passes |

## 4. MVP Scope and Deferred Decisions

### Preserved MVP scope

- The approved scope is **in-app notifications only**.
- Email, SMS, browser push, and mobile push are out of scope.
- The MVP remains dependent on secure notification creation, recipient-only access, a bounded inbox/read model, and a functional notification indicator; the scope decision does not waive the mandatory security controls.

### Decisions eligible for approved deferral

The following items are eligible to defer **only after an explicit owner decision records that deferral**: priority notifications (`P-06`), comment/additional-information notifications (`P-07`), assignment-decline notifications (`P-08`), a `read_at` timestamp (`P-10`), later direct-DML restriction release (`I-02`), remote verification (`I-05`) for local-only implementation, and UI work (`I-06`) for backend-only work.

Deferring `P-06` through `P-08` keeps those events out of the initial event matrix; it does not permit silent omission from requirements. Deferring `I-02` means direct-write policy tightening cannot be released until every legitimate writer has migrated and rollback is proven. Deferring `I-05` prevents deployment/release claims, not local implementation. Deferring `I-06` prevents claiming the in-app MVP is complete.

## 5. Approval Evidence Requirements

For every pending decision, acceptable evidence must be traceable to one of the following:

- An explicit user instruction that names the decision, selected option, and any boundary or timing condition.
- An existing authoritative project decision record that explicitly selects the option and is part of the project requirements, rather than an AI-generated recommendation.
- A project-owner-approved ADR, issue, or requirements amendment committed or otherwise retained in the authoritative project materials, with a clear reference to the applicable decision ID.

The evidence must identify the decision rather than approving Phase 4C generally. For example, approval of `S-01` must expressly authorize lifecycle-specific RPCs over triggers or post-mutation inserts; approval of `I-05` must expressly authorize remote Supabase/RLS testing and state the allowed environment. Planning reports, this resolution, and test plans do not themselves constitute approval.

At minimum, explicit decisions are required for `P-01` through `P-05`, `P-09`, `P-10`, and `S-01` through `S-07` before MVP backend implementation. `P-06` through `P-08`, `I-02`, `I-05`, and `I-06` require either an explicit implementation choice or an explicit scoped deferral before their affected work begins.

## 6. Implementation Readiness Matrix

| Area | Status | Evidence | Blocker | Required next action |
|---|---|---|---|---|
| Delivery channels | Ready boundary | Project decision `D7` in planning sources | None for in-app-only scope | Preserve in-app-only scope |
| Product event/recipient rules | Blocked | `P-01` to `P-10` are unresolved | Recipient, actor, completion, triage, urgent, and retention choices | Owner resolves or explicitly defers eligible decisions |
| RPC design | Blocked | Phase 4C.1/4C.2 propose commands and safeguards | `S-01`, `S-02`, and `S-05` lack approval | Approve/revise the command architecture and contracts |
| Atomicity and duplicates | Blocked | Documentation requires atomic commands and durable uniqueness | `S-03` and `S-07` lack approval | Select idempotency and rollback semantics |
| Database permissions | Partially designed | Local migrations show notification ownership RLS; direct report writes remain | `S-04` and `S-06` lack approval; deployed state unverified | Approve staged restriction plan; inventory all legitimate writers |
| Notification delivery | Scoped | `D7` excludes external channels | No approved creation mechanism | Implement only after backend approvals |
| Inbox and bell UI | Not ready | Header has a static notification placeholder; no inbox/DAL/action found | Event contract and `I-06` are pending | Approve UI stage after backend contract stabilizes |
| Local implementation/testing | Not authorized | Planning documents propose local validation and mocked tests | `I-01`, `I-03`, and `I-04` are pending | Authorize a bounded local implementation/test phase |
| Remote integration/RLS testing | Not authorized | Planning documents explicitly separate remote verification | `I-05` is pending | Obtain separate remote-operation authorization after local acceptance |
| Deployment safety | Blocked | No deployed RPC or verification evidence | Pending architecture, policy, test, and remote-validation gates | Do not deploy or claim production readiness |

## 7. Exact Next Steps

1. Record explicit owner decisions for the mandatory MVP items: coordinator audience, actor exclusion/inclusion, completed-event semantics, triage behavior, same-technician reassignment, urgent presentation, retention/read state, and all `S-01` through `S-07` architecture/security choices.
2. Record explicit deferrals or selections for priority, comments/request-information, assignment decline, and `read_at`; do not infer deferral from the recommendations.
3. Authorize a bounded **local-only** implementation phase after the preceding decisions are recorded. Its scope should name the permitted migrations, application integrations, unit tests, and local database/function validation; it must not imply remote access or deployment.
4. Implement and validate the approved additive design locally, including migration review, function hardening, mocked/unit tests, and regression coverage. Keep direct lifecycle-DML tightening out of the initial release unless the approved migration sequence requires it.
5. Review the conversion inventory and rollback plan, then obtain a separate approval for the direct-DML restriction release before changing policy/write permissions.
6. Obtain a separate, explicit authorization for remote Supabase migration, RLS/integration, concurrency, and rollback verification only after local acceptance criteria pass. The authorization must identify the environment and permitted operations.
7. Build the inbox and responsive bell only after the backend contract is stable and `I-06` is approved; then run the approved local regression suite.
8. Treat deployment/release as a final, separately authorized step after successful remote verification; local tests and source inspection cannot establish remote RLS correctness.

## 8. Final Go/No-Go Decision

**`NO-GO`**

Phase 4C implementation, migration, policy changes, remote operations, and deployment are not authorized by the available evidence. The in-app-only scope is approved, but the mandatory product recipient/event rules and the security architecture needed to enforce atomic, least-privilege notification creation remain `PENDING`. Local source inspection also cannot verify the deployed database or remote RLS behavior.

The only work authorized by this resolution is additional planning and collection of explicit decisions. It does **not** authorize application changes, database migrations, functions, triggers, policies, remote Supabase access, RLS/integration tests, dependency changes, commits, or deployment.

## Evidence and Limitations

- Planning evidence: `docs/frontend/PHASE_4C_NOTIFICATIONS_READINESS_PLAN.md`, `docs/frontend/PHASE_4C_1_NOTIFICATION_BACKEND_DESIGN_REVIEW.md`, `docs/frontend/PHASE_4C_2_NOTIFICATION_BACKEND_SPEC.md`, and `docs/frontend/PHASE_4C_3_NOTIFICATION_APPROVAL_CHECKLIST.md`.
- Local implementation evidence: `supabase/migrations/20261018000001_core_schema.sql`, `supabase/migrations/20261018000005_table_rls_policies.sql`, and `components/layout/header.tsx`.
- No remote Supabase queries, RPCs, Storage operations, migrations, RLS integration tests, application-code changes, existing-document changes, dependency changes, commits, or pushes were performed for this resolution.
