# CMIRS - Open Decisions

> **Phase 3C Update (2026-10-18):** Five additional decisions approved — PD-D2, PD-D3, PD-R1, PD-R2, PD-R6.
> Three schema gaps identified: OD-NEW-2, OD-NEW-3, OD-NEW-4.
> All OPEN and RECOMMENDED decisions still require explicit owner approval before implementation.

## How to Use This Document

For each decision:
1. OWNER APPROVED decisions are final and incorporated into all proposal documents.
2. RECOMMENDED decisions have a clear preferred direction but no owner confirmation yet.
3. OPEN decisions have options but no clear preferred direction.
4. Schema gaps (OD-NEW-X) are gaps identified during reconciliation that require owner input.

---

## Consolidated Decision Register

| ID | Source | Status | Summary |
|---|---|---|---|
| OD-NEW-1 | SCHEMA_PROPOSAL | **OWNER APPROVED** | role_change_audit table included |
| OD-NEW-2 | Phase 3C review | OPEN | Attachment deletion audit mechanism (schema gap) |
| OD-NEW-3 | Phase 3C review | OPEN | Assignment decline reason storage (schema gap) |
| OD-NEW-4 | Phase 3C review | OPEN | Technician visibility for declined-only assignments |
| PD-D1 | DATABASE.md | RECOMMENDED | Location table structure |
| PD-D2 | DATABASE.md | **OWNER APPROVED** | Attachments immutable; coordinator-controlled deletion |
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
| PD-R6 | ROLES.md | **OWNER APPROVED** | All authenticated roles may submit reports |
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

Migration-blocking status (Phase 3C):
- No core schema, enum, or constraint decisions remain unresolved for migration preparation.
- PD-D1 (location table structure): RECOMMENDED to proceed with single table; not a blocker.
- OD-NEW-2 (deletion audit), OD-NEW-3 (decline reason), OD-NEW-4 (declined visibility):
  feature-level gaps; they do not prevent core migration preparation.
- Security (PD-S1 to PD-S4) and operational decisions (PD-W5, PD-W6) do not affect schema.
- Recommendation: the project is READY for migration preparation. See PHASE_3C_REVIEW.md.

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

No further approval is required for this table.

---

### PD-D4 - Report Number Format

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Format is RPT-000001. Sequential number is database-generated and unique.
Concurrent report creation must not produce duplicate numbers.

**Implementation notes:**

1. Use a PostgreSQL SEQUENCE as the source of the sequential number.
   Sequences are transaction-safe and concurrency-safe by design: each call to
   nextval() returns a guaranteed-unique value even under concurrent inserts.
   Gaps are acceptable (e.g., if a transaction is rolled back after consuming a
   sequence value, that number is not reused).

2. The sequence is used in trigger T2 (BEFORE INSERT on reports).

3. The UNIQUE constraint on reports.report_number provides the final database-level
   guarantee that no two reports share the same number.

4. The format is: 'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0')
   Examples: RPT-000001, RPT-000042, RPT-001337.

5. report_number is immutable after creation. No UPDATE is permitted on this column.

---

### PD-D5 - Photo Upload Limits

**Source:** DATABASE.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:**
- Maximum 5 attachments per report.
- Maximum 10 MB (10,485,760 bytes) per file.
- Accepted MIME types: image/jpeg, image/png, image/webp.
- Attachments remain optional (D4 preserved). Zero attachments is valid.

**Implementation notes and validation layers:**

Layer 1 - Client-side (UX only): reject before upload. Not a security boundary.
Layer 2 - Server-side (security-critical): verify count, size, and MIME from file content (magic bytes).
Layer 3 - Supabase Storage policy: bucket-level enforcement (defense-in-depth).
Layer 4 - Database constraints: CHECK (file_size > 0 AND file_size <= 10485760) and
          CHECK (mime_type IN ('image/jpeg','image/png','image/webp')) on report_attachments.
Layer 5 - Count limit: enforced server-side before INSERT; not expressible as a single-row CHECK.

---

### PD-R4 - Coordinator Self-Verification Prohibited

**Source:** ROLES.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** A coordinator must not verify a report they personally submitted.

Combined prohibition in verifications INSERT policy:
- verified_by must not equal the technician_id of the active assignment (D2).
- verified_by must not equal reports.reporter_id (PD-R4).
Enforced at both RLS and application levels.

---

### PD-W1 - Who Can Initiate a Work Hold

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Both technicians (own active assignment) and coordinators may initiate a
work hold (in_progress to on_hold). Both may resume (on_hold to in_progress). Reason required.

---

