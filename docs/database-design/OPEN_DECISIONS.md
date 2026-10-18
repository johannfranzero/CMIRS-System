# CMIRS - Open Decisions

> **Status: PLANNING DOCUMENT**
> This document consolidates all unresolved decisions that must be answered by the
> project owner before database migrations can be prepared or implemented.
> Recommendations are included but MUST NOT be treated as approved requirements.
> Each decision needs an explicit owner response.

## How to Use This Document

For each decision:
1. Read the Context to understand what is at stake.
2. Read the Options to see the alternatives.
3. Read the Recommendation (this is a proposal, not a decision).
4. Respond with your chosen option or a custom answer.
5. Decisions will be incorporated into the migration scripts only after approval.

---

## Consolidated Decision Register

| ID | Source | Status | Summary |
|---|---|---|---|
| PD-D1 | DATABASE.md | Open | Location table structure |
| PD-D2 | DATABASE.md | Open | Attachment mutability |
| PD-D3 | DATABASE.md | Open | Comment mutability |
| PD-D4 | DATABASE.md | Open | Report number format |
| PD-D5 | DATABASE.md | Open | Photo size and count limits |
| PD-D6 | DATABASE.md | Open | Notification creation: triggers vs application |
| PD-D7 | DATABASE.md | Open | confirmed_priority: nullable vs default |
| PD-D8 | New | Open | Hard user deletion policy |
| PD-D9 | New | Open | Timestamps on categories |
| PD-D10 | New | Open | Uniqueness constraint on locations |
| PD-R1 | ROLES.md | Open | Technician visibility scope |
| PD-R2 | ROLES.md | Open | Technician ability to decline assignment |
| PD-R3 | ROLES.md | Open | Technician ability to request work hold |
| PD-R4 | ROLES.md, SECURITY.md | Open | Coordinator self-verification |
| PD-R5 | ROLES.md | Open | Reporter cancellation authority |
| PD-R6 | ROLES.md | Open | Administrator and Management as reporters |
| PD-S1 | SECURITY.md | Open | API rate limiting strategy |
| PD-S2 | SECURITY.md | Open | Session timeout duration |
| PD-S3 | SECURITY.md | Open | Password policy requirements |
| PD-S4 | SECURITY.md | Open | CORS configuration |
| PD-W1 | WORKFLOW.md | Open | Who can initiate work holds |
| PD-W2 | WORKFLOW.md | Open | Reporter cancellation: which stages |
| PD-W3 | WORKFLOW.md | Open | Coordinator cancellation authority |
| PD-W4 | WORKFLOW.md | Open | Assignment handling on cancellation |
| PD-W5 | WORKFLOW.md | Open | Maximum reopening count |
| PD-W6 | WORKFLOW.md | Open | under_review usage (always required?) |
| OD-NEW-1 | SCHEMA_PROPOSAL | Open | Owner approval for role_change_audit table |

---

## Decisions Affecting the Database Schema

These must be resolved before migration scripts are written.

### PD-D1 - Location Table Structure

**Source:** DATABASE.md
**Context:** The current locations table stores building_name, floor, and room in a
single flat table. This is simple but may limit structured queries and location hierarchy
management if the campus has many buildings with many rooms.

**Options:**
1. Keep single locations table (current design). Simpler. Recommended.
2. Split into buildings table and rooms table with a FK relationship. Supports hierarchy,
   enables building-level queries, but adds complexity.

**Recommendation:** Keep single locations table. Split only if hierarchical location
queries are needed. This can be refactored later if requirements change.

**Impact if split:** locations table is replaced. All FK references in reports.location_id
would point to rooms table. Adds migration complexity.

**Decision required:** Which structure do you want?

---

### PD-D2 - Attachment Mutability

**Source:** DATABASE.md
**Context:** Once a photo attachment is uploaded, can it be modified or deleted?
This affects audit integrity and storage cleanup.

