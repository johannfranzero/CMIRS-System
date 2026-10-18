# CMIRS - RLS Policy Proposal

> **Status: PROPOSAL - Updated Phase 3C (2026-10-18). Not applied to Supabase.**
> Reflects all owner-approved decisions through Phase 3C.
> Do not apply any RLS policies until migration is authorized.

## Table of Contents

- [Purpose and Scope](#purpose-and-scope)
- [RLS Design Principles](#rls-design-principles)
- [Helper Functions](#helper-functions)
- [Phase 3B Changes to Policies](#phase-3b-changes-to-policies)
- [Phase 3C Changes to Policies](#phase-3c-changes-to-policies)
- [Permission Matrices](#permission-matrices)
- [Unresolved RLS Decisions](#unresolved-rls-decisions)
- [Security Notes and Warnings](#security-notes-and-warnings)

---

## Purpose and Scope

This document proposes Row Level Security (RLS) policies for every table in the CMIRS schema.
Policies are described in terms of access rules per operation (SELECT, INSERT, UPDATE, DELETE)
and per role.

These policies implement the role-permission matrix from ROLES.md and the security
requirements from SECURITY.md, updated for Phase 3B and 3C owner decisions.

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

Must be efficient (called on every row access). Implement as SECURITY DEFINER to
avoid recursion in the profiles policy, with result stability (current_setting cache).

### can_view_report(report_id UUID)

```
-- Pseudocode - updated Phase 3C for PD-R1 and PD-R2
can_view_report(report_id UUID) -> boolean
  Returns true if:
    - auth.uid() = reports.reporter_id (submitter can see own report), OR
    - EXISTS (SELECT 1 FROM assignments
              WHERE assignments.report_id = $1
              AND assignments.technician_id = auth.uid()
              AND assignments.status != 'declined')
      (technician sees any report they have a non-declined assignment for,
       including reassigned and cancelled records, APPROVED PD-R1), OR
    - get_user_role() IN ('coordinator', 'administrator', 'management')
      (coordinators and oversight roles see all reports)
```

Phase 3C change: replaced status != 'cancelled' with status != 'declined'.
This is more permissive for cancellation history but correctly excludes declined-only
assignment records. A technician who only declined an assignment does not see the report.
See OD-NEW-4 for the open question on confirmed owner preference.

---

## Phase 3B Changes to Policies

### reports - UPDATE (status to cancelled)

**Changed by PD-W2 and PD-W3.**

Before: cancelled transitions actor was "Pending PD-W2/PD-W3".
After:
- Reporters (student_personnel): may UPDATE own report status to cancelled ONLY at
  submitted or under_review (APPROVED PD-W2).
- Coordinators: may UPDATE any report status to cancelled at any non-terminal stage
  (APPROVED PD-W3), with required reason.
- Technicians: may UPDATE own assignment status to on_hold (active) or in_progress
  (resume from on_hold) for their own in_progress/on_hold assignments (APPROVED PD-W1).

### verifications - INSERT

**Changed by PD-R4.**

Added fourth INSERT guard condition: verified_by must not equal reports.reporter_id.
Combining D2 (not the performing technician) with PD-R4 (not the submitting reporter).

### assignments - UPDATE

**Changed by PD-W4.**

Added: once assignment.status = cancelled, no further UPDATE is permitted.
Cancelled is a terminal status for assignment records.
Added: cancelled assignments block work_logs INSERT.

---

## Phase 3C Changes to Policies

### can_view_report helper

**Changed by PD-R1.**
Technician visibility predicate updated: status != 'declined' (excludes declined-only).
Previously was status != 'cancelled' (Phase 3B draft). Corrected to match PD-R1.

### report_comments - UPDATE and DELETE

**Changed by PD-D3.**
Both UPDATE and DELETE are DENY for ALL roles (comments are immutable after creation).
Previously: UPDATE was "OWN comments (PD-D3 pending)" and DELETE was "DENY (PD-D3 pending)".
Phase 3C: Finalized as DENY all. No role may edit or delete any comment.

### report_attachments - UPDATE and DELETE

**Changed by PD-D2.**
UPDATE: DENY for ALL roles (attachments are immutable after upload).
DELETE: coordinator-controlled deletion is approved in principle (PD-D2).
However, the deletion audit mechanism (OD-NEW-2) is not yet resolved.
Conservative default until OD-NEW-2 is resolved: DELETE is DENY for all roles.
When OD-NEW-2 is resolved, the DELETE policy will be updated to ALLOW for coordinator
with conditions (authorization verified; audit record created; Storage cleanup attempted).

### reports - INSERT

**Changed by PD-R6.**
INSERT is now ALLOW for ALL five authenticated roles.
Previously: DENY for administrator and management.

### assignments - declined status

**Changed by PD-R2.**
Technicians may set their own assignment status to declined.
Declined assignments are non-active: block work_logs INSERT and further status UPDATE.
Declined assignments are excluded from can_view_report technician visibility.

---

## Permission Matrices

Legend:
- ALLOW: operation is permitted for this role
- DENY: operation is denied
- OWN: allowed on own records only
- ASSIGNED: allowed on reports/assignments linked to technician's assignments
- COND: allowed with specific conditions noted below the table

---

### profiles

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN | ALLOW | OWN | ALLOW | ALLOW |
| INSERT | DENY (T4 only) | DENY (T4 only) | DENY (T4 only) | DENY (T4 only) | DENY (T4 only) |
| UPDATE | OWN (limited columns) | OWN (limited columns) | OWN (limited columns) | ALLOW (role + is_active management) | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT is handled exclusively by Trigger T4 on auth.users INSERT.
  No role may INSERT into profiles directly.
- UPDATE: self-service columns = full_name, phone. Not: id, email, role, is_active.
- Administrator UPDATE: may change role and is_active for other users (role management function).
  Cannot change own role (application-enforced).
- Coordinator SELECT: may view all profiles to assign technicians.
- Management SELECT: may view all for oversight reporting.

---

### role_change_audit (APPROVED OD-NEW-1)

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | DENY | DENY | DENY | ALLOW | ALLOW |
| INSERT | DENY | DENY | DENY | ALLOW (on role change) | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Append-only. Only administrator may INSERT (on performing role change).

---

### categories

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | ALLOW (active only) | ALLOW | ALLOW (active only) | ALLOW | ALLOW |
| INSERT | DENY | ALLOW | DENY | ALLOW | DENY |
| UPDATE | DENY | ALLOW | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes: SELECT filtered to is_active = true for student_personnel and technician.
Soft-delete only (is_active = false).

---

### locations

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | ALLOW (active only) | ALLOW | ALLOW (active only) | ALLOW | ALLOW |
| INSERT | DENY | ALLOW | DENY | ALLOW | DENY |
| UPDATE | DENY | ALLOW | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Soft-delete only.

---

### reports

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN | ALLOW | ASSIGNED (PD-R1) | ALLOW | ALLOW |
| INSERT | ALLOW | ALLOW | ALLOW | ALLOW (PD-R6) | ALLOW (PD-R6) |
| UPDATE | OWN (cancel only, PD-W2) | ALLOW | OWN assignment (PD-W1 on_hold) | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT ALLOW for all five authenticated roles (APPROVED PD-R6, 2026-10-18).
- Technician SELECT (ASSIGNED): uses can_view_report() which checks for any non-declined
  assignment record for auth.uid() (APPROVED PD-R1).
- student_personnel UPDATE: own reports at submitted or under_review status to cancelled only
  (APPROVED PD-W2).
- Technician UPDATE: own in_progress/on_hold assignment's related report for on_hold/in_progress
  transition (APPROVED PD-W1). Restricted to status column only.
- Administrator and management: INSERT to submit own reports only. No UPDATE or DELETE.

---

### report_attachments

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS (PD-R1) | ALLOW | ALLOW |
| INSERT | ALLOW (own report) | ALLOW | ALLOW (assigned report) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY (pending OD-NEW-2) | DENY | DENY | DENY |

Notes (APPROVED PD-D2):
- UPDATE: DENY for ALL roles. Attachments are immutable after upload.
- DELETE: coordinator-controlled deletion is APPROVED in principle (PD-D2).
  Cannot be fully implemented until OD-NEW-2 (deletion audit mechanism) is resolved.
  Current default: DENY for all roles until OD-NEW-2 is resolved.
  Once OD-NEW-2 is resolved, coordinator DELETE will be ALLOW with conditions:
  (1) audit record created (deleted_at, deleted_by recorded), (2) Storage deletion attempted,
  (3) failures logged for async cleanup.
- INSERT: per-report count (max 5) and MIME/size validation enforced server-side before INSERT.

---

### report_status_history

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS (PD-R1) | ALLOW | ALLOW |
| INSERT | ALLOW (own report transitions) | ALLOW | ALLOW (own assignment transitions) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Append-only. INSERT policies for specific transitions:
- student_personnel INSERT: own reports, status = cancelled, from submitted or under_review (PD-W2).
- Coordinator INSERT: any report, any valid transition (PD-W3 and others).
- Technician INSERT: own assigned reports, transitions covered: in_progress, completed,
  on_hold (PD-W1), declined (own assignment status change linked to report context).

---

### report_comments

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS (PD-R1) | DENY | DENY |
| INSERT | ALLOW (own report) | ALLOW | ALLOW (assigned, non-declined report) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes (APPROVED PD-D3):
- UPDATE: DENY for ALL roles. Comments are immutable after creation.
- DELETE: DENY for ALL roles. No moderation or retention exception for MVP.
- Corrections must be submitted as follow-up comments.
- Technician INSERT: allowed on reports they have a non-declined assignment for (PD-R1).

---

### assignments

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | DENY | ALLOW | OWN | ALLOW | ALLOW |
| INSERT | DENY | ALLOW | DENY | DENY | DENY |
| UPDATE | DENY | ALLOW | OWN (limited transitions, PD-W1, PD-R2) | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes:
- Coordinator UPDATE: covers reassignment, cancellation marking (PD-W3, PD-W4), and any
  assignment-level status changes.
- Technician UPDATE on own assignment: allowed transitions only —
  assigned -> in_progress, in_progress -> completed,
  in_progress -> on_hold (PD-W1), on_hold -> in_progress (PD-W1),
  assigned -> declined (PD-R2 - requires reason, see OD-NEW-3 for reason storage gap).
- Cancelled assignments (status = cancelled): no further UPDATE from any role.
  Cancelled is terminal (APPROVED PD-W4).
- Declined assignments (status = declined): no further UPDATE from any role.
  Declined is terminal (APPROVED PD-R2).
- Cancellation (APPROVED PD-W4): all active assignments (assigned, in_progress, on_hold)
  are marked cancelled atomically when the parent report is cancelled.
  This UPDATE is performed by the coordinator's UPDATE permission on assignments.
- DELETE not permitted. Records are marked reassigned, cancelled, or declined.

---

### work_logs

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | DENY | ALLOW | OWN ASSIGNMENTS | ALLOW | ALLOW |
| INSERT | DENY | DENY | OWN ACTIVE ASSIGNMENTS (COND) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes: Append-only. INSERT for technician requires:
- technician_id = auth.uid()
- The referenced assignment.technician_id = auth.uid()
- assignment.status NOT IN ('cancelled', 'declined') (APPROVED PD-W4, PD-R2)

Once an assignment is cancelled or declined, the technician cannot insert
additional work_logs against it. The INSERT policy predicate must include a check
that the referenced assignment is not in cancelled or declined status.

Technician SELECT: own work_logs only (linked to own assignments). Technicians do not
see other technicians' work_logs on the same report, even if they have overlapping
assignment history on that report.

---

### verifications

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN REPORTS | ALLOW | ASSIGNED REPORTS (PD-R1) | ALLOW | ALLOW |
| INSERT | DENY | ALLOW (COND) | DENY | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY |

INSERT conditions for coordinator:
1. Report must be in completed status.
2. verified_by = auth.uid() (coordinator inserts their own verification record).
3. verified_by must NOT be the technician_id of the active (completed) assignment (D2).
4. verified_by must NOT equal reports.reporter_id for this report (APPROVED PD-R4).

Note: Conditions 3 and 4 both apply. A coordinator who is ALSO the reporter cannot verify.
A coordinator who performed the work (unlikely, but prevented) cannot verify.
Conditions 3 and 4 require JOINs to assignments and reports in the INSERT policy predicate.

---

### notifications

| Operation | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|
| SELECT | OWN | OWN | OWN | OWN | OWN |
| INSERT | DENY | DENY | DENY | DENY | DENY |
| UPDATE | OWN (is_read only) | OWN (is_read only) | OWN (is_read only) | OWN (is_read only) | OWN (is_read only) |
| DELETE | DENY | DENY | DENY | DENY | DENY |

Notes: INSERT handled by application service role or trigger.
Only is_read column may be updated by the recipient. All other columns are immutable.

---

## Unresolved RLS Decisions

The following open decisions affect RLS policies and must be resolved before final
implementation. They do not block core migration preparation but do block specific features.

| Decision | Affected Tables | Impact | Status |
|---|---|---|---|
| OD-NEW-2 | report_attachments | Coordinator DELETE policy cannot be finalized without audit columns (deleted_at, deleted_by) | OPEN |
| OD-NEW-3 | assignments | Decline reason storage — technician UPDATE to declined cannot be fully audited | OPEN |
| OD-NEW-4 | reports, report_attachments, report_status_history, report_comments, verifications | Confirm that declined-only assignments exclude technician visibility | OPEN |
| PD-D6 | notifications | INSERT policy: service role vs trigger vs function | RECOMMENDED |
| PD-D8 | profiles | Hard DELETE support vs soft-deactivation only | OPEN |

Resolved in Phase 3B and 3C (no longer blocking):
- PD-R4: Self-verification prohibition finalized. APPROVED.
- PD-R5: Resolved by PD-W2. Reporter cancellation finalized. APPROVED.
- PD-R3: Resolved by PD-W1. Work hold actor finalized. APPROVED.
- PD-W1: Work hold finalized. APPROVED.
- PD-W2: Reporter cancellation finalized. APPROVED.
- PD-W3: Coordinator cancellation finalized. APPROVED.
- PD-W4: Assignment cancellation on report cancellation. APPROVED.
  Active assignments (assigned, in_progress, on_hold) are marked cancelled atomically.
  Cancelled assignments block further work_log inserts and status updates via RLS.
- PD-D2: Attachment immutability finalized. UPDATE DENY all. APPROVED.
  DELETE coordinator-controlled (pending OD-NEW-2 for audit mechanism).
- PD-D3: Comment immutability finalized. UPDATE/DELETE DENY all. APPROVED.
- PD-R1: Technician visibility finalized. Non-declined assignment predicate. APPROVED.
- PD-R2: Assignment decline finalized. declined enum value added. APPROVED.
  Further work blocked for declined/cancelled assignments.
- PD-R6: All roles may submit reports. reports INSERT ALLOW for all roles. APPROVED.

---

## Security Notes and Warnings

### can_view_report JOIN Complexity

The technician visibility predicate (can_view_report) requires a JOIN to assignments.
This helper function should be implemented with careful attention to:
1. Index on assignments (report_id, technician_id, status) for query performance.
2. SECURITY DEFINER to prevent privilege escalation from within the function body.
3. Result should not be cached across transactions (use a per-query evaluation).

### Coordinator Deletion of Attachments (Pending OD-NEW-2)

When OD-NEW-2 is resolved and coordinator deletion is implemented:
- The DELETE policy must verify the coordinator's role before allowing deletion.
- The application must create an audit record (coordinator identity, timestamp, file_path)
  BEFORE the Database delete. If the application record creation fails, abort.
- Never delete from Storage inside a database transaction. Storage operations are not
  transactional with the database.
- Log all Storage deletion outcomes (success and failure) to application logs.

### Verifications INSERT Policy and JOIN

The verifications INSERT conditions (3 and 4) both require JOINs in the RLS predicate:
- Condition 3 (D2): JOIN to assignments to get technician_id of the assignment.
- Condition 4 (PD-R4): JOIN to reports to get reporter_id.
Test these predicates carefully for correctness. If using a helper function, mark it
SECURITY DEFINER and ensure it cannot be influenced by the inserting user's row policies.

### Declined Assignments and Visibility

Declined assignments are excluded from can_view_report. If a technician declined an
assignment and was never assigned again, they cannot view that report.
This is the least-privilege interpretation of PD-R1.
Confirm with OD-NEW-4 owner decision.

---

*Phase 3C update 2026-10-18. See OPEN_DECISIONS.md for all decisions.*
*See SCHEMA_PROPOSAL.md for table definitions and constraints.*
*See DATA_DICTIONARY.md for column-level definitions.*
