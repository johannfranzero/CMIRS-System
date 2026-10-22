# CMIRS - Open Decisions

> **Phase 3D Update (2026-10-18):** Three schema gaps resolved — OD-NEW-2, OD-NEW-3, OD-NEW-4.
> All schema, enum, constraint, and RLS decisions are now owner-approved.
> No core migration blockers remain. See PHASE_3D_REVIEW.md.

## How to Use This Document

For each decision:
1. OWNER APPROVED decisions are final and incorporated into all proposal documents.
2. RECOMMENDED decisions have a clear preferred direction but no owner confirmation yet.
3. OPEN decisions have options but no clear preferred direction.
4. All OPEN and RECOMMENDED decisions require explicit owner approval before implementation.

---

## Consolidated Decision Register

| ID | Source | Status | Summary |
|---|---|---|---|
| OD-NEW-1 | SCHEMA_PROPOSAL | **OWNER APPROVED** | role_change_audit table included |
| OD-NEW-2 | Phase 3C review | **OWNER APPROVED** | Soft deletion of attachments: deleted_at and deleted_by columns |
| OD-NEW-3 | Phase 3C review | **OWNER APPROVED** | Assignment decline reason: decline_reason column on assignments |
| OD-NEW-4 | Phase 3C review | **OWNER APPROVED** | Declined-only assignments excluded from technician visibility |
| PD-D1 | DATABASE.md | RECOMMENDED | Location table structure |
| PD-D2 | DATABASE.md | **OWNER APPROVED** | Attachments immutable; coordinator-controlled soft deletion |
| PD-D3 | DATABASE.md | **OWNER APPROVED** | Comments immutable after creation |
| PD-D4 | DATABASE.md | **OWNER APPROVED** | Report number format: RPT-000001 |
| PD-D5 | DATABASE.md | **OWNER APPROVED** | Photo limits: 5 files, 10 MB, JPEG/PNG/WebP |
| PD-D6 | DATABASE.md | RECOMMENDED | Notification creation: application-level |
| PD-D7 | DATABASE.md | RECOMMENDED | confirmed_priority: nullable |
| PD-D8 | New | OPEN | Hard user deletion policy |
| PD-D9 | New | RECOMMENDED | Timestamps on categories |
| PD-D10 | New | RECOMMENDED | Uniqueness constraint on locations |
| PD-R1 | ROLES.md | **OWNER APPROVED** | Technicians access own-assigned reports only |
| PD-R2 | ROLES.md | **OWNER APPROVED** | Technicians may decline assignments with required reason |
| PD-R3 | ROLES.md | RESOLVED BY PD-W1 | Technician ability to request work hold |
| PD-R4 | ROLES.md, SECURITY.md | **OWNER APPROVED** | Coordinator self-verification prohibited |
| PD-R5 | ROLES.md | RESOLVED BY PD-W2 | Reporter cancellation authority |
| PD-R6 | ROLES.md | **OWNER APPROVED, SUPERSEDED 2026-10-21 (Phase 4H)** | All authenticated roles may submit reports — **withdrawn**: only Student / School Personnel and Maintenance Coordinator may file a report |
| PD-S1 | SECURITY.md | OPEN | API rate limiting strategy |
| PD-S2 | SECURITY.md | OPEN | Session timeout duration |
| PD-S3 | SECURITY.md | OPEN | Password policy requirements |
| PD-S4 | SECURITY.md | OPEN | CORS configuration |
| PD-W1 | WORKFLOW.md | **OWNER APPROVED** | Work holds: technician or coordinator, with required reason |
| PD-W2 | WORKFLOW.md | **OWNER APPROVED** | Reporter cancellation at submitted or under_review only |
| PD-W3 | WORKFLOW.md | **OWNER APPROVED** | Coordinator cancellation at any non-terminal stage |
| PD-W4 | WORKFLOW.md | **OWNER APPROVED** | On cancellation, mark all active assignments cancelled |
| PD-W5 | WORKFLOW.md | OPEN | Maximum reopening count |
| PD-W6 | WORKFLOW.md | RECOMMENDED | under_review not always required |
| OD-REC-1 | Phase 3E audit | **OWNER APPROVED** | Strengthen decline_reason constraint to btrim != '' at DB level |
| OD-REC-2 | Phase 3E audit | **OWNER APPROVED** | Administrator and management comment SELECT permitted |
| OD-REC-3 | Phase 3E audit | **OWNER APPROVED** | Supabase Storage bucket and storage.objects RLS design documented |