**Options:**
1. Immutable: No edits or deletes after upload. Strongest audit integrity. Recommended.
2. Soft-delete: Mark deleted in database but retain in storage (or vice versa).
3. Hard-delete: Remove both database record and storage file. Simplest cleanup. Weakest audit.

**Recommendation:** Treat attachments as immutable for audit integrity. If removal is
absolutely needed, only administrator should be able to soft-delete, and it should be logged.

**Impact on schema:** Determines UPDATE and DELETE policies on report_attachments and
Supabase Storage policies for the attachments bucket.

**Decision required:** Can attachments be deleted or edited after upload? If yes, who can do it?

---

### PD-D3 - Comment Mutability

**Source:** DATABASE.md
**Context:** Once a comment is posted, can the author edit or delete it?
The updated_at column exists in anticipation of edits. If edits are not permitted,
it adds confusion.

**Options:**
1. Edits allowed, deletes not allowed. updated_at column is useful. Recommended.
2. Neither edits nor deletes allowed. Append-only comments. Remove updated_at.
3. Both edits and deletes allowed by author. Most flexible, weakest audit.

**Recommendation:** Allow edits by the original author (tracked via updated_at).
Prohibit hard deletes for all roles.

**Impact on schema:** Determines whether updated_at is retained, and the UPDATE and
DELETE policies on report_comments.

**Decision required:** Can comments be edited after creation? Can they be deleted?

---

### PD-D4 - Report Number Format

**Source:** DATABASE.md
**Context:** Every report needs a unique human-readable identifier for verbal reference
and printed documents. The format must be confirmed before the generation trigger is implemented.

**Options:**
1. RPT-000001 (recommended: prefix + 6-digit zero-padded sequence)
2. RPT-2026-000001 (year-prefixed, resets per year, more complex)
3. RPT-ELEC-000001 (category-coded, multiple sequences, significantly more complex)
4. Simple integer: 1, 2, 3 (minimal, loses prefix readability)

**Recommendation:** RPT-000001 format. Simple, human-readable, globally unique,
no per-year or per-category complexity.

**Decision required:** What report number format do you want?

---

### PD-D5 - Photo Size and Count Limits

**Source:** DATABASE.md, SECURITY.md
**Context:** Attachment validation requires defined limits. Without confirmed limits,
the application cannot enforce file size or count constraints.

**Options:** Any reasonable limits based on storage budget and UX needs.

**Recommendation:**
- Maximum 5 photos per report.
- Maximum 10 MB per file.
- Accepted MIME types: image/jpeg, image/png, image/webp.

**Impact on schema:** CHECK constraints on report_attachments. Storage policy configuration.
Application-level validation rules.

**Decision required:** What are the maximum file count per report, maximum file size,
and accepted MIME types?

---

### PD-D6 - Notification Creation Method

**Source:** DATABASE.md
**Context:** Notifications can be created by database triggers (automatic, tightly coupled)
or by application logic in server actions/API routes (explicit, more testable).

**Options:**
1. Application-level: Server actions create notifications when events occur. More explicit,
   easier to test and debug. Recommended.
2. Database triggers: Notifications created automatically when events fire. Less code
   duplication but harder to debug and test.
3. Hybrid: Triggers for critical audit events; application for notifications.

**Recommendation:** Application-level notification creation for simplicity. Database triggers
are considered for critical audit events (status history) only.

**Decision required:** Should notifications be created by database triggers or application code?

---

### PD-D7 - confirmed_priority Nullable vs Default

**Source:** DATABASE.md
**Context:** The confirmed_priority column is currently nullable. NULL means the coordinator
has not yet reviewed the report. An alternative is to set a default value (e.g., low) and use
a separate reviewed_at timestamp to indicate whether priority has been confirmed.

**Options:**
1. Keep nullable (current design, recommended). NULL clearly signals unreviewed status.
2. Use a default value (e.g., low). Requires a separate boolean or timestamp to track
   whether coordinator has actually reviewed the report.

**Recommendation:** Keep confirmed_priority nullable. NULL is semantically clear and
avoids the need for an additional column.

