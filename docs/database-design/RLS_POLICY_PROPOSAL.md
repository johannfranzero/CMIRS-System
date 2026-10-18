# CMIRS - RLS Policy Proposal

> **Status: PROPOSAL - Not approved. Not implemented.**
> Phase 3A database planning. Do not apply any RLS policies to Supabase. Wait for owner review.

## Table of Contents

- [Purpose and Scope](#purpose-and-scope)
- [RLS Design Principles](#rls-design-principles)
- [Helper Function](#helper-function)
- [Permission Matrices](#permission-matrices)
  - [profiles](#profiles)
  - [role_change_audit](#role_change_audit)
  - [categories](#categories)
  - [locations](#locations)
  - [reports](#reports)
  - [report_attachments](#report_attachments)
  - [report_status_history](#report_status_history)
  - [report_comments](#report_comments)
  - [assignments](#assignments)
  - [work_logs](#work_logs)
  - [verifications](#verifications)
  - [notifications](#notifications)
- [Unresolved RLS Decisions](#unresolved-rls-decisions)
- [Security Notes and Warnings](#security-notes-and-warnings)

---

## Purpose and Scope

This document proposes Row Level Security (RLS) policies for every table in the CMIRS schema.
Policies are described in terms of access rules per operation (SELECT, INSERT, UPDATE, DELETE)
and per role.

These policies implement the role-permission matrix from ROLES.md and the security
requirements from SECURITY.md. They are not SQL code - they are policy descriptions
to be translated into SQL during the implementation phase.

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

## Helper Function

A PostgreSQL function is required to retrieve the current user role:

```
-- Pseudocode - not yet implemented
get_user_role() -> user_role
  Returns profiles.role WHERE profiles.id = auth.uid()
```

This function will be called by RLS policies to make role-based access decisions.
It must be efficient because it is called on every row access. Consider caching
or using a security-definer function to reduce repeated lookups.

A separate helper is also useful for checking report visibility:

```
-- Pseudocode - not yet implemented
can_view_report(report_id UUID) -> boolean
  Returns true if:
    - auth.uid() = reports.reporter_id, OR
    - auth.uid() in assignments.technician_id for this report (status not cancelled), OR
    - get_user_role() IN (coordinator, administrator, management)
```

---

## Permission Matrices

Legend:
- ALLOW = access permitted for rows matching the condition
- DENY = no access (default when RLS enabled)
- OWN = only rows where the user is the owner/author/recipient
- ASSIGNED = only rows related to reports assigned to this user
- PD = pending decision - policy cannot be finalized without owner input
- APPEND-ONLY = INSERT allowed; UPDATE and DELETE denied

---

### profiles

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN row only | OWN row only | OWN row only | ALL rows | OWN row only |
| INSERT | DENY (via trigger T4) | DENY | DENY | DENY | DENY | DENY |
| UPDATE (non-role fields) | DENY | OWN row | OWN row | OWN row | ANY row | OWN row |
| UPDATE (role field) | DENY | DENY | DENY | DENY | ANY row | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- INSERT is handled exclusively by trigger T4 (auth.users AFTER INSERT). No direct INSERT policy needed.
- The role column requires a separate UPDATE policy: only administrator can update it.
  A single UPDATE policy cannot cleanly separate role from other fields without
  column-level permissions or application-layer enforcement.
  Recommended: use two UPDATE policies - one for non-role fields (own row), one for role (administrator only).
- DELETE is not permitted. Deactivation uses is_active = false.
- Administrator can SELECT all profiles for user management (ROLES.md).
- Management can view only their own profile (not listed as a user management role in ROLES.md).

---

### role_change_audit

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | DENY | DENY | DENY | ALL rows | DENY |
| INSERT | DENY | DENY | DENY | DENY | ALLOW (own changes) | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- This table is append-only. UPDATE and DELETE are denied for all roles.
- INSERT is restricted to administrator. The changed_by field must equal auth.uid().
- Auditors or other roles reading this data is a future consideration. Currently only
  administrator has read access.

---

### categories

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | ALL active rows | ALL active rows | ALL active rows | ALL rows | ALL rows |
| INSERT | DENY | DENY | DENY | DENY | ALLOW | DENY |
| UPDATE | DENY | DENY | DENY | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY (soft deactivate) | DENY |

Notes:
- Unauthenticated users cannot access any data. All access requires authentication.
- Authenticated users with operational roles can read active categories to populate report forms.
- Administrator can read all categories including inactive ones for management.
- DELETE is not permitted. Deactivation uses is_active = false.

---

### locations

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | ALL active rows | ALL active rows | ALL active rows | ALL rows | ALL rows |
| INSERT | DENY | DENY | DENY | DENY | ALLOW | DENY |
| UPDATE | DENY | DENY | DENY | DENY | ALLOW | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY (soft deactivate) | DENY |

Notes: Same pattern as categories. PD-D1 may affect this table structure.

---

### reports

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN reports | ALL reports | ASSIGNED reports (PD-R1) | ALL reports | ALL reports |
| INSERT | DENY | ALLOW | ALLOW | ALLOW | DENY (PD-R6) | DENY (PD-R6) |
| UPDATE (own fields) | DENY | Limited (PD-R5) | ALLOW (status, priority) | Status on assigned reports | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- SELECT for technician is marked PD-R1: can technicians see reports assigned to other technicians?
  Until resolved, propose restricting to own assignments (least privilege).
- INSERT for administrator and management is PD-R6 (currently not permitted in ROLES.md).
- UPDATE is complex. Multiple sub-policies are needed:
  a. Reporter can update title/description before assignment (PD-R5 for cancellation).
  b. Coordinator can update status, confirmed_priority, and is_urgent_hazard.
  c. Technician can update status on assigned reports only.
- No role can DELETE reports (ROLES.md restriction for all roles).
- confirmed_priority may only be set by coordinator. Other roles cannot update this column.

---

### report_attachments

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report attachments | ALL report attachments | ASSIGNED report attachments | ALL | ALL |
| INSERT | DENY | On own reports (at submission) | DENY | On assigned reports | DENY | DENY |
| UPDATE | DENY | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY |
| DELETE | DENY | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY (PD-D2) | DENY |

Notes:
- Access scope mirrors the parent report visibility (same as reports SELECT policy).
- UPDATE and DELETE are pending PD-D2. Until resolved, both are DENY for all roles.
- INSERT by technician on assigned reports is proposed to support progress photos.
  This is not explicitly stated in ROLES.md and may require owner confirmation.

---

### report_status_history

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report history | ALL history | ASSIGNED report history | ALL | ALL |
| INSERT | DENY | DENY (via trigger or app) | ALLOW (status transitions) | ALLOW (status transitions) | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- Append-only. UPDATE and DELETE denied for all roles including administrator.
- INSERT: if status history is written by application logic (recommended approach for T3),
  the INSERT policy should allow the acting role to insert with changed_by = auth.uid().
  If written by trigger, INSERT policy may only need to allow the trigger function.
- SELECT scope mirrors the parent report visibility.

---

### report_comments

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report comments | ALL comments | ASSIGNED report comments | ALL | ALL |
| INSERT | DENY | OWN reports | ANY report | ASSIGNED reports | DENY | DENY |
| UPDATE | DENY | OWN comments (PD-D3) | OWN comments (PD-D3) | OWN comments (PD-D3) | DENY | DENY |
| DELETE | DENY | DENY (PD-D3) | DENY (PD-D3) | DENY (PD-D3) | DENY | DENY |

Notes:
- INSERT permissions match ROLES.md comment permissions exactly.
- UPDATE and DELETE are pending PD-D3. Until resolved, both are DENY.
- Administrator and Management cannot add comments (per ROLES.md matrix).
- SELECT scope mirrors the parent report visibility.

---

### assignments

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | DENY | ALL | OWN assignments | ALL | ALL |
| INSERT | DENY | DENY | ALLOW | DENY | DENY | DENY |
| UPDATE (status) | DENY | DENY | ALLOW (reassignment) | ALLOW (own assignment status) | DENY | DENY |
| UPDATE (notes) | DENY | DENY | ALLOW | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- Only coordinator can INSERT (create assignments).
- Technician UPDATE is limited to own assignment status fields (started_at, completed_at, status).
- Coordinator UPDATE handles reassignment (changing technician_id, notes).
- DELETE is not permitted. Reassigned records are marked reassigned, not deleted.
- Reporter cannot view assignments (not in their role permissions per ROLES.md).
- Management can view assignments for operational oversight.

---

### work_logs

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | DENY | ALL | OWN work logs | ALL | ALL |
| INSERT | DENY | DENY | DENY | OWN assignments only | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- Append-only. UPDATE and DELETE denied for all roles.
- INSERT: technician can only insert work logs for their own assignments
  (technician_id = auth.uid() AND assignment belongs to auth.uid()).
- Reporter cannot view work logs directly (no explicit permission in ROLES.md).
  Work log information may be surfaced indirectly through report status updates.

---

### verifications

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN report verifications | ALL | ASSIGNED report verifications | ALL | ALL |
| INSERT | DENY | DENY | ALLOW (with constraints below) | DENY | DENY | DENY |
| UPDATE | DENY | DENY | DENY | DENY | DENY | DENY |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

INSERT constraints for coordinator:
- verified_by must equal auth.uid().
- The report must be in completed status.
- auth.uid() must NOT be the technician_id of the active assignment for this report (D2).
- PD-R4 open: whether auth.uid() can equal reports.reporter_id is not yet decided.
  Until resolved, this constraint is NOT enforced at the database level.
  Application logic should handle it.

Notes:
- Append-only. UPDATE and DELETE denied for all roles including administrator.
- SELECT scope mirrors parent report visibility.

---

### notifications

| Operation | Unauthenticated | student_personnel | coordinator | technician | administrator | management |
|---|---|---|---|---|---|---|
| SELECT | DENY | OWN notifications | OWN notifications | OWN notifications | OWN notifications | OWN notifications |
| INSERT | DENY | DENY (system only) | DENY (system only) | DENY (system only) | DENY (system only) | DENY (system only) |
| UPDATE (is_read) | DENY | OWN notifications | OWN notifications | OWN notifications | OWN notifications | OWN notifications |
| DELETE | DENY | DENY | DENY | DENY | DENY | DENY |

Notes:
- SELECT is restricted to own notifications for all authenticated roles.
- INSERT is performed by application logic or database triggers (PD-D6), not by end users.
  The INSERT policy must allow the application (service role or trigger) to create records.
  End-user INSERT is denied.
- UPDATE is restricted to the is_read column only, on own notifications.
  A column-level policy or application-level enforcement is required to prevent
  updating other fields (title, message, etc.).
- DELETE is not permitted. Old notifications may be archived by a scheduled job if needed.

---

## Unresolved RLS Decisions

The following pending decisions directly prevent finalization of specific RLS policies.
Do not treat the proposed policies above as final for these cases.

| Decision ID | Affected Tables | Blocked Policy |
|---|---|---|
| PD-R1 | reports, assignments, report_status_history, report_comments, report_attachments, work_logs, verifications | Technician SELECT scope - own assignments only vs all reports |
| PD-R4 | verifications | Coordinator self-verification prohibition - cannot enforce without decision |
| PD-R5 | reports | Reporter cancellation - when is reporter allowed to UPDATE status |
| PD-R6 | reports | Administrator and Management INSERT permission |
| PD-D2 | report_attachments | UPDATE and DELETE policies pending |
| PD-D3 | report_comments | UPDATE and DELETE policies pending |
| PD-D6 | notifications | INSERT policy depends on trigger vs application approach |
| PD-W1 | reports (status), report_status_history | on_hold transition actor |
| PD-W2, PD-W3 | reports (status) | Cancellation authority |
| PD-W4 | assignments | Assignment status on report cancellation |

---

## Security Notes and Warnings

1. RLS enables deny-by-default. Any table with RLS enabled and no matching policy
   will silently return zero rows (for SELECT) or raise a permission error (for mutations).
   This is the intended behavior. Do not disable RLS to "fix" empty results.

2. The anon key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) is visible in the client bundle.
   It is safe only because RLS prevents unauthorized data access. If RLS is misconfigured,
   the anon key becomes a security risk.

3. The service role key bypasses RLS entirely. It must only be used in server-side code
   for operations that genuinely require elevated access (e.g., trigger functions, admin
   bulk operations). Never expose it to the client.

4. auth.uid() returns NULL for unauthenticated requests. All policies that use
   auth.uid() implicitly deny unauthenticated access when used in equality comparisons.

5. Column-level UPDATE restrictions (e.g., preventing a user from updating their own role,
   or preventing modification of notification fields other than is_read) are best enforced
   at the application layer. PostgreSQL RLS operates at the row level, not the column level.
   Column-level security requires careful application design.

6. Audit tables (report_status_history, verifications, work_logs, role_change_audit) must
   have UPDATE and DELETE denied for ALL roles, including administrator. These are the
   integrity backbone of the system.

7. Every RLS policy must be tested individually. Testing should include:
   - Attempting unauthorized access as each role.
   - Verifying cross-user data isolation.
   - Testing edge cases (e.g., a coordinator who is also a reporter trying to verify own report).
   - Attempting direct API calls to bypass application-layer checks.

---

*Phase 3A database planning. See SCHEMA_PROPOSAL.md for table definitions.*
*See OPEN_DECISIONS.md for all unresolved decisions requiring owner input.*