### PD-W2 - Reporter Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Reporters may cancel their own reports only at submitted or under_review.
Reason required. After assignment, only coordinator can cancel (PD-W3).

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Coordinators may cancel reports at any non-terminal stage. Reason required.
Status history preserved. Active assignments marked cancelled (PD-W4).

---

### PD-W4 - Assignment Handling on Cancellation

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** When a report is cancelled, all active assignments are marked cancelled.

Active statuses: assigned, in_progress, on_hold.
Non-active (not modified): completed, reassigned, cancelled.

All writes (report status, status history, assignment updates, notifications) must occur
within a single database transaction. Partial cancellation is not permitted.

Cancelled assignments are terminal: no further status updates or work_log inserts.

---

## Phase 3C Owner-Approved Decisions

### PD-D2 - Attachment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:**
- Attachments cannot be edited or replaced after upload. They are immutable once created.
- Deletion is coordinator-controlled and must be authorized and auditable.
- Upload limits remain: max 5 per report, 10 MB per file, JPEG/PNG/WebP (preserved from PD-D5).
- Zero attachments is valid (D4 preserved).

**Database metadata and Supabase Storage relationship:**
The report_attachments table stores metadata only (file_path, file_name, file_size, mime_type).
The actual file content lives in a private Supabase Storage bucket. Deleting an attachment
requires two distinct operations:
1. Remove the metadata record from report_attachments (database).
2. Delete the file from Supabase Storage using the stored file_path.
These two operations are NOT atomic. A database transaction cannot roll back a completed
Storage deletion, nor can it guarantee a Storage deletion will succeed.

**Safe handling of partial failures:**
Recommended two-phase approach for coordinator-initiated deletion:
1. Remove (or soft-delete) the database record within a database transaction.
   If this fails, abort immediately. No Storage operation is attempted.
2. After the database operation commits, attempt to delete the Storage object.
3. If the Storage deletion fails: the database record is already gone; the file is
   inaccessible from the application. Log the orphaned file_path for later cleanup.
4. A background retry job should periodically clean up Storage objects whose database
   records no longer exist.
5. Never block the user-facing result on a Storage failure. The attachment is inaccessible
   once the database record is removed.
6. Application logs must capture every Storage deletion attempt and its outcome.

**Schema gap — see OD-NEW-2:**
The current report_attachments schema has no columns to record who deleted an attachment
and when. Coordinator-controlled deletion requires an auditable mechanism before it can
be safely implemented. Until OD-NEW-2 is resolved, the coordinator DELETE RLS policy
is noted as approved in principle but cannot be fully specified without the audit fields.
Conservative default: DELETE is DENY for all roles pending OD-NEW-2 resolution.

---

### PD-D3 - Comment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:**
- Comments are immutable after creation.
- No editing or deletion is permitted for any role, including coordinator and administrator.
- Corrections must be submitted as new follow-up comments.
- No moderation exception or retention policy exists for MVP. If one becomes necessary,
  it must be documented as a separate owner-approved decision before implementation.

**Schema impact:**
- The updated_at column is REMOVED from report_comments. It has no purpose if comments
  cannot be edited.
- Trigger T1 (fn_set_updated_at) no longer applies to report_comments. It applies to
  profiles and reports only.
- RLS: UPDATE and DELETE on report_comments are DENY for all roles.

---

### PD-R1 - Technician Visibility Scope

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Technicians may access only reports assigned to them. General access to
other technicians' reports is not granted.

**Scope definition — "assigned to them":**
A technician may access a report if they have at least one assignment record for that
report with status NOT equal to declined. This covers:
- Active assignments (assigned, in_progress, on_hold)
- Completed assignments (status: completed) — needed to review their own work logs
- Reassigned assignments (status: reassigned) — worked on the report before being replaced
- Cancelled assignments (status: cancelled) — assignment cancelled with the report

Assignments with status declined are EXCLUDED from the visibility rule. A technician
who only declined an assignment (and never did any work) does not receive visibility
into that report. See OD-NEW-4 for the formal gap record.

**Access to related records:**
When a technician has report visibility, they also have access to:
- report_attachments for that report
- report_status_history for that report
- report_comments for that report
- verifications for that report (read only)

For work_logs: technicians see only their own work_logs (linked to their own assignments).
They do not see other technicians' work_logs on the same report.

For assignments: technicians see only their own assignment records, not other technicians'
assignment records for the same report.

**Reassignment handling:**
When a technician is reassigned (their assignment.status changes to reassigned), they
retain read-only access to the report. This allows them to review their own prior work
logs and the report context for accountability purposes.

**RLS predicate (pseudocode):**
Technician can view a report if:
  EXISTS (SELECT 1 FROM assignments
          WHERE assignments.report_id = reports.id
          AND assignments.technician_id = auth.uid()
          AND assignments.status != 'declined')