Migration-blocking status (Phase 3F):
- No core schema, enum, constraint, or RLS decisions remain unresolved.
- All 19 owner decisions (OD-NEW-1 through OD-NEW-4, OD-REC-1 through OD-REC-3, PD-D2 through PD-D5, PD-R1, PD-R2, PD-R4, PD-R6, PD-W1 through PD-W4) are OWNER APPROVED.
- Remaining OPEN/RECOMMENDED decisions do not block migration.
- Migration status: READY FOR MIGRATION PREPARATION. See PHASE_3F_REVIEW.md.

---

## Phase 3B Owner-Approved Decisions

### OD-NEW-1 - Owner Approval for role_change_audit Table

**Source:** SCHEMA_PROPOSAL.md (Phase 3A addition)
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** The role_change_audit table is approved and included in the schema.

The table is an append-only audit log for every role assignment and change, recording
user_id, changed_by, old_role, new_role, optional reason, and created_at.

It satisfies the documented audit requirements in ROLES.md Section Role Change Rules
and SECURITY.md Section Auditability.

---

### PD-D4 - Report Number Format

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Format is RPT-000001. Sequential number is database-generated and unique.
Concurrent report creation must not produce duplicate numbers.

1. Use a PostgreSQL SEQUENCE as the source of the sequential number.
   Sequences are transaction-safe and concurrency-safe by design.
2. The sequence is used in trigger T2 (BEFORE INSERT on reports).
3. UNIQUE constraint on reports.report_number provides the final guarantee.
4. Format: 'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0')
5. report_number is immutable after creation.

---

### PD-D5 - Photo Upload Limits

**Source:** DATABASE.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:**
- Maximum 5 ACTIVE (non-deleted) attachments per report.
- Maximum 10 MB (10,485,760 bytes) per file.
- Accepted MIME types: image/jpeg, image/png, image/webp.
- Attachments remain optional. Zero attachments is valid.

Validation layers: client UX (non-binding), server-side count/size/MIME, Storage policy,
database CHECK constraints. Count limit applies to active (deleted_at IS NULL) attachments.

---

### PD-R4 - Coordinator Self-Verification Prohibited

**Source:** ROLES.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** A coordinator must not verify a report they personally submitted.
Enforced at RLS and application levels. verified_by != reports.reporter_id.

---

### PD-W1 - Who Can Initiate a Work Hold

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Both technicians and coordinators may initiate a work hold.
Both may resume. Reason required.

---

### PD-W2 - Reporter Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Reporters may cancel at submitted or under_review only. Reason required.

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Coordinators may cancel at any non-terminal stage. Reason required.
Status history preserved. Active assignments marked cancelled (PD-W4).

---

### PD-W4 - Assignment Handling on Cancellation

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Active assignments (assigned, in_progress, on_hold) marked cancelled
atomically on report cancellation. Records preserved. Terminal once cancelled.

---

## Phase 3C Owner-Approved Decisions

### PD-D2 - Attachment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Attachments immutable after upload. Coordinator-controlled soft deletion.
See OD-NEW-2 for the approved soft-delete mechanism.
Upload limits from PD-D5 apply to active attachments only.

---

### PD-D3 - Comment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Comments immutable. No editing or deletion for any role.
Corrections must be follow-up comments. updated_at removed from report_comments.

---

### PD-R1 - Technician Visibility Scope

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Technicians see only reports where they have a qualifying assignment
(status NOT IN declined). See OD-NEW-4 for the confirmed predicate.

---

### PD-R2 - Technician Ability to Decline Assignment

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Technicians may decline from assigned status. Reason required.
See OD-NEW-3 for the approved decline_reason column.

---

### PD-R6 - All Roles May Submit Reports

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** All five authenticated roles may INSERT into reports.
Report submission only — no additional operational permissions granted.

---

## Phase 3D Owner-Approved Decisions

### OD-NEW-2 - Attachment Soft Deletion

**Source:** Phase 3C review
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Attachment deletion uses soft deletion — two new nullable columns are added
to report_attachments: deleted_at (TIMESTAMPTZ) and deleted_by (UUID FK -> profiles RESTRICT).

**Soft-delete mechanics:**
- Active attachments: deleted_at IS NULL.
- Soft-deleted attachments: deleted_at IS NOT NULL.
- The database operation is UPDATE (setting deleted_at and deleted_by), NOT hard DELETE.
  Hard DELETE on report_attachments remains DENY for all roles.
