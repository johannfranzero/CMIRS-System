# CMIRS — Phase 4F: Notifications Completion Report

**Date:** 2026-10-21
**Project root:** `D:\CMIRS-System\my-app`
**Scope:** Phase 7 — genuine persisted in-app notifications

---

## 1. Executive Summary

The notification feature was **designed but not built**. Phase 4C produced a full technical
specification and a set of approval records, but no migration, no database function, no
application integration and no inbox existed. The header showed a decorative red dot that
asserted an unread count that no backend could produce.

Phase 4F implements the **approved** design end to end and nothing beyond it.

| Capability | Status |
| --- | --- |
| Persisted in-app notifications | **Implemented** — created by the lifecycle command RPCs in the same transaction as the source mutation |
| Correct recipient selection | **Implemented and verified** — P-01 (all active coordinators), P-02 (the actor is never a recipient) |
| Recipient-scoped reads | **Implemented** — RLS `notifications_select` (`recipient_id = auth.uid()`) plus a recipient-scoped DAL |
| Read/unread state persistence | **Implemented** — `is_read`, updated through the `notifications_update_recipient` policy |
| Accurate unread count | **Implemented** — derived from the recipient's own unread rows; a failed read renders no badge at all |
| Notification links | **Implemented** — every notification with a report links to `/reports/<id>` |
| Empty / loading / error states | **Implemented** — an empty inbox, a per-item pending state, and a distinct "database read failure, not an empty inbox" state |
| No fake unread dots or fabricated counts | **Fixed** — the decorative dot was removed in Phase 4D.1; the badge now renders the genuine count |
| No generic client-side insert path | **Enforced** — `REVOKE INSERT, DELETE ON public.notifications FROM authenticated`; the only writer is the private helper |

**Verification:** `tsc` 0 errors · `eslint` 0/0 · **189 unit tests, 189 pass, 0 fail** ·
**42/42** remote notification-lifecycle checks (rolled back) · **2/2** migration contract tests.

---

## 2. What Was Missing, and the Evidence

| Finding | Evidence |
| --- | --- |
| The migration never existed | `supabase/migrations/` contained only `20261018000001`…`20261018000006`; the two contract tests failed with `ENOENT` on `20261020000007_notification_lifecycle_rpcs.sql` |
| The feature was never applied remotely | A live read-only probe returned **HTTP 404 / `PGRST205`** for `notification_command_receipts`, and the live function list contained no notification RPCs |
| The UI asserted a count that did not exist | `components/layout/header.tsx` rendered a hard-coded `bg-rose-500` "unread" dot with no data source |
| The approvals existed but were not recorded as decisions | `docs/frontend/PHASE_4C_4_NOTIFICATION_APPROVAL_RESOLUTION.md` still lists 23 items as `PENDING`; the binding choices are the ones recommended in `docs/frontend/PHASE_4C_6_OWNER_DECISION_SUMMARY.md` |

---

## 3. The Migration

`supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql` — additive only.

### 3.1 Schema

| Object | Purpose |
| --- | --- |
| `public.notification_command_receipts` | Per-actor command receipts: `(actor_id, command_name, request_id)` unique, with a payload hash and the stored result |
| `public.notifications.event_key` | Nullable column; existing rows are untouched |
| `idx_notifications_event_recipient_unique` | Partial unique index on `(event_key, recipient_id) WHERE event_key IS NOT NULL` — per-recipient delivery is idempotent |
| `REVOKE INSERT, DELETE ON public.notifications FROM authenticated` | No generic write surface |

### 3.2 Functions

| Function | Role |
| --- | --- |
| `public.notification_deliver(...)` | **Private.** The only writer of `public.notifications`. Not executable by `authenticated`. |
| `public.notification_receipt_acquire(...)` | **Private.** Acquires or replays a command receipt. |
| `public.notification_receipt_complete(...)` | **Private.** Stores the minimal successful result so a replay can return it. |
| `public.submit_report_with_notifications(...)` | **Command.** Creates the report and notifies the coordinator audience. |
| `public.triage_report_with_notifications(...)` | **Command.** Confirms the priority and moves the report to `under_review`. |
| `public.assign_or_reassign_report_with_notifications(...)` | **Command.** Assigns or reassigns a technician. |
| `public.transition_report_status_with_notifications(...)` | **Command.** Applies a work-order status transition. |
| `public.verify_report_with_notifications(...)` | **Command.** Verifies a completed repair, or returns it for rework. |