**Decision required:** Should confirmed_priority default to a value, or remain nullable?

---

### PD-D8 - Hard User Deletion Policy

**Source:** New (identified during schema review)
**Context:** The schema uses is_active = false for soft-deactivation of users.
But what happens if a user account needs to be hard-deleted (e.g., GDPR right to erasure)?
RESTRICT foreign keys prevent deletion of profiles that are referenced by historical records.

**Options:**
1. Soft-delete only (recommended). is_active = false. Historical records preserved.
2. Hard-delete with anonymization. Replace PII in historical records with placeholder values
   before deleting the profile.
3. Hard-delete not supported. Deactivation is the only option.

**Recommendation:** Soft-delete only for MVP. Hard-delete with anonymization is a
future consideration if legal requirements demand it.

**Decision required:** Should hard user deletion be supported? If yes, what PII fields
need to be anonymized in historical records?

---

### PD-D9 - Timestamps on categories Table

**Source:** New (identified during schema review)
**Context:** DATABASE.md does not include created_at or updated_at on the categories table.
This means there is no record of when a category was added or last modified.

**Options:**
1. Add created_at only (lightweight audit trail). Recommended.
2. Add both created_at and updated_at (with trigger). Full timestamp tracking.
3. No timestamps (current DATABASE.md design).

**Recommendation:** Add created_at at minimum. It helps administrators track when
categories were introduced.

**Decision required:** Should created_at and/or updated_at be added to categories?

---

### PD-D10 - Uniqueness Constraint on locations

**Source:** New (identified during schema review)
**Context:** The current locations table has no unique constraint on the combination of
building_name, floor, and room. This means duplicate location entries can be created.

**Options:**
1. Add a UNIQUE constraint on (building_name, floor, room). Prevents duplicates. Recommended.
2. No unique constraint. Allow duplicate entries (creates data quality issues).
3. Enforce uniqueness at the application level only (weaker than database constraint).

**Recommendation:** Add a UNIQUE constraint on (building_name, floor, room).
Null handling in unique indexes should be considered (PostgreSQL allows multiple nulls).

**Decision required:** Should a unique constraint be added to locations?

---

## Decisions Affecting Roles and Permissions

### PD-R1 - Technician Visibility Scope

**Source:** ROLES.md
**Context:** Can technicians view reports assigned to other technicians? ROLES.md marks
this as pending with a warning symbol in the permission matrix.

**Options:**
1. Restrict to own assignments only (recommended, least privilege). Coordinator provides
   context when needed.
2. Allow technicians to see all reports (simpler queries, less privacy isolation).

**Recommendation:** Restrict technicians to their own assigned reports. This is the
least-privilege choice and reduces information exposure.

**Impact on RLS:** Determines the SELECT policy on reports, assignments, report_comments,
report_attachments, report_status_history, work_logs, and verifications for the technician role.

**Decision required:** Can technicians view reports assigned to other technicians?

---

### PD-R2 - Technician Ability to Decline Assignment

**Source:** ROLES.md
**Context:** If a technician can decline an assignment, the assignment_status enum needs
accepted and declined values, and the workflow needs a decline/reassignment path.

**Options:**
1. Allow decline with required reason (recommended). Coordinator must then reassign.
2. No decline. Technicians must accept all assignments. Coordinator handles any issues.

**Recommendation:** Allow decline with a required reason. Triggers coordinator reassignment.
Adds declined to assignment_status enum.

**Impact on schema:** assignment_status enum extension. Workflow changes. RLS policy updates.

**Decision required:** Can technicians decline an assignment? If yes, with what constraints?

---

### PD-R3 - Technician Ability to Request Work Hold

**Source:** ROLES.md
**Context:** Who can initiate a work hold (on_hold status)? This overlaps with PD-W1.

**Options:** See PD-W1 below.

---

### PD-R4 - Coordinator Self-Verification

