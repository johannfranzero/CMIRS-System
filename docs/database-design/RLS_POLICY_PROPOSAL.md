# CMIRS - RLS Policy Proposal

> **Status: PROPOSAL - Updated Phase 3B (2026-10-18). Not applied to Supabase.**
> Reflects seven owner-approved decisions. Do not apply any RLS policies until migration is authorized.

## Table of Contents

- [Purpose and Scope](#purpose-and-scope)
- [RLS Design Principles](#rls-design-principles)
- [Helper Functions](#helper-functions)
- [Phase 3B Changes to Policies](#phase-3b-changes-to-policies)
- [Permission Matrices](#permission-matrices)
- [Unresolved RLS Decisions](#unresolved-rls-decisions)
- [Security Notes and Warnings](#security-notes-and-warnings)

---

## Purpose and Scope

This document proposes Row Level Security (RLS) policies for every table in the CMIRS schema.
Policies are described in terms of access rules per operation (SELECT, INSERT, UPDATE, DELETE)
and per role.

These policies implement the role-permission matrix from ROLES.md and the security
requirements from SECURITY.md, updated for Phase 3B owner decisions.

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
-- Pseudocode - not yet implemented
can_view_report(report_id UUID) -> boolean
  Returns true if:
    - auth.uid() = reports.reporter_id, OR
    - auth.uid() IN (SELECT technician_id FROM assignments
                     WHERE report_id = $1 AND status != 'cancelled'), OR
    - get_user_role() IN ('coordinator', 'administrator', 'management')
```

---

## Phase 3B Changes to Policies

The following RLS policies changed as a result of Phase 3B owner decisions:

### reports - UPDATE (status to cancelled)

**Changed by PD-W2 and PD-W3.**

Before: cancelled transitions actor was "Pending PD-W2/PD-W3".
After:
- student_personnel: may update status to cancelled ONLY when reporter_id = auth.uid()
  AND current status IN (submitted, under_review). Reason must be provided by application.
- coordinator: may update status to cancelled from any non-terminal status.
  Reason required. This is already covered by the coordinator's general status UPDATE permission.

### reports - UPDATE (status to/from on_hold)

**Changed by PD-W1.**

Before: on_hold actor was "Pending PD-W1".
After:
- Technician: may transition in_progress to on_hold for reports where they have an
  active assignment. Reason required (application-enforced).
- Coordinator: may transition in_progress to on_hold for any report.
- on_hold to in_progress: same actors, no reason required.

### report_status_history - INSERT

**Changed by PD-W1, PD-W2, PD-W3.**

Before: reporter INSERT was not described.
After: student_personnel may INSERT into report_status_history ONLY when
new_status = cancelled AND the parent report.status is submitted or under_review
AND report.reporter_id = auth.uid(). changed_by must equal auth.uid().

### verifications - INSERT constraints

**Changed by PD-R4.**

Before: "PD-R4 open - whether auth.uid() can equal reports.reporter_id is not decided."
After: auth.uid() MUST NOT equal reports.reporter_id for the report being verified.
This constraint is APPROVED and must be enforced at the RLS policy level (not application only).

The combined prohibition in the verifications INSERT policy:
- verified_by = auth.uid() (always required)
- The report must be in completed status
- auth.uid() must NOT equal the technician_id of the active assignment for this report (D2)
- auth.uid() must NOT equal reports.reporter_id for this report (APPROVED PD-R4)

---

## Permission Matrices

Legend:
- ALLOW = access permitted for rows matching the condition
- DENY = no access (default when RLS enabled)
- OWN = only rows where the user is the owner/author/recipient
- ASSIGNED = only rows related to reports assigned to this user
- PD = pending decision - policy cannot be finalized without owner input
- APPROVED = policy finalized per owner decision

---

### profiles

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN row only | OWN row only | OWN row only | ALL rows | OWN row only |
| INSERT | DENY (via T4) | DENY | DENY | DENY | DENY | DENY |
| UPDATE (non-role fields) | DENY | OWN row | OWN row | OWN row | ANY row | OWN row |
| UPDATE (role field) | DENY | DENY | DENY | DENY | ANY row | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT is handled exclusively by trigger T4. No direct INSERT policy needed.
- The role column requires a separate UPDATE policy restricted to administrator.
  Two UPDATE policies required: one for non-role fields (own row), one for role (administrator only).
- DELETE is not permitted. Deactivation uses is_active = false (PD-D8).

---

### role_change_audit

APPROVED (OD-NEW-1): Table is confirmed in schema.

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | DENY | DENY | DENY | ALL rows | DENY |
| INSERT | DENY | DENY | DENY | DENY | ALLOW | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- Append-only. UPDATE and DELETE denied for all roles.
- INSERT for administrator: changed_by must equal auth.uid().
  The INSERT policy predicate must also verify get_user_role() = 'administrator'.

---

### categories

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | ALL active rows | ALL active rows | ALL active rows | ALL rows | ALL rows |
| INSERT | DENY | DENY | DENY | DENY | ALLOW | DENY |
| UPDATE | DENY | DENY | DENY | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY (soft deactivate) | DENY |

---

### locations

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | ALL active rows | ALL active rows | ALL active rows | ALL rows | ALL rows |
| INSERT | DENY | DENY | DENY | DENY | ALLOW | DENY |
| UPDATE | DENY | DENY | DENY | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY (soft deactivate) | DENY |

Notes: PD-D1 may affect table structure.

---

### reports

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN reports | ALL reports | ASSIGNED reports (PD-R1) | ALL reports | ALL reports |
| INSERT | DENY | ALLOW | ALLOW | ALLOW | DENY (PD-R6) | DENY (PD-R6) |
| UPDATE (status: cancel own) | DENY | OWN, submitted or under_review only (APPROVED PD-W2) | ALL non-terminal | DENY | DENY | DENY |
| UPDATE (status: other transitions) | DENY | DENY | ALL non-terminal | Own assigned reports | DENY | DENY |
| UPDATE (priority, hazard flag) | DENY | DENY | ALLOW | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- SELECT for technician is pending PD-R1. Conservative default: own assignments only.
- Coordinator UPDATE covers all status transitions including cancellation (APPROVED PD-W3),
  work holds (APPROVED PD-W1), and all other non-terminal transitions.
- student_personnel UPDATE for cancellation: restricted to own reports at submitted or under_review.
  The status column can only be set to cancelled in this context (APPROVED PD-W2).
- Technician UPDATE for on_hold: allowed for own assigned in_progress reports (APPROVED PD-W1).
- confirmed_priority updatable by coordinator only. No other role can write this column.
- No role can DELETE reports.

---

### report_attachments

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report attachments | ALL | ASSIGNED report attachments (PD-R1) | ALL | ALL |
| INSERT | DENY | Own reports at submission | DENY | Assigned reports | DENY | DENY |
| UPDATE | DENY | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY |
| DELETE | DENY | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY |

Notes:
- INSERT: server-side logic must enforce the 5-file-per-report limit before inserting.
  The RLS policy permits the INSERT; the count check is in the server action.
- UPDATE and DELETE pending PD-D2. Currently DENY for all roles (conservative default).

---

### report_status_history

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report history | ALL | ASSIGNED report history (PD-R1) | ALL | ALL |
| INSERT | DENY | Own report cancellation (APPROVED PD-W2) | ALL transitions | Own assigned transitions | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

INSERT policy details:
- student_personnel INSERT is limited to: new_status = 'cancelled' AND
  the parent report.reporter_id = auth.uid() AND parent report.status IN ('submitted', 'under_review').
- coordinator INSERT is permitted for all transitions.
- technician INSERT is permitted for transitions on their own assigned reports
  (in_progress, on_hold, completed transitions). APPROVED PD-W1 adds on_hold.
- Append-only: UPDATE and DELETE denied for all roles including administrator.

---

### report_comments

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report comments | ALL | ASSIGNED report comments (PD-R1) | ALL | ALL |
| INSERT | DENY | OWN reports | ANY report | ASSIGNED reports | DENY | DENY |
| UPDATE | DENY | OWN comments (PD-D3) | OWN comments (PD-D3) | OWN comments (PD-D3) | DENY | DENY |
| DELETE | DENY | DENY (PD-D3) | DENY (PD-D3) | DENY (PD-D3) | DENY | DENY |

Notes: UPDATE and DELETE pending PD-D3. Currently DENY (conservative default).

---

### assignments

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | DENY | ALL | OWN assignments | ALL | ALL |
| INSERT | DENY | DENY | ALLOW | DENY | DENY | DENY |
| UPDATE (status, timestamps) | DENY | DENY | ALLOW | OWN assignment only | DENY | DENY |
| UPDATE (notes) | DENY | DENY | ALLOW | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- Coordinator UPDATE covers reassignment and cancellation marking (per APPROVED PD-W3).
- Technician UPDATE on status: covers in_progress, completed, and on_hold transitions
  (APPROVED PD-W1 adds on_hold). Limited to own assignment record.
- DELETE not permitted. Records are marked reassigned or cancelled.

---

### work_logs

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | DENY | ALL | OWN work logs | ALL | ALL |
| INSERT | DENY | DENY | DENY | OWN assignments only | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes: Append-only. INSERT for technician requires technician_id = auth.uid() AND
the assignment.technician_id = auth.uid().

---

### verifications

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report verifications | ALL | ASSIGNED report verifications (PD-R1) | ALL | ALL |
| INSERT | DENY | DENY | ALLOW (with constraints below) | DENY | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

INSERT constraints for coordinator (all must be satisfied):
1. verified_by = auth.uid()
2. The report (report_id) must have status = completed
3. auth.uid() must NOT equal the technician_id of any active assignment for this report (D2)
4. auth.uid() must NOT equal reports.reporter_id for this report (APPROVED PD-R4)

Notes:
- Constraints 3 and 4 are both database-level (RLS policy predicate) AND application-level.
- Append-only. UPDATE and DELETE denied for all roles.

---

### notifications

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN | OWN | OWN | OWN | OWN |
| INSERT | DENY | DENY | DENY | DENY | DENY | DENY |
| UPDATE (is_read) | DENY | OWN | OWN | OWN | OWN | OWN |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT is by application server action (PD-D6 RECOMMENDED) using service role context,
  which bypasses RLS. The INSERT policy for user-context is DENY.
- UPDATE restricted to is_read column on own notifications. Column-level enforcement
  at application layer; RLS grants row-level update permission to own rows.

---

## Unresolved RLS Decisions

| Decision ID | Affected Tables | Blocked Policy | Status |
|---|---|---|---|
| PD-R1 | reports, assignments, report_status_history, report_comments, report_attachments, work_logs, verifications | Technician SELECT scope | RECOMMENDED |
| PD-R2 | assignments | declined status value and workflow | OPEN |
| PD-R6 | reports | Administrator and Management INSERT | OPEN |
| PD-D2 | report_attachments | UPDATE and DELETE policies | RECOMMENDED |
| PD-D3 | report_comments | UPDATE and DELETE policies | RECOMMENDED |
| PD-D6 | notifications | INSERT policy (service role vs trigger) | RECOMMENDED |
| PD-W4 | assignments | Assignment UPDATE to cancelled on report cancellation | RECOMMENDED |

Resolved in Phase 3B (no longer blocking):
- PD-R4: Self-verification prohibition finalized. APPROVED.
- PD-R5: Resolved by PD-W2. Reporter cancellation finalized. APPROVED.
- PD-R3: Resolved by PD-W1. Work hold actor finalized. APPROVED.
- PD-W1: Work hold finalized. APPROVED.
- PD-W2: Reporter cancellation finalized. APPROVED.
- PD-W3: Coordinator cancellation finalized. APPROVED.

---

## Security Notes and Warnings

1. RLS deny-by-default: with RLS enabled and no matching policy, SELECT silently returns
   zero rows; mutations raise permission error. Do not disable RLS to fix empty results.

2. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (anon key) is visible in the client bundle.
   Its safety depends entirely on RLS being correct. Misconfigured RLS = security breach.

3. Service role key bypasses RLS entirely. Use only in server-side code. Never in client bundle.

4. auth.uid() returns NULL for unauthenticated requests. All policies using auth.uid()
   implicitly deny unauthenticated access in equality comparisons.

5. Column-level UPDATE restrictions (e.g., role column, notification fields other than is_read)
   are enforced at the application layer. PostgreSQL RLS operates at row level, not column level.

6. Audit tables (report_status_history, verifications, work_logs, role_change_audit) must have
   UPDATE and DELETE denied for ALL roles, including administrator.

7. The PD-R4 self-verification check requires a JOIN to the reports table in the RLS policy.
   This must be expressed as: EXISTS (SELECT 1 FROM reports WHERE id = verifications.report_id
   AND reporter_id != auth.uid()). Care is needed to avoid performance issues on this JOIN.

8. Every RLS policy must be tested individually. Test matrix: all 6 roles x all 4 operations
   x all edge cases (own vs other, active vs cancelled assignment, etc.).

---

*Phase 3B update 2026-10-18. See SCHEMA_PROPOSAL.md for table definitions.*
*See OPEN_DECISIONS.md for all decisions requiring owner input.*
