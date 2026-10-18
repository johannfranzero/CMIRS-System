# CMIRS - Open Decisions

> **Phase 3B Update:** Seven decisions were approved by the project owner on 2026-10-18.
> These are recorded below with status OWNER APPROVED.
> All remaining decisions retain their prior status and classification.
> Do not treat any OPEN or RECOMMENDED decision as an approved requirement.

## How to Use This Document

For each decision:
1. Decisions marked OWNER APPROVED are final. They are incorporated into all proposal documents.
2. Decisions marked RECOMMENDED have a clear recommendation but no owner answer yet.
3. Decisions marked OPEN have options but no clear preferred direction.
4. All OPEN and RECOMMENDED decisions require an explicit owner response before the
   relevant part of the migration can be prepared.

---

## Consolidated Decision Register

| ID | Source | Status | Summary |
|---|---|---|---|
| OD-NEW-1 | SCHEMA_PROPOSAL | **OWNER APPROVED** | role_change_audit table included |
| PD-D1 | DATABASE.md | RECOMMENDED | Location table structure |
| PD-D2 | DATABASE.md | RECOMMENDED | Attachment mutability |
| PD-D3 | DATABASE.md | RECOMMENDED | Comment mutability |
| PD-D4 | DATABASE.md | **OWNER APPROVED** | Report number format: RPT-000001 |
| PD-D5 | DATABASE.md | **OWNER APPROVED** | Photo limits: 5 files, 10 MB, JPEG/PNG/WebP |
| PD-D6 | DATABASE.md | RECOMMENDED | Notification creation: application-level |
| PD-D7 | DATABASE.md | RECOMMENDED | confirmed_priority: nullable |
| PD-D8 | New | OPEN | Hard user deletion policy |
| PD-D9 | New | RECOMMENDED | Timestamps on categories |
| PD-D10 | New | RECOMMENDED | Uniqueness constraint on locations |
| PD-R1 | ROLES.md | RECOMMENDED | Technician visibility scope |
| PD-R2 | ROLES.md | OPEN | Technician ability to decline assignment |
| PD-R3 | ROLES.md | RESOLVED BY PD-W1 | Technician ability to request work hold |
| PD-R4 | ROLES.md, SECURITY.md | **OWNER APPROVED** | Coordinator self-verification prohibited |
| PD-R5 | ROLES.md | RESOLVED BY PD-W2 | Reporter cancellation authority |
| PD-R6 | ROLES.md | OPEN | Administrator and Management as reporters |
| PD-S1 | SECURITY.md | OPEN | API rate limiting strategy |
| PD-S2 | SECURITY.md | OPEN | Session timeout duration |
| PD-S3 | SECURITY.md | OPEN | Password policy requirements |
| PD-S4 | SECURITY.md | OPEN | CORS configuration |
| PD-W1 | WORKFLOW.md | **OWNER APPROVED** | Work holds: technician or coordinator, with required reason |
| PD-W2 | WORKFLOW.md | **OWNER APPROVED** | Reporter cancellation at submitted or under_review only |
| PD-W3 | WORKFLOW.md | **OWNER APPROVED** | Coordinator cancellation at any non-terminal stage |
| PD-W4 | WORKFLOW.md | RECOMMENDED | Assignment handling on cancellation |
| PD-W5 | WORKFLOW.md | OPEN | Maximum reopening count |
| PD-W6 | WORKFLOW.md | RECOMMENDED | under_review not always required |

Migration-blocking status:
- Blocking migration: PD-D1, PD-D2, PD-D3, PD-D8, PD-R1, PD-R2, PD-R6, PD-W4
- Can wait until implementation: PD-D6, PD-D7, PD-D9, PD-D10, PD-S1, PD-S2, PD-S3, PD-S4, PD-W5, PD-W6

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

1. Use a PostgreSQL `SEQUENCE` as the source of the sequential number.
   Sequences are transaction-safe and concurrency-safe by design: each call to
   `nextval()` returns a guaranteed-unique value even under concurrent inserts.
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

File validation must occur at multiple layers. The database CHECK constraint alone
cannot validate the actual uploaded file content - it only validates the metadata
stored in the report_attachments table. Full security requires all layers below:

Layer 1 - Client-side (UX only, not security-critical):
  - Reject files exceeding 10 MB before upload.
  - Reject file types other than image/jpeg, image/png, image/webp by MIME type sniffing.
  - Prevent selecting more than 5 files for a single report.
  These are for user experience and to reduce unnecessary uploads, not for security.

