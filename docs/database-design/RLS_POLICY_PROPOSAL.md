# CMIRS - RLS Policy Proposal

> **Status: PROPOSAL - Updated Phase 3D (2026-10-18). Not applied to Supabase.**
> Reflects all owner-approved decisions through Phase 3D.
> Do not apply any RLS policies until migration is authorized.

## Table of Contents

- [Purpose and Scope](#purpose-and-scope)
- [RLS Design Principles](#rls-design-principles)
- [Helper Functions](#helper-functions)
- [Phase 3B Changes to Policies](#phase-3b-changes-to-policies)
- [Phase 3C Changes to Policies](#phase-3c-changes-to-policies)
- [Phase 3D Changes to Policies](#phase-3d-changes-to-policies)
- [Permission Matrices](#permission-matrices)
- [Unresolved RLS Questions](#unresolved-rls-questions)
- [Security Notes and Warnings](#security-notes-and-warnings)

---

## Purpose and Scope

This document proposes Row Level Security (RLS) policies for every table in the CMIRS schema.
Policies are described in terms of access rules per operation (SELECT, INSERT, UPDATE, DELETE)
and per role.

These policies implement the role-permission matrix from ROLES.md and the security
requirements from SECURITY.md, updated through Phase 3D owner decisions.

**No RLS policies have been applied. Planning only.**

---

## RLS Design Principles

From SECURITY.md Section PostgreSQL Row Level Security:

1. Enable RLS on all tables. No table should be accessible without a policy.
2. Deny by default. With RLS enabled and no policy, all access is denied.
3. Use auth.uid() to identify the current user in policies.
4. Use a helper function to look up the current user role from profiles.
5. Separate SELECT, INSERT, UPDATE, DELETE policies for granular control.
6. Frontend role checks do not constitute security. RLS is the database-level safety net.

---

## Helper Functions

### get_user_role()

```
-- Pseudocode - not yet implemented
get_user_role() -> user_role
  Returns profiles.role WHERE profiles.id = auth.uid()
```

Must be efficient (called on every row access). Implement as SECURITY DEFINER with
result caching (current_setting pattern) to avoid recursion and performance impact.

### can_view_report(report_id UUID)

```
-- Pseudocode - FINALIZED Phase 3D (APPROVED OD-NEW-4)
can_view_report(report_id UUID) -> boolean
  Returns true if ANY of the following:

  1. auth.uid() = reports.reporter_id
     (the user who submitted this report sees it regardless of role)

  2. EXISTS (
       SELECT 1 FROM assignments
       WHERE assignments.report_id = $1
         AND assignments.technician_id = auth.uid()
         AND assignments.status != 'declined'
     )
     (technician has a qualifying assignment — any status EXCEPT declined)

  3. get_user_role() IN ('coordinator', 'administrator', 'management')
     (coordinator and oversight roles see all reports)
```

Qualifying assignment statuses for condition 2:
  assigned, in_progress, on_hold, completed, reassigned, cancelled
  (all statuses EXCEPT declined — APPROVED OD-NEW-4)

Why declined is excluded: A technician who declined never started any work and has no
work_logs for the report. Granting visibility would expose report information to a user
with no accountability relationship to it.

Historical access (APPROVED OD-NEW-4):
- completed: retained. Technician needs access to own work_logs.
- reassigned: retained. Technician worked on report before being replaced.
- cancelled: retained. Report cancelled while technician had active assignment.
- declined: NOT retained. Technician refused before starting.

Unresolved: no visibility retention period is defined. Access persists as long as the
qualifying assignment row exists. A retention policy would require a separate decision.

---

## Phase 3B Changes to Policies

### reports - UPDATE (status to cancelled)

**Changed by PD-W2 and PD-W3.**
- Reporters: UPDATE own report to cancelled at submitted or under_review only.
- Coordinators: UPDATE any report to cancelled at any non-terminal stage.
- Technicians: UPDATE own assignment's report for on_hold/in_progress transition (PD-W1).

### verifications - INSERT

**Changed by PD-R4.**
Added: verified_by != reports.reporter_id (coordinator cannot verify own submitted report).

### assignments - UPDATE (cancellation)

**Changed by PD-W4.**
Cancelled is terminal. No further UPDATE once status = cancelled.

---

## Phase 3C Changes to Policies

### can_view_report helper (preliminary)

Updated predicate from status != 'cancelled' to status != 'declined' (Phase 3C draft).
Finalized in Phase 3D (see above).

### report_comments - UPDATE and DELETE

**Changed by PD-D3.** DENY for ALL roles. Immutable.

### reports - INSERT

**Changed by PD-R6.** ALLOW for all five authenticated roles.

### assignments - declined status (draft)

**Changed by PD-R2.** Declined is terminal. work_logs blocked for declined assignments.

---

## Phase 3D Changes to Policies

### can_view_report helper (FINALIZED)

**APPROVED OD-NEW-4.**
Predicate confirmed: status != 'declined'. Excludes declined-only assignments.
Historical access for completed, reassigned, cancelled: retained.

### report_attachments - soft deletion (APPROVED OD-NEW-2)

**Major change:** The coordinator deletion operation is now a SECURITY DEFINER RPC
(soft delete), NOT a general UPDATE or hard DELETE.

- Hard DELETE: DENY for ALL roles. Unchanged.
- File metadata UPDATE (file_path, file_name, file_size, mime_type): DENY for all roles.
  Attachments are immutable after upload (PD-D2 preserved).
- Soft deletion UPDATE (setting deleted_at and deleted_by): implemented via a
  SECURITY DEFINER function that validates:
  (a) caller has role = coordinator,
  (b) the attachment is currently active (deleted_at IS NULL),
  (c) sets ONLY deleted_at = now() and deleted_by = auth.uid().
  No general UPDATE permission on report_attachments is granted to coordinator.
- After soft deletion, no role can restore the attachment (UPDATE using clause:
  USING deleted_at IS NULL prevents UPDATE on already-deleted rows).
- SELECT: active-only view for student_personnel and technicians (WHERE deleted_at IS NULL).
  Full view (active + deleted) for coordinator, administrator, management.

### assignments - decline (FINALIZED, APPROVED OD-NEW-3)

Technician UPDATE to decline: status 'assigned' -> 'declined' with decline_reason.
Implemented via constrained UPDATE policy or SECURITY DEFINER RPC.
Constraints:
- technician_id = auth.uid() (own assignment only)
- Current status must be 'assigned' (USING: status = 'assigned')
- New status must be 'declined' with non-null decline_reason (WITH CHECK)
Once declined, no further UPDATE (USING: status = 'assigned' blocks updates on declined rows).

### work_logs - INSERT guard (FINALIZED)

Assignment must have status NOT IN ('cancelled', 'declined') for work_log INSERT.

---

## Permission Matrices

Legend:
- ALLOW: operation is permitted
- DENY: operation is denied
- OWN: allowed on own records only
- ASSIGNED: allowed on records linked to technician's qualifying assignments
- COND: conditions noted below the table

---

### profiles

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN | ALLOW | OWN | ALLOW | ALLOW |
| INSERT | DENY (T4 only) | DENY (T4 only) | DENY (T4 only) | DENY (T4 only) | DENY (T4 only) |
| UPDATE | OWN (limited cols) | OWN (limited cols) | OWN (limited cols) | ALLOW (role + is_active) | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT handled exclusively by T4. No role may INSERT directly.
- UPDATE self-service: full_name, phone only. Not: id, email, role, is_active.
- Administrator: may change role and is_active for other users. Cannot change own role.

---

### role_change_audit

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | DENY | DENY | DENY | ALLOW | ALLOW |
| INSERT | DENY | DENY | DENY | ALLOW | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Append-only.

---

### categories

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | ALLOW (active only) | ALLOW | ALLOW (active only) | ALLOW | ALLOW |
| INSERT | DENY | ALLOW | DENY | ALLOW | DENY |
| UPDATE | DENY | ALLOW | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

---

### locations

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | ALLOW (active only) | ALLOW | ALLOW (active only) | ALLOW | ALLOW |
| INSERT | DENY | ALLOW | DENY | ALLOW | DENY |
| UPDATE | DENY | ALLOW | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

---

### reports

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN | ALLOW | ASSIGNED (PD-R1) | ALLOW | ALLOW |
| INSERT | ALLOW | ALLOW | ALLOW | ALLOW (PD-R6) | ALLOW (PD-R6) |
| UPDATE | OWN (cancel only, PD-W2) | ALLOW | OWN assignment (PD-W1) | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT: all five authenticated roles (APPROVED PD-R6).
- Technician SELECT (ASSIGNED): can_view_report() using non-declined assignment predicate.
- student_personnel UPDATE: own reports at submitted or under_review to cancelled only (PD-W2).
- Technician UPDATE: own report for on_hold/in_progress transition on own active assignment (PD-W1).

---

### report_attachments

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT (active) | OWN REPORTS | ALLOW | ASSIGNED REPORTS | ALLOW | ALLOW |
| SELECT (deleted) | DENY | ALLOW | DENY | ALLOW | ALLOW |
| INSERT | ALLOW (own report) | ALLOW | ALLOW (assigned report) | DENY | DENY |
| Soft-delete (RPC) | DENY | ALLOW (COND) | DENY | DENY | DENY |
| Hard DELETE | DENY | DENY | DENY | DENY | DENY |
| File metadata UPDATE | DENY | DENY | DENY | DENY | DENY |

Notes (APPROVED PD-D2, OD-NEW-2):
- SELECT: student_personnel and technicians see only active attachments (deleted_at IS NULL).
  Coordinator, administrator, management see both active and soft-deleted for audit purposes.
- INSERT: per-report count limit (max 5 active attachments) enforced server-side before INSERT.
  Soft-deleted attachments do not count toward the limit.
- Soft-delete: implemented as a SECURITY DEFINER RPC. Coordinator calls the RPC to
  soft-delete an active attachment. The RPC sets deleted_at and deleted_by.
  Validates: caller role = coordinator, deleted_at IS NULL (not already deleted).
  File metadata (file_path, file_name, file_size, mime_type, uploaded_by, created_at)
  cannot be changed through this RPC or any other operation.
- After soft deletion, the row's deleted_at IS NOT NULL, so the USING clause of any
  UPDATE policy prevents further modification (restoration is impossible via RLS).
- Hard DELETE is DENY for all roles. Rows are retained indefinitely for audit.
- Storage cleanup: asynchronous, application-managed retry job. file_path is preserved
  in the soft-deleted row for retry. See OPEN_DECISIONS.md OD-NEW-2.

---

### report_status_history

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS | ALLOW | ALLOW |
| INSERT | ALLOW (own, COND) | ALLOW | ALLOW (own, COND) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Append-only. Technician INSERT: own assigned transitions (in_progress, completed, on_hold).
Student INSERT: own report cancellation at submitted/under_review.

---

### report_comments

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS | DENY | DENY |
| INSERT | ALLOW (own report) | ALLOW | ALLOW (qualifying assigned) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Immutable (APPROVED PD-D3). UPDATE/DELETE DENY for all roles including admin.
Technician INSERT: allowed on reports with qualifying (non-declined) assignment.

---

### assignments

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | DENY | ALLOW | OWN | ALLOW | ALLOW |
| INSERT | DENY | ALLOW | DENY | DENY | DENY |
| UPDATE | DENY | ALLOW | OWN (constrained) | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Technician UPDATE (constrained):
- Allowed transitions: assigned -> in_progress, in_progress -> completed,
  in_progress -> on_hold (PD-W1), on_hold -> in_progress (PD-W1).
- Decline transition (APPROVED PD-R2, OD-NEW-3): assigned -> declined.
  USING: status = 'assigned' AND technician_id = auth.uid().
  WITH CHECK: status = 'declined' AND decline_reason IS NOT NULL.
  Recommended implementation: SECURITY DEFINER RPC for column-level control.
- No UPDATE once status is cancelled or declined (terminal). USING clause prevents it.
- notes column: technician cannot update notes (coordinator-authored field).

Coordinator UPDATE:
- Covers reassignment, PD-W3 cancellation, PD-W4 bulk cancellation.
- Cannot decline an assignment on behalf of a technician.

---

### work_logs

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | DENY | ALLOW | OWN ASSIGNMENTS | ALLOW | ALLOW |
| INSERT | DENY | DENY | OWN ACTIVE ASSIGNMENTS | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Append-only. Technician INSERT requires:
- technician_id = auth.uid()
- assignment.technician_id = auth.uid()
- assignment.status NOT IN ('cancelled', 'declined') (APPROVED PD-W4, PD-R2, OD-NEW-3)

Technician SELECT: own work_logs only (own assignments). Other technicians' work_logs
on the same report are not visible.

---

### verifications

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS | ALLOW | ALLOW |
| INSERT | DENY | ALLOW (COND) | DENY | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Coordinator INSERT conditions:
1. Report status = completed.
2. verified_by = auth.uid().
3. verified_by != technician_id of the active assignment (D2).
4. verified_by != reports.reporter_id (APPROVED PD-R4).
All four conditions apply simultaneously.

---

### notifications

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN | OWN | OWN | OWN | OWN |
| INSERT | DENY | DENY | DENY | DENY | DENY |
| UPDATE | OWN (is_read) | OWN (is_read) | OWN (is_read) | OWN (is_read) | OWN (is_read) |
| DELETE | DENY | DENY | DENY | DENY | DENY |

INSERT handled by application service role or trigger (PD-D6 RECOMMENDED).

---

## Unresolved RLS Questions

The following questions may require additional decisions before certain features are
fully implemented. They do not block core migration preparation.

| Question | Affected | Nature |
|---|---|---|
| Attachment deletion reason | report_attachments | The soft-delete records who/when but not why. If a justification is required, a new decision is needed. |
| Visibility retention period | can_view_report | No policy approved on when completed/reassigned/cancelled visibility expires. Persists indefinitely until decided. |
| assignment_declined notification | notifications | No formal decision on notification type for technician decline event. |
| Notification INSERT mechanism | notifications | PD-D6 RECOMMENDED application-level; no firm decision. |
| Hard user deletion | profiles | PD-D8 OPEN; soft-deactivation assumed for MVP. |

All decisions that blocked core schema, enum, constraint, and RLS preparation are now
OWNER APPROVED. The questions above affect specific features, not the migration baseline.

Resolved through Phase 3B, 3C, and 3D:
- PD-R4 (self-verification), PD-R5 (reporter cancellation), PD-R3 (work holds): APPROVED.
- PD-W1, W2, W3, W4: APPROVED.
- PD-D2, D3 (immutability): APPROVED.
- PD-R1, R2, R6: APPROVED.
- OD-NEW-2 (soft deletion), OD-NEW-3 (decline reason), OD-NEW-4 (visibility predicate): APPROVED.

---

## Security Notes and Warnings

### Soft Deletion via SECURITY DEFINER RPC

The attachment soft-delete operation must be implemented as a SECURITY DEFINER function,
not as a general UPDATE permission on report_attachments. This ensures:
1. Only the two deletion columns (deleted_at, deleted_by) can be set by this operation.
2. File metadata (file_path, file_name, etc.) remains immutable as required by PD-D2.
3. The function validates caller role and attachment state before proceeding.
4. No ordinary client-side UPDATE can clear deleted_at (restoration is impossible).

### Decline via Constrained UPDATE or SECURITY DEFINER RPC

The assignment decline operation should also be implemented as a SECURITY DEFINER function
or a tightly constrained UPDATE policy that:
1. Only allows the transition from assigned to declined (USING: status = 'assigned').
2. Only allows the technician to decline their own assignment (technician_id = auth.uid()).
3. Requires a non-null decline_reason in the same operation.
4. Prevents any further UPDATE after declining (status = 'assigned' USING clause blocks it).

### can_view_report JOIN Performance

The technician visibility predicate requires a JOIN to assignments. Index on
(report_id, technician_id, status) is essential for query performance.
Implement as SECURITY DEFINER with per-query evaluation (no cross-transaction cache).

### Verifications INSERT JOIN Complexity

Both D2 and PD-R4 conditions require JOINs in the INSERT policy predicate.
Test carefully. Use a SECURITY DEFINER helper function if the JOIN complexity
causes issues with Supabase RLS policy evaluation.

---

*Phase 3D update 2026-10-18. All schema and RLS decisions are now owner-approved.*
*See OPEN_DECISIONS.md for all decisions.*
*See SCHEMA_PROPOSAL.md for table definitions.*
*See DATA_DICTIONARY.md for column-level definitions.*