- Only an authorized coordinator may initiate a soft deletion.
- Soft deletion targets the specific attachment by its id.

**Immutability of file metadata:**
- After upload, file_path, file_name, file_size, mime_type, uploaded_by, and created_at
  are immutable. The soft-delete UPDATE sets ONLY deleted_at and deleted_by.
- After soft deletion, deleted_at and deleted_by are themselves immutable.
  No role may restore a soft-deleted attachment (clear deleted_at or change deleted_by).
  This is enforced by the RLS UPDATE policy (USING: deleted_at IS NULL — only active
  attachments can be soft-deleted, and the UPDATE cannot unset deleted_at once set).

**Audit guarantees:**
- The soft-deleted row is retained in the database indefinitely.
- It records: which file was deleted (file_path, file_name), from which report (report_id),
  by whom (deleted_by), and when (deleted_at).
- No ordinary RLS permission allows a user to overwrite or restore the deletion metadata.
- Coordinator, administrator, and management roles can SELECT soft-deleted rows for audit.
- student_personnel and technicians see only active attachments (deleted_at IS NULL).

**Open question — deletion reason:**
The approved design records who deleted and when but does not record a reason for deletion.
If a deletion justification is required for audit compliance, a separate decision is needed
before migration. No decision has been made on this question.

**Safe, retryable Storage cleanup process:**
1. Coordinator initiates soft deletion (application calls a SECURITY DEFINER RPC that
   sets deleted_at = now() and deleted_by = auth.uid() WHERE deleted_at IS NULL).
2. If the DB operation succeeds, the attachment is immediately hidden from active queries.
   The file_path remains in the database row.
3. Application then attempts to delete the corresponding Storage object (file_path).
4. If Storage deletion fails: the DB record still carries deleted_at (the attachment is
   inaccessible from the application). The file_path is preserved for retry.
5. A background retry job queries report_attachments WHERE deleted_at IS NOT NULL
   (using application-level worker or queue tracking; no storage_cleanup_completed column
   exists in the database schema) and retries the Storage deletion.
6. A Storage cleanup failure does NOT affect the audit record (deleted_at, deleted_by
   remain set and immutable).
7. Never perform Storage deletion inside a database transaction.

**Implementation approach:**
Implement soft deletion as a SECURITY DEFINER database function (RPC) rather than
exposing a general UPDATE permission on report_attachments to the coordinator role.
The function:
- Verifies the caller is a coordinator (get_user_role() = 'coordinator').
- Verifies the attachment is not already soft-deleted (deleted_at IS NULL).
- Sets deleted_at = now() and deleted_by = auth.uid().
- No other columns are modifiable through this function.

This approach ensures that the file metadata immutability rule (PD-D2) is enforced at the
database level, not only at the application level.

**Upload limit interaction:**
The max 5 per report limit (APPROVED PD-D5) counts only active attachments:
WHERE report_id = $1 AND deleted_at IS NULL. Soft-deleted attachments do not count.

---

### OD-NEW-3 - Assignment Decline Reason

**Source:** Phase 3C review
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** A decline_reason TEXT column is added to the assignments table.
It is required (non-null, non-empty) when an assignment status is set to declined.

**Column definition:**
- Name: decline_reason
- Type: TEXT
- Nullable: Yes (NULL for all non-declined statuses)
- Check constraint: CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))
  (database-level constraint rejecting NULL, empty string, or whitespace; APPROVED OD-REC-1).

**Workflow:**
1. Coordinator creates assignment (status = assigned). decline_reason is NULL.
2. Technician decides to decline. Technician calls the decline operation (application or RPC).
3. The operation sets: status = 'declined', decline_reason = '<provided reason>'.
4. The declined assignment record is preserved with the reason (not deleted or overwritten).
5. Coordinator is notified and creates a new assignment record (a new row, not an update).

**Can an assignment be declined more than once?**
No. declined is a terminal status for the assignment record. Once status = declined,
no further status transitions are permitted. A single decline_reason field is therefore
sufficient to capture the one decline event for each assignment record. If the coordinator
reassigns the same technician, a NEW assignment row is created, with its own decline_reason.

**Authorization:**
- Only the assigned technician (technician_id = auth.uid()) may decline their own assignment.
- The assignment must currently be in assigned status (not in_progress, on_hold, completed,
  or any other status). Decline is only permitted from assigned.