**Schema gap — see OD-NEW-4:**
The declined exclusion is documented as the intended policy. Owner confirmation
that this exclusion is correct would fully close OD-NEW-4.

---

### PD-R2 - Technician Ability to Decline Assignment

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:**
- Technicians may decline an assignment. A reason is required.
- The declined assignment record is preserved (not deleted or overwritten).
- The coordinator is responsible for arranging reassignment after a decline.
- Declined assignments are non-active. They cannot receive work logs or status updates.

**Enum change — APPROVED:**
The assignment_status enum is extended with the value declined.
declined is a non-active, terminal-like status for the assignment record.
Non-active assignment statuses: declined, cancelled, reassigned, completed.
Active assignment statuses: assigned, in_progress, on_hold.

**Guard against further work on declined assignments:**
- work_logs INSERT is blocked: the RLS policy checks assignment.status != 'declined'.
- assignment status UPDATE is blocked once status = declined (no further transitions from declined).
- Declined assignments are excluded from the technician visibility rule (PD-R1).

**Schema gap — OD-NEW-3:**
No existing field in the assignments table stores the technician's decline reason:
- assignments.notes is for coordinator notes to the technician, not technician responses.
- report_status_history records report-level status transitions, not assignment-level events.
- No assignment_status_history table exists.

Until OD-NEW-3 is resolved, the decline reason cannot be reliably stored or audited.
Options (requiring separate owner decision):
1. Add a decline_reason TEXT column to the assignments table.
2. Add an assignment_status_history table for all assignment-level events.
3. Record the reason via application log only (weakest audit trail).

The declined enum value is added to the schema in this phase.
The reason storage mechanism is deferred to OD-NEW-3.

---

### PD-R6 - Administrator and Management as Reporters

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** All five authenticated application roles may submit maintenance reports:
student_personnel, coordinator, technician, administrator, and management.

**Scope — report submission only:**
This decision grants INSERT permission on the reports table to administrator and management.
It does NOT grant:
- Access to all reports (each role retains its existing SELECT scope).
- Assignment authority (coordinator only).
- Verification authority (coordinator only, subject to PD-R4).
- Role management (administrator only).
- Any other operational permissions beyond report submission.

**Interaction with PD-R4:**
A coordinator who submits a report cannot verify that report (PD-R4 preserved).
This applies even when the coordinator is submitting as an operational user.
The reports.reporter_id is set to auth.uid() regardless of the submitting role.

**RLS impact:**
reports INSERT policy changes from ALLOW for student_personnel, coordinator, technician
to ALLOW for ALL authenticated roles (all five roles).

---

## Phase 3C Schema Gaps

### OD-NEW-2 - Attachment Deletion Audit Mechanism

**Source:** Phase 3C review (identified during PD-D2 reconciliation)
**Status: OPEN**
**Context:** PD-D2 approves coordinator-controlled attachment deletion that must be authorized
and auditable. The current report_attachments schema has no columns to record who deleted
an attachment and when.

**Options:**
1. Soft-delete: Add deleted_at TIMESTAMPTZ and deleted_by UUID FK -> profiles(id) to
   report_attachments. Records are hidden from normal queries but retained in the database.
   Storage cleanup proceeds asynchronously. Recommended.
2. Hard-delete with separate audit table: A report_attachment_deletions table records
   the deletion event before the row is removed.
3. Hard-delete only: Application logs capture the deletion. No database audit trail.

**Recommendation:** Option 1 (soft-delete). This preserves the database record, supports
audit queries, and decouples the Storage cleanup from the user-facing operation.

**Blocks:** Coordinator DELETE RLS finalization and Storage cleanup implementation.

**Decision required:** How should attachment deletions be recorded and audited?

---

### OD-NEW-3 - Assignment Decline Reason Storage

**Source:** Phase 3C review (identified during PD-R2 reconciliation)
**Status: OPEN**
**Context:** PD-R2 approves technician assignment decline with a required reason.
The existing schema has no field to store this reason:
- assignments.notes is coordinator notes (not technician response).
- report_status_history records report-level transitions, not assignment events.
- No assignment_status_history table exists.

**Options:**
1. Add decline_reason TEXT (nullable) to the assignments table. Simple. Set when
   status changes to declined. Recommended.
2. Add an assignment_status_history table for all assignment-level status events.
   More complete audit trail but more complex.
3. Record reason in application logs only. No database audit trail. Weakest option.

**Recommendation:** Option 1 (add decline_reason to assignments). This is minimal,
consistent with the table's purpose, and does not require a new table.