**Source:** ROLES.md, SECURITY.md
**Context:** Can a coordinator verify a repair on a report they themselves submitted?
This is a separation-of-duties question. D2 prohibits the technician from verifying
their own work, but the rule for coordinator-submitted reports is open.

**Options:**
1. Prohibit self-verification (recommended). A different coordinator must verify.
2. Allow self-verification. No restriction on who submitted the report.

**Recommendation:** Prohibit self-verification to maintain independence. Require that
verified_by not equal reports.reporter_id when verified_by has the coordinator role.

**Impact on RLS:** The verifications INSERT policy needs a condition checking that
auth.uid() != reports.reporter_id for the report being verified.

**Decision required:** Can a coordinator verify a report they submitted?

---

### PD-R5 - Reporter Cancellation Authority

**Source:** ROLES.md
**Context:** Can reporters cancel their own reports after submission? If yes, at which
statuses? This overlaps with PD-W2.

**Options:** See PD-W2 below.

---

### PD-R6 - Administrator and Management as Reporters

**Source:** ROLES.md
**Context:** The ROLES.md permission matrix marks report submission as not permitted for
administrator and management roles. Should these roles be able to submit maintenance reports?

**Options:**
1. Keep as not permitted (current design). Administrative roles do not submit reports.
2. Allow administrator and management to submit reports. They may also identify issues.

**Recommendation:** Decision deferred to owner. If administrators encounter maintenance
issues, they could be given a student_personnel secondary role or the restriction removed.

**Decision required:** Should administrator and management roles be able to submit reports?

---

## Decisions Affecting Security

### PD-S1 - Rate Limiting Strategy

**Source:** SECURITY.md
**Context:** API endpoints and form submissions need rate limiting to prevent abuse.

**Options:**
1. Supabase built-in rate limiting on auth endpoints.
2. Next.js middleware-based rate limiting using IP or session.
3. Both (recommended for comprehensive coverage).

**Decision required:** What rate limiting approach should be implemented?

---

### PD-S2 - Session Timeout Duration

**Source:** SECURITY.md
**Context:** How long should user sessions remain active without re-authentication?

**Options:**
1. Use Supabase Auth default (1 hour access token, 1 week refresh token).
2. Configure shorter timeout for higher security.
3. Configure longer timeout for convenience.

**Decision required:** What session timeout and refresh token duration is acceptable?

---

### PD-S3 - Password Policy Requirements

**Source:** SECURITY.md
**Context:** What are the minimum password requirements?

**Options:**
1. Supabase Auth default minimum (8 characters).
2. Custom minimum length (e.g., 12 characters).
3. Additional complexity requirements (uppercase, number, symbol).

**Decision required:** What password policy should be enforced?

---

### PD-S4 - CORS Configuration

**Source:** SECURITY.md
**Context:** If the API is accessed from domains other than the primary frontend, CORS
must be configured.

**Decision required:** Will the API be accessed from any domain other than the primary
Next.js deployment? If yes, which origins need to be allowlisted?

---

## Decisions Affecting Workflow

### PD-W1 - Who Can Initiate a Work Hold

**Source:** WORKFLOW.md
**Context:** The on_hold status requires a pending actor. The documented options are
technician only, coordinator only, or either.

**Options:**
1. Technician only. They know when work is blocked.
2. Coordinator only. Provides oversight control.
3. Either technician or coordinator (recommended). Both parties may have valid reasons.

**Recommendation:** Allow both technician and coordinator to initiate holds, each with
a required reason recorded in report_status_history.

**Impact on schema:** Determines actor enforcement on the in_progress to on_hold
transition. Affects RLS policy on reports UPDATE (status).

**Decision required:** Who can initiate a work hold?

---

### PD-W2 - Reporter Cancellation: Which Stages

**Source:** WORKFLOW.md
**Context:** Can reporters cancel their own reports? If yes, at which stages?

**Options:**
1. Reporter can cancel only at submitted stage (before any coordinator action). Most restrictive.
2. Reporter can cancel at submitted or under_review stages (before assignment). Recommended.
3. Reporter can cancel at any non-terminal stage. Most permissive.
4. Reporter cannot cancel. Only coordinator can cancel.