All five commands are `SECURITY DEFINER` with `SET search_path = public, auth, pg_temp`, derive
the actor from `auth.uid()` only, re-check the role and the report state internally, and are
granted `EXECUTE` to `authenticated` only.

### 3.3 The approved decisions, as implemented

| Decision | Implementation |
| --- | --- |
| **P-01** Coordinator audience | Every active coordinator receives the coordinator-targeted events. |
| **P-02** The actor is never a recipient | `notification_deliver` returns early when `p_recipient_id IS NULL OR p_recipient_id = p_actor_id`. |
| **P-03** `completed` emits two events | `status_changed` (reporter + technician) **and** `verification_required` (active coordinators). |
| **P-04** Triage may not create an assigned state | `triage_report_with_notifications` raises `CMIRS_INVALID_STATE` for any target other than `under_review`. |
| **P-05** Same-technician reassignment | Rejected as a no-op with `CMIRS_INVALID_STATE`; no assignment row and no notification. |
| **P-06** Priority event | **Deferred** — not emitted by this slice. |
| **P-07** Comment event | **Deferred** — not emitted by this slice. |
| **P-08** Decline event | **Deferred** — not emitted by this slice. |
| **P-09** Urgent presentation | `report_submitted` carries a minimal urgent marker in the title and message. |
| **P-10** Read model | `is_read` only; **no** `read_at` column was added. |

### 3.4 Data minimisation

A notification carries only the report number, a status and a link. It never carries the report
description, the location, the reporter's name or any e-mail address. The remote harness
asserts this directly (**N-08**: "no description or email in the payload").

---

## 4. Application Integration

### 4.1 The write path

The five lifecycle commands now execute through the RPCs, so the source mutation and the
notification rows commit in one transaction:

```
actions/reports.ts  →  utils/reports/mutations.ts  →  utils/reports/lifecycle-rpc.ts
                                                    →  supabase.rpc('…_with_notifications', { …, p_request_id })
```

`utils/reports/lifecycle-rpc.ts` provides:

| Helper | Purpose |
| --- | --- |
| `resolveRequestId` | Reuses a client-supplied idempotency token so a retry is a replay, and mints one when it is missing. |
| `describeLifecycleRpcError` | Maps the controlled `CMIRS_*` errors onto accurate, non-revealing notices; unclassified errors fall through to the accurate database classifier. |
| `invokeLifecycleRpc` | A small typed wrapper that never reports a null payload as success. |

The client stamps the token into an uncontrolled hidden input at submit time and clears it when
the action settles, so a double submit or a retry after a dropped response is answered by the
database as a **replay** rather than creating a second record.

### 4.2 The read path

`utils/notifications/runtime.ts` (client-injectable) and `utils/notifications/dal.ts` (server
bound) provide:

| Function | Behaviour |
| --- | --- |
| `getNotificationsFromClient` | Reads the recipient's notifications; the unread count is derived from the **same rows** the inbox renders. A failed read returns an empty list **plus an error** — never a silent empty inbox. |
| `getUnreadNotificationCountFromClient` | An exact `head` count over the unread rows. A failure returns `available: false`. |
| `markNotificationAsRead` | Updates only `is_read`, for the recipient only. |
| `markAllNotificationsAsRead` | Same, for all of the recipient's unread rows. |

### 4.3 The UI

| Surface | Behaviour |
| --- | --- |
| `/notifications` | The inbox: real rows, type labels, timestamps, a "Mark as read" control per row, "Mark all as read", and a per-report link. |
| Inbox error state | "Notifications could not be loaded" with the sanitized reason and the clarification that it is a **database read failure, not an empty inbox**. |
| Inbox empty state | An honest "No notifications yet" with a link to the report queue. |
| Header bell | A link to `/notifications`. The badge shows the genuine unread count (capped at 99+). **When the count could not be read, no badge is rendered at all** — a failure is never presented as "there is nothing new". |
| Navigation | "Notifications" is available to all five roles, because every role has its own recipient-scoped inbox. |

---

## 5. Tests and Actual Results

### 5.1 Migration contract tests (previously failing — now passing)