**Note:** The declined enum value is already added to assignment_status.
This gap only affects the storage of the reason, not the status itself.

**Blocks:** Complete audit trail for declined assignments.

**Decision required:** How should the assignment decline reason be stored?

---

### OD-NEW-4 - Technician Visibility for Declined-Only Assignments

**Source:** Phase 3C review (identified during PD-R1 reconciliation)
**Status: OPEN**
**Context:** PD-R1 approves a visibility rule where technicians see reports they are
assigned to (any non-declined assignment). The question is whether a technician who
ONLY declined an assignment (and therefore never did any work) should see the report.

**Current implementation decision:** Declined assignments are excluded from the visibility
predicate. A technician with only a declined assignment record does not see the report.

**Rationale:** A declined technician has no work logs, no contributions, and no accountability
requirement for the report. Restricting visibility is the least-privilege choice.

**Decision required:** Confirm or override the exclusion of declined assignments from
technician report visibility.

---

## Decisions Affecting the Database Schema

These must be resolved before migration scripts are written (if not already approved).

### PD-D1 - Location Table Structure

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Keep single locations table. No change from Phase 3A proposal.

Context: The current locations table stores building_name, floor, and room in a
single flat table. This is simple and sufficient for MVP needs.

**Does not block migration.** Proceed with single table unless owner decides to split.

---

### PD-D2 - Attachment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C Owner-Approved Decisions section above.

---

### PD-D3 - Comment Mutability

**Source:** DATABASE.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C Owner-Approved Decisions section above.

---

### PD-D6 - Notification Creation Method

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Application-level notification creation.
**Does not block migration.**

---

### PD-D7 - confirmed_priority Nullable vs Default

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Keep confirmed_priority nullable.
**Does not block migration.**

---

### PD-D8 - Hard User Deletion Policy

**Source:** New
**Status: OPEN**
**Recommendation:** Soft-delete only for MVP. Hard-delete not supported.
**Does not block migration.**

---

### PD-D9 - Timestamps on categories Table

**Source:** New
**Status: RECOMMENDED**
**Recommendation:** Add created_at at minimum.
**Does not block migration.**

---

### PD-D10 - Uniqueness Constraint on locations

**Source:** New
**Status: RECOMMENDED**
**Recommendation:** Add UNIQUE on (building_name, floor, room).
**Does not block migration.**

---

## Decisions Affecting Roles and Permissions

### PD-R1 - Technician Visibility Scope

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C Owner-Approved Decisions section above.

---

### PD-R2 - Technician Ability to Decline Assignment

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C Owner-Approved Decisions section above.

---

### PD-R3 - Technician Ability to Request Work Hold

**Source:** ROLES.md
**Status: RESOLVED BY PD-W1**
Technicians may initiate work holds per the PD-W1 owner decision.

---

### PD-R4 - Coordinator Self-Verification

**Source:** ROLES.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions section above.

---

### PD-R5 - Reporter Cancellation Authority

**Source:** ROLES.md
**Status: RESOLVED BY PD-W2**
Reporters may cancel at submitted or under_review per PD-W2.

---

### PD-R6 - Administrator and Management as Reporters

**Source:** ROLES.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3C Owner-Approved Decisions section above.

---

## Decisions Affecting Security

### PD-S1 - Rate Limiting Strategy

**Source:** SECURITY.md
**Status: OPEN**
**Does not block database migration.**

---

### PD-S2 - Session Timeout Duration

**Source:** SECURITY.md
**Status: OPEN**
**Does not block database migration.**

---

### PD-S3 - Password Policy Requirements

**Source:** SECURITY.md
**Status: OPEN**
**Does not block database migration.**

---

### PD-S4 - CORS Configuration

**Source:** SECURITY.md
**Status: OPEN**
**Does not block database migration.**

---

## Decisions Affecting Workflow

### PD-W1 - Who Can Initiate a Work Hold

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions section above.

---

### PD-W2 - Reporter Cancellation: Which Stages

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions section above.

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions section above.

---

### PD-W4 - Assignment Handling on Cancellation

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions section above.

---

### PD-W5 - Maximum Reopening Count

**Source:** WORKFLOW.md
**Status: OPEN**
**Does not block migration.** No schema change required for the alerting approach.

---

### PD-W6 - under_review Always Required

**Source:** WORKFLOW.md
**Status: RECOMMENDED**
**Recommendation:** Both paths allowed. Direct submitted to assigned permitted.
**Does not block migration.**

---

*Phase 3C update 2026-10-18. Approved decisions incorporated.*
*See PHASE_3C_REVIEW.md for complete Phase 3C change summary.*
*All OPEN and RECOMMENDED decisions still require explicit owner approval.*