**Recommendation:** Allow reporter cancellation at submitted and under_review only.
Once assigned, cancellation requires coordinator action.

**Impact on schema:** reports UPDATE policy for student_personnel role.
report_status_history INSERT for reporter-initiated cancellations.

**Decision required:** Can reporters cancel their own reports? If yes, at which stages?

---

### PD-W3 - Coordinator Cancellation Authority

**Source:** WORKFLOW.md
**Context:** Can a coordinator cancel a report at any non-terminal stage?

**Options:**
1. Coordinator can cancel at any non-terminal stage (recommended). Reason required.
2. Coordinator can cancel only before assignment. More restrictive.
3. Coordinator cannot cancel after in_progress (requires separate approval).

**Recommendation:** Allow coordinator cancellation at any non-terminal stage with a
required reason.

**Decision required:** At which stages can a coordinator cancel a report?

---

### PD-W4 - Assignment Handling on Cancellation

**Source:** WORKFLOW.md
**Context:** If a report is cancelled while assigned or in_progress, what happens to the
existing assignment record?

**Options:**
1. Mark the assignment as cancelled (recommended). Technician is notified.
2. Mark the assignment as reassigned (semantically incorrect but reuses existing status).
3. Leave the assignment record unchanged but the report becomes cancelled.

**Recommendation:** Mark the assignment as cancelled in assignments.status.
The technician receives a report_cancelled notification.

**Decision required:** How should an active assignment be handled when its report is cancelled?

---

### PD-W5 - Maximum Reopening Count

**Source:** WORKFLOW.md
**Context:** Should there be a maximum number of times a report can be reopened after
failed verification? Without a limit, a report could cycle indefinitely.

**Options:**
1. No limit (current design). Coordinators manually escalate if needed.
2. Alert after N reopenings (recommended). No hard limit, but escalation notification.
3. Hard limit: after N reopenings, escalate to administrator or management automatically.

**Recommendation:** Track reopening count. Alert coordinator and management after
3 failed verifications. No hard limit enforced by database for MVP.

**Impact on schema:** May require a reopening_count column on reports, or can be computed
from verifications table (count of is_satisfactory = false records).

**Decision required:** Should there be a reopening limit or escalation threshold?

---

### PD-W6 - under_review Always Required

**Source:** WORKFLOW.md
**Context:** WORKFLOW.md includes a submitted to assigned direct transition (skipping
under_review). Is this allowed, or must every report go through under_review?

**Options:**
1. Both paths allowed (current design, recommended). Direct assignment when obvious.
2. under_review always required before assignment. More rigorous but slower.

**Recommendation:** Both paths allowed. The direct submitted to assigned path is useful
for straightforward requests where priority is obvious.

**Decision required:** Must every report pass through under_review, or is direct assignment permitted?

---

## New Decisions Added in Phase 3A Review

### OD-NEW-1 - Owner Approval for role_change_audit Table

**Source:** SCHEMA_PROPOSAL.md (Phase 3A addition)
**Context:** The DATABASE.md Phase 0 schema does not include a role_change_audit table.
SCHEMA_PROPOSAL.md adds this table to satisfy documented audit requirements in ROLES.md
and SECURITY.md. Because this is a deviation from the approved Phase 0 schema,
it requires explicit owner approval before implementation.

**Proposed table:** Append-only log of every role assignment and change, recording
user_id, changed_by, old_role, new_role, reason, and created_at.

**Recommendation:** Add this table. It directly satisfies the documented requirement that
"role changes should be logged for audit purposes" and is consistent with the overall
audit-trail design of the system.

**Decision required:** Do you approve adding the role_change_audit table to the schema?

---

*Phase 3A database planning. See SCHEMA_PROPOSAL.md and RLS_POLICY_PROPOSAL.md for context.*
*All decisions in this document require explicit owner approval before implementation.*