- Coordinator cannot set declined or supply a decline_reason on behalf of a technician.
- Implementation: constrained UPDATE RLS policy for technician, restricted to:
  status = 'assigned' -> status = 'declined' transition with non-null decline_reason.
  In practice, implement as a SECURITY DEFINER RPC for cleaner column-level control.

**Immutability after decline:**
Once status = 'declined', both status and decline_reason are immutable.
The RLS UPDATE policy (USING: status = 'assigned') prevents any further UPDATE once declined.

**Guards against further work:**
- work_logs INSERT blocked for declined assignments (assignment.status NOT IN ('cancelled','declined')).
- assignment status UPDATE blocked once declined (terminal).
- Declined assignments excluded from technician report visibility (OD-NEW-4).

**Audit record:**
The declined assignment row (with status, decline_reason, technician_id, assigned_by,
assigned_at) constitutes the audit record. No separate history table is required for MVP,
since an assignment can only be declined once.

---

### OD-NEW-4 - Technician Visibility for Declined-Only Assignments

**Source:** Phase 3C review
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Declined assignments alone do not grant a technician visibility into the report.
A technician must have at least one qualifying (non-declined) assignment record for the
report in order to access it.

**Qualifying assignment statuses for visibility:**

| Status | Qualifies for visibility | Rationale |
|---|---|---|
| assigned | Yes | Active current assignment |
| in_progress | Yes | Active current assignment |
| on_hold | Yes | Active current assignment |
| completed | Yes | Technician performed work; access needed for own work logs and accountability |
| reassigned | Yes | Technician worked on report before being replaced; access needed for historical records |
| cancelled | Yes | Technician had an active assignment that was cancelled with the report; access needed for context |
| declined | No | Technician refused the assignment before starting any work; no work logs exist; no accountability requirement |

**Predicate (pseudocode):**
```
can_view_report(report_id) -> true IF
  EXISTS (SELECT 1 FROM assignments
          WHERE report_id = $1
          AND technician_id = auth.uid()
          AND status != 'declined')
```

**Historical access scenarios:**

Scenario 1 - Reassignment: Technician A is assigned, does some work, is reassigned.
Assignment A.status = reassigned. Technician A retains report visibility (qualifying status:
reassigned). Technician A can still access their own work_logs and the report context.

Scenario 2 - Cancellation with prior work: Technician is in_progress or on_hold when the
report is cancelled. Assignment.status is set to cancelled (PD-W4). Technician retains
visibility (qualifying status: cancelled). Their work_logs are preserved.

Scenario 3 - Decline: Technician is assigned, immediately declines before starting work.
Assignment.status = declined. Technician has NO visibility into the report.
They have no work_logs. This is the intended behavior.

Scenario 4 - Decline then reassignment to same technician: Technician declines assignment 1.
A new assignment 2 is created (new row). If technician later qualifies via assignment 2
(e.g., they accept and work on it), they gain visibility via that qualifying assignment.
Assignment 1 (declined) does not itself grant visibility.

**Unresolved question — completed assignments and report lifecycle:**
The approved rule preserves visibility for completed assignments. It does not specify
whether this visibility should persist indefinitely or be revoked after some retention
period. No retention policy has been approved. Until such a decision is made, visibility
persists as long as the qualifying assignment record exists (no automatic revocation).

---

## Decisions Affecting the Database Schema

### PD-D1 - Location Table Structure

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Keep single locations table. No change from Phase 3A proposal.
Does not block migration. Proceed with single table unless owner decides to split.

---

### PD-D2 - Attachment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C and Phase 3D sections above.

---

### PD-D3 - Comment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C section above.

---

### PD-D6 - Notification Creation Method

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Application-level notification creation.
Does not block migration.

---

### PD-D7 - confirmed_priority Nullable

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Keep confirmed_priority nullable.
Does not block migration.

---

### PD-D8 - Hard User Deletion Policy

**Source:** New
**Status: OPEN**
Does not block migration. Proceed with soft-deactivation for MVP.

---

### PD-D9 - Timestamps on categories

**Source:** New
**Status: RECOMMENDED**
Does not block migration.

---

### PD-D10 - Uniqueness Constraint on locations

**Source:** New
**Status: RECOMMENDED**
Does not block migration.

---

## Decisions Affecting Roles and Permissions

### PD-R1 - Technician Visibility Scope

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C and OD-NEW-4 sections above.

---

### PD-R2 - Technician Ability to Decline Assignment

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C and OD-NEW-3 sections above.

---

### PD-R3 - Technician Ability to Request Work Hold