```
ok 1 - notification lifecycle migration defines five hardened atomic command RPCs
ok 2 - notification migration protects receipts, prevents generic inserts, and preserves direct-write policies
```

### 5.2 Remote lifecycle harness — 42/42 PASS

`scripts/remote-notification-lifecycle-verification.sql` executes the **complete** lifecycle as
the real roles inside a transaction that is always rolled back:

| Group | Checks | Result |
| --- | --- | --- |
| Submission | The report exists, the tracking number came from trigger T2, the report is owned by the submitter, the status is `submitted` with no priority, the coordinator audience was notified, the actor was **not** notified, the payload carries no personal data | 8/8 PASS |
| Idempotency | A replay returns the original result, creates no second report, creates no duplicate notification, and a replay with different arguments is rejected with `CMIRS_REPLAY_MISMATCH` | 4/4 PASS |
| Authorization | A student may not triage, triage may not target `assigned` (P-04), the same-technician dispatch is a no-op (P-05), the technician can then read the report, management can read the report | 6/6 PASS |
| Work lifecycle | The technician can start work, the assignment follows, the technician may not cancel, the technician may not verify, the technician can complete, the report is `completed` (**not** verified), the coordinator audience is asked to verify (P-03), the reporter is notified | 8/8 PASS |
| Verification | A satisfactory verification moves the report to `verified`, a verification row is written, the reporter and technician are notified | 3/3 PASS |
| Isolation | The student sees only their own notifications, the technician sees only their own, the unread count comes from real unread rows | 3/3 PASS |
| Privileges | A forged notification insert by an authenticated user is refused, the receipt table is not readable by authenticated users | 2/2 PASS |
| Delivery totals | Exactly 8 notifications for the harness report, and no event delivered twice to the same recipient | 2/2 PASS |

### 5.3 Local suite

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings |
| `npm run build` | Success |
| `node --test tests/unit/*.test.mjs` | **189 tests · 189 pass · 0 fail** |

New file `tests/unit/phase-4c-notifications.test.mjs` (9 tests) covers the idempotency token,
the error classification, the RPC wrapper, the unread-count derivation, the failed-read error
state, and the head-count read.

---

## 6. Security Findings

| Finding | Resolution |
| --- | --- |
| Supabase's default privileges granted `anon` EXECUTE on every new function, including the notification commands and the private helpers | **Fixed** by migration `20261021000011`; the private helpers are additionally revoked from `authenticated` |
| A generic authenticated insert path into `public.notifications` | **Closed** — `REVOKE INSERT, DELETE … FROM authenticated`; the only writer is the private helper, which authenticated users cannot execute |
| The receipt table exposed the command history | **Closed** — `REVOKE ALL … FROM anon, authenticated` |
| Notification payload leakage | **Prevented** — minimal payload only; asserted by the remote harness |
| RLS bypass through a `SECURITY DEFINER` function | **Prevented** — every command re-derives the actor from `auth.uid()`, re-checks the role, locks and re-validates the report state, and never accepts a client-supplied identity |

---

## 7. Verification Status

**Verified locally:** the RPC contract, the error classification, the idempotency token, the
unread-count derivation, the failed-read state, the build, the type check and the lint.

**Verified against the remote:** the complete lifecycle, the recipient rules, the read state, the
delivery totals, the idempotency, the replay mismatch, the unauthorized attempts, the forged
insert, and the privilege posture — **42/42** and **12/12** checks, all inside a rolled-back
transaction.

**Not verified (needs an authorized authenticated session):** the inbox rendering real rows in a
browser, and a live notification persisting across a session. The database contract that
underpins both is verified.

---

## 8. Remaining Blockers and Deliberate Non-Implementation

| Item | State |
| --- | --- |
| P-06 priority event, P-07 comment event, P-08 decline event | **Deferred by approval** — not emitted. The command set covers the five approved contracts only. |
| The direct authenticated lifecycle policies (`reports_insert`, `assignments_insert`, …) | **Retained** by approved decision S-06 / I-02: the restriction is a separate, gated release that may only follow once every legitimate writer has been converted and verified. The application now uses the command RPCs exclusively; the remaining policies are a defence-in-depth release step, not a functional gap. |
| Notification retention | **Deferred by approval** (P-10) — `is_read` only; no `read_at`, no archival job. |
| A live end-to-end notification in a browser | Needs an authorized session; the database contract is verified. |