Layer 2 - Server-side (before Supabase Storage upload, security-critical):
  - Verify the count of existing attachments for the report is below 5.
  - Verify the file size is at or below 10,485,760 bytes using the actual byte count.
  - Determine MIME type from file content (magic bytes), not from the filename extension
    or the browser-supplied Content-Type header.
  - Reject if MIME type is not image/jpeg, image/png, or image/webp.
  - Only upload to Supabase Storage after all server-side checks pass.

Layer 3 - Supabase Storage policy:
  - Configure allowed MIME types and maximum file size in the storage bucket policy
    to provide defense-in-depth. This blocks direct API calls that bypass the application.

Layer 4 - Database constraint (defense-in-depth):
  - CHECK constraint on mime_type column: mime_type IN ('image/jpeg', 'image/png', 'image/webp').
  - CHECK constraint on file_size: file_size > 0 AND file_size <= 10485760.
  - These constraints prevent invalid records from being inserted even if the
    application layer is bypassed.

Layer 5 - Database count enforcement:
  - The per-report count limit of 5 cannot be enforced by a simple CHECK constraint
    on a single row. It is enforced in the server-side action before inserting the
    attachment record. A trigger could also enforce this but adds complexity.

The database constraints in Layer 4 are added to SCHEMA_PROPOSAL.md and DATA_DICTIONARY.md
as a result of this decision. See chk_file_size added to report_attachments.

---

### PD-R4 - Coordinator Self-Verification Prohibited

**Source:** ROLES.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** A coordinator must not verify a report they personally submitted.
This is in addition to the existing D2 restriction that prevents the performing
technician from verifying their own work.

**Implementation notes:**

The self-verification prohibition must check the authenticated coordinator (auth.uid())
against the report's original submitter (reports.reporter_id), not only against the
technician who performed the work.

Enforcement layers:

Layer 1 - RLS policy on verifications INSERT (database-level):
  - In addition to the existing D2 check (auth.uid() != active technician),
    add a check: auth.uid() != reports.reporter_id for the report being verified.
  - This must be part of the INSERT policy predicate, joining reports to check reporter_id.
  - This is the primary security enforcement layer.

Layer 2 - Application logic:
  - Server action checks auth.uid() against reports.reporter_id before attempting insert.
  - Provides a clear error message to the user.
  - Application check runs before the database, improving UX.

The combined prohibition is: verified_by must not equal either:
  (a) the technician_id of the active assignment for this report (D2), OR
  (b) the reporter_id of the report (PD-R4 owner decision).

SCHEMA_PROPOSAL.md verifications key notes and DATA_DICTIONARY.md verified_by
description are updated to reflect this.

---

### PD-W1 - Who Can Initiate a Work Hold

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Both technicians and coordinators may initiate a work hold, subject to
authorization and required reason/audit rules.

**Implementation notes:**

A work hold moves a report from in_progress to on_hold.

Authorized actors:
- Technician with an active (in_progress) assignment for the report.
- Coordinator.

Requirements for both actors:
- A non-empty reason must be provided.
- The reason is stored in report_status_history.reason for the transition record.
- The transition is recorded in report_status_history as any other status change.

Resuming from on_hold (on_hold to in_progress):
- The same authorized actors (technician with active assignment, or coordinator)
  may resume work. A reason is not required for resumption, but may be provided.

Unauthorized actors:
- student_personnel cannot initiate or resume a work hold.
- administrator and management cannot initiate or resume a work hold.

RLS impact: The reports UPDATE policy for status transitions must allow:
- Technician UPDATE on reports where they have an active assignment (status = in_progress).
- Coordinator UPDATE on any report (status = in_progress to on_hold).

PD-R3 is resolved by this decision. It is marked RESOLVED BY PD-W1 in the register.

---

### PD-W2 - Reporter Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Reporters may cancel their own reports only while the report status is
submitted or under_review.

**Implementation notes:**

Authorized cancellation actor and conditions:
- The reporter (reports.reporter_id = auth.uid()) may cancel only when status is
  submitted or under_review.
- A reason is required (stored in report_status_history.reason).

Prevented scenarios:
- A reporter cannot cancel a report that has been assigned, is in_progress, on_hold,
  completed, or reopened. Those stages require coordinator cancellation (PD-W3).
- A reporter cannot cancel a report they did not submit.

RLS impact: The reports UPDATE policy for student_personnel must be limited to:
- Status transitions from submitted or under_review to cancelled only.
- Only for rows where reporter_id = auth.uid().
- Only if reason is provided (application-enforced; cannot be checked by RLS directly).

report_status_history INSERT: the reporter must be able to insert the cancellation
history record (changed_by = auth.uid(), new_status = cancelled).

PD-R5 is resolved by this decision. It is marked RESOLVED BY PD-W2 in the register.