**Source:** ROLES.md
**Status: RESOLVED BY PD-W1**

---

### PD-R4 - Coordinator Self-Verification

**Source:** ROLES.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B section above.

---

### PD-R5 - Reporter Cancellation Authority

**Source:** ROLES.md
**Status: RESOLVED BY PD-W2**

---

### PD-R6 - All Roles May Submit Reports

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C section above.

---

## Decisions Affecting Security

### PD-S1 - Rate Limiting Strategy

**Source:** SECURITY.md
**Status: OPEN** — Does not block database migration.

---

### PD-S2 - Session Timeout Duration

**Source:** SECURITY.md
**Status: OPEN** — Does not block database migration.

---

### PD-S3 - Password Policy Requirements

**Source:** SECURITY.md
**Status: OPEN** — Does not block database migration.

---

### PD-S4 - CORS Configuration

**Source:** SECURITY.md
**Status: OPEN** — Does not block database migration.

---

## Decisions Affecting Workflow

### PD-W1 - Who Can Initiate a Work Hold

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)** — See Phase 3B section above.

---

### PD-W2 - Reporter Cancellation: Which Stages

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)** — See Phase 3B section above.

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)** — See Phase 3B section above.

---

### PD-W4 - Assignment Handling on Cancellation

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)** — See Phase 3B section above.

---

### PD-W5 - Maximum Reopening Count

**Source:** WORKFLOW.md
**Status: OPEN** — Does not block migration.

---

### PD-W6 - under_review Always Required

**Source:** WORKFLOW.md
**Status: RECOMMENDED** — Both paths allowed. Does not block migration.

---

## Phase 3F Owner-Approved Decisions

### OD-REC-1 - Strengthen decline_reason Check Constraint

**Source:** Phase 3E audit  
**Status: OWNER APPROVED (2026-10-18)**  
**Decision:** Strengthen the `assignments.decline_reason` constraint so that a declined assignment strictly requires a non-null, non-empty, and non-whitespace reason directly at the database level using `btrim()`.

**Approved Check Constraint:**
```sql
CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))
```
**Impact:** Rejects `NULL`, empty strings (`''`), and whitespace-only strings (`'   '`) at the PostgreSQL layer. Amends and hardens the earlier OD-NEW-3 decision. Schema proposal and data dictionary are updated to match.

---

### OD-REC-2 - Administrator and Management Comment Read Access

**Source:** Phase 3E audit  
**Status: OWNER APPROVED (2026-10-18)**  
**Decision:** School Administrators and School Management may SELECT `report_comments`, subject to the same report-access boundaries and applicable RLS protections as other report child tables.

**Policy Definition:**
- `report_comments` SELECT is updated to `ALLOW` for `administrator` and `management`.
- Matches the oversight visibility already granted to administrator and management on `reports`, `report_attachments`, `report_status_history`, `assignments`, `work_logs`, and `verifications`.
- Evaluated consistently with `can_view_report(report_id)`.

---

### OD-REC-3 - Supabase Storage Bucket and storage.objects RLS Policy Design

**Source:** Phase 3E audit  
**Status: OWNER APPROVED (2026-10-18) (Documentation Only)**  
**Decision:** Approve the proposed Supabase Storage bucket and `storage.objects` RLS policy design for documentation purposes before Phase 4 implementation. (No remote Supabase changes or connection).

**Approved Design Summary:**
- Bucket: `report-attachments` (private bucket; public access disabled).
- Max file size: 10 MB (10485760 bytes).
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`.
- `storage.objects` SELECT: Allowed for coordinator, administrator, management; allowed for reporter (own report) and technician (qualifying assigned report via `can_view_report()`) for active attachments (`deleted_at IS NULL`). Unauthenticated access denied.
- `storage.objects` INSERT: Authenticated users upload to valid report paths with size/type validation and <= 5 active attachments per report.
- `storage.objects` UPDATE: DENY all (files are immutable; PD-D2).
- `storage.objects` DELETE: DENY for all application client roles; allowed only for service_role background cleanup jobs after soft deletion.

---

*Phase 3F update 2026-10-18. All core schema, RLS, and storage design decisions are owner-approved.*
*See PHASE_3F_REVIEW.md for complete Phase 3F review and reconciliation summary.*
*All remaining OPEN and RECOMMENDED decisions (PD-D1, PD-D6 through PD-D10, PD-S1 through PD-S4, PD-W5, PD-W6) do not block core migration preparation.*