Status transition map update:
- submitted to cancelled: Actors are now Reporter and Coordinator. Reason required.
- under_review to cancelled: Actors are now Reporter and Coordinator. Reason required.

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
**Decision:** Coordinators may cancel reports at any non-terminal stage, with a required
reason and preserved status history.

**Implementation notes:**

Non-terminal stages from which coordinator can cancel:
- submitted, under_review, assigned, in_progress, on_hold, completed, reopened.

Requirements:
- A non-empty reason must be provided for all coordinator cancellations.
- The reason is stored in report_status_history.reason.
- Every cancellation produces a report_status_history record
  (previous_status -> cancelled).

If a report is cancelled while assigned or in_progress:
- The active assignment record must be updated: assignments.status = cancelled.
- The technician must receive a report_cancelled notification.
- See PD-W4 for the full assignment-handling policy (still open, but the assignment
  must be marked cancelled per this decision's notification requirement).

RLS impact: The existing coordinator UPDATE policy on reports (status changes) already
covers this. The RLS policy must allow the coordinator to transition to cancelled from
any non-terminal status.

Status transition map: All coordinator-to-cancelled transitions are now finalized:
- submitted, under_review, assigned, in_progress, on_hold, completed, reopened
  to cancelled: Actor is Coordinator. Reason required.

---

## Decisions Affecting the Database Schema

### PD-D1 - Location Table Structure

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Keep single locations table. No change from Phase 3A proposal.

Context: The current locations table stores building_name, floor, and room in a
single flat table. This is simple and sufficient for MVP needs.

**Migration impact:** If this decision is delayed, migration proceeds with the single
locations table. This can be refactored later if hierarchical queries are needed.

**Does not block migration.** Proceed with single table unless owner decides to split.

---

### PD-D2 - Attachment Mutability

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Treat attachments as immutable after upload.

Context: Once a photo attachment is uploaded, should it be editable or deleteable?

Options:
1. Immutable: No edits or deletes after upload. Strongest audit integrity. Recommended.
2. Soft-delete: Mark deleted in database but retain in storage.
3. Hard-delete: Remove both database record and storage file.

Recommendation: Immutable for MVP. If removal is absolutely needed later, only
administrator should be able to soft-delete with a log entry.

**Blocks RLS migration:** UPDATE and DELETE policies on report_attachments cannot be
finalized without this decision. Currently both are DENY for all roles (conservative default).

**Decision required:** Can attachments be deleted or edited after upload? If yes, who can?

---

### PD-D3 - Comment Mutability

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Allow edits by the original author. Prohibit hard deletes.

Context: Once posted, can comments be edited or deleted?

Options:
1. Edits allowed by author, deletes not allowed. updated_at column is useful. Recommended.
2. Neither edits nor deletes (append-only comments). Remove updated_at.
3. Both edits and deletes allowed.

**Blocks RLS migration:** UPDATE and DELETE policies on report_comments cannot be
finalized. Currently both are DENY (conservative default). If edits are disallowed,
updated_at should be removed from the schema.

**Decision required:** Can comments be edited after creation? Can they be deleted?

---

### PD-D6 - Notification Creation Method

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Application-level notification creation.

Options:
1. Application-level server actions (recommended).
2. Database triggers.
3. Hybrid.

**Does not block migration.** The notifications table schema is the same either way.
Affects only how the INSERT RLS policy is configured (service role vs. user-context insert).

**Decision required:** Should notifications be created by database triggers or application code?

---

### PD-D7 - confirmed_priority Nullable vs Default

**Source:** DATABASE.md
**Status: RECOMMENDED**
**Recommendation:** Keep confirmed_priority nullable. NULL clearly signals unreviewed status.

**Does not block migration.** Proceed with nullable column. This can be changed later.

---

### PD-D8 - Hard User Deletion Policy

**Source:** New
**Status: OPEN**
**Context:** RESTRICT foreign keys prevent deletion of profiles referenced by historical
records. Hard deletion requires anonymizing PII in all referenced records first.

Options:
1. Soft-delete only (is_active = false). Recommended.
2. Hard-delete with PII anonymization.
3. Hard-delete not supported.

**Does not block migration for MVP.** Proceed with RESTRICT + soft-deactivation.

---

### PD-D9 - Timestamps on categories Table

**Source:** New
**Status: RECOMMENDED**
**Recommendation:** Add created_at at minimum.

**Does not block migration.** Can be added or omitted. Will proceed without timestamps
unless owner confirms.

---

### PD-D10 - Uniqueness Constraint on locations

**Source:** New
**Status: RECOMMENDED**
**Recommendation:** Add UNIQUE constraint on (building_name, floor, room).
Note: PostgreSQL treats NULLs in unique indexes as distinct, so multiple outdoor
locations with NULL floor and room would each be permitted.

**Does not block migration.** Can proceed either way. Will proceed without the constraint
unless owner confirms, to avoid a potentially unexpected uniqueness error.

---

## Decisions Affecting Roles and Permissions

### PD-R1 - Technician Visibility Scope

**Source:** ROLES.md
**Status: RECOMMENDED**
**Recommendation:** Restrict technicians to their own assigned reports only.

**Blocks RLS migration:** The SELECT policy for technician on reports, assignments,
report_status_history, report_comments, report_attachments, work_logs, and verifications
cannot be finalized without this decision. The proposed conservative default is
own-assignment-only. If the owner prefers all-reports visibility, the policies change.

**Decision required:** Can technicians view reports assigned to other technicians?

---

### PD-R2 - Technician Ability to Decline Assignment

**Source:** ROLES.md
**Status: OPEN**
**Context:** If technicians can decline, the assignment_status enum needs a declined value
and the workflow needs a decline/reassignment path.

Options:
1. Allow decline with required reason. Triggers coordinator reassignment.
2. No decline. Coordinator handles issues.

**Blocks enum definition and workflow:** If declined is added to assignment_status, it
changes the migration. If not, the enum is final.

**Decision required:** Can technicians decline an assignment?

---

### PD-R3 - Technician Ability to Request Work Hold

**Source:** ROLES.md
**Status: RESOLVED BY PD-W1**
Technicians may initiate work holds per the PD-W1 owner decision. No further input needed.

---

### PD-R4 - Coordinator Self-Verification

**Source:** ROLES.md, SECURITY.md
**Status: OWNER APPROVED (2026-10-18)**
See the Phase 3B Owner-Approved Decisions section above.

---

### PD-R5 - Reporter Cancellation Authority

**Source:** ROLES.md
**Status: RESOLVED BY PD-W2**
Reporters may cancel at submitted or under_review per the PD-W2 owner decision.
No further input needed.

---

### PD-R6 - Administrator and Management as Reporters

**Source:** ROLES.md
**Status: OPEN**
**Context:** ROLES.md marks report submission as not permitted for administrator and
management. Should these roles be able to submit reports?

Options:
1. Keep as not permitted (current design).
2. Allow these roles to also submit reports.

**Blocks INSERT RLS policy on reports** for administrator and management.
Currently DENY. Conservative default will be maintained until owner decides.

**Decision required:** Should administrator and management roles be able to submit reports?

---

## Decisions Affecting Security

### PD-S1 - Rate Limiting Strategy

**Source:** SECURITY.md
**Status: OPEN**
Options: Supabase auth-level, Next.js middleware, or both.
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
See Phase 3B Owner-Approved Decisions above.

---

### PD-W2 - Reporter Cancellation: Which Stages

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions above.

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Status: OWNER APPROVED (2026-10-18)**
See Phase 3B Owner-Approved Decisions above.

---

### PD-W4 - Assignment Handling on Cancellation

**Source:** WORKFLOW.md
**Status: RECOMMENDED**
**Recommendation:** Mark the active assignment as cancelled (assignments.status = cancelled).
Notify the assigned technician.

Context: If a report is cancelled while assigned or in_progress, what happens to the
existing assignment record?

Options:
1. Mark assignment as cancelled (recommended). Technician is notified.
2. Leave unchanged (inconsistent state risk).

Note: PD-W3 already requires that the technician receive a report_cancelled notification
when a coordinator cancels an in-progress or assigned report. The assignment.status
update to cancelled is the matching data operation.

**Blocks application workflow logic** but does not change the database schema, since
cancelled is already a valid assignment_status enum value.

**Decision required:** Should the assignment be explicitly marked cancelled when its
report is cancelled?

---

### PD-W5 - Maximum Reopening Count

**Source:** WORKFLOW.md
**Status: OPEN**
**Context:** Without a limit, a report can cycle through reopened and in_progress indefinitely.

Options:
1. No limit. Coordinators escalate manually.
2. Alert after N failed verifications (recommended: 3).
3. Hard database limit.

**Does not block migration.** No schema change required for the alerting approach.
If a counter column is desired, it would be an additional column on reports.

---

### PD-W6 - under_review Always Required

**Source:** WORKFLOW.md
**Status: RECOMMENDED**
**Recommendation:** Both paths allowed. Direct submitted to assigned permitted for obvious cases.

**Does not block migration.** Both paths are already encoded in the status transition map.

---

*Phase 3B update. Approved decisions incorporated 2026-10-18.*
*See PHASE_3B_REVIEW.md for change summary.*
*All OPEN and RECOMMENDED decisions still require explicit owner approval.*
