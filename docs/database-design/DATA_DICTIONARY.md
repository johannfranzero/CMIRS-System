# CMIRS - Data Dictionary

> **Status: PROPOSAL - Updated Phase 3C (2026-10-18). Not implemented.**
> Reflects all owner-approved decisions through Phase 3C.
> Column-level definitions for all proposed tables.

## Table of Contents

- [Overview](#overview)
- [Enums](#enums)
- [Table: profiles](#table-profiles)
- [Table: role_change_audit](#table-role_change_audit)
- [Table: categories](#table-categories)
- [Table: locations](#table-locations)
- [Table: reports](#table-reports)
- [Table: report_attachments](#table-report_attachments)
- [Table: report_status_history](#table-report_status_history)
- [Table: report_comments](#table-report_comments)
- [Table: assignments](#table-assignments)
- [Table: work_logs](#table-work_logs)
- [Table: verifications](#table-verifications)
- [Table: notifications](#table-notifications)

---

## Overview

This data dictionary defines every column in every proposed CMIRS table. For each column:
- Name: the snake_case column identifier
- Type: the PostgreSQL data type
- Nullable: whether the column can be NULL
- Default: the default value if any
- Constraints: key constraints (PK, FK, UNIQUE, CHECK, NOT NULL)
- Description: semantic meaning and usage notes

Phase 3B and 3C changes are noted inline where applicable.

---

## Enums

### user_role

| Value | Description |
|---|---|
| student_personnel | Default role assigned at registration. Represents any student or school staff member who reports issues. Has the least operational permissions. May submit reports. |
| coordinator | Maintenance Coordinator. Reviews, assigns, and verifies reports. Central operational role. Cannot verify own submitted reports (APPROVED PD-R4). |
| technician | Maintenance Technician. Performs repairs and logs work. Accesses only assigned reports (APPROVED PD-R1). May initiate work holds (APPROVED PD-W1) and decline assignments (APPROVED PD-R2). May submit reports (APPROVED PD-R6). |
| administrator | School Administrator. Manages user accounts and role assignments. Cannot perform operational maintenance actions. May submit reports (APPROVED PD-R6). |
| management | School Management. Read-only visibility into system operations and reports. May submit reports (APPROVED PD-R6). |

### report_status

| Value | Terminal | Description |
|---|---|---|
| submitted | No | Initial state when a report is created. Awaiting coordinator review. Reporter may cancel at this stage (APPROVED PD-W2). |
| under_review | No | Coordinator is actively reviewing the report and assessing priority. Reporter may cancel at this stage (APPROVED PD-W2). |
| assigned | No | Report assigned to a technician. Work has not started. Only coordinator may cancel (APPROVED PD-W3). |
| in_progress | No | Assigned technician is actively working on the repair. Technician or coordinator may initiate hold (APPROVED PD-W1). Only coordinator may cancel (APPROVED PD-W3). |
| on_hold | No | Work is temporarily paused. Requires a reason. Technician or coordinator may resume (APPROVED PD-W1). Only coordinator may cancel (APPROVED PD-W3). |
| completed | No | Technician finished the repair. Awaiting coordinator verification. Only coordinator may cancel (APPROVED PD-W3). |
| verified | Yes | Coordinator verified the repair is satisfactory. Report closed. |
| reopened | No | Verification failed. Report returned for additional work. Only coordinator may cancel (APPROVED PD-W3). |
| cancelled | Yes | Report cancelled. No further transitions. Reason always required. |

### priority_level

| Value | Description | Expected Response |
|---|---|---|
| low | Minor cosmetic or non-urgent issue. | Scheduled maintenance window. |
| medium | Functional issue affecting usability. | Addressed within normal workflow. |
| high | Significant issue affecting safety or operations. | Prioritized for prompt attention. |
| critical | Immediate safety hazard requiring urgent response. | Expedited handling per WORKFLOW.md. |

### assignment_status

| Value | Active | Description |
|---|---|---|
| assigned | Yes | Technician has been assigned. Work not yet started. |
| in_progress | Yes | Technician is actively working on the assignment. |
| on_hold | Yes | Work is temporarily paused (APPROVED PD-W1). |
| completed | No | Technician has finished the assigned work. Not modified by report cancellation. |
| reassigned | No | This assignment was superseded by a new assignment. Kept for audit trail. Not modified by report cancellation. |
| cancelled | No (terminal) | Assignment cancelled because the parent report was cancelled (APPROVED PD-W4). No further status updates or work_log inserts are permitted against a cancelled assignment. |
| declined | No (terminal) | Technician declined the assignment (APPROVED PD-R2). A reason is required (gap: OD-NEW-3 — no current field to store it). No further status updates or work_log inserts are permitted. Declined assignments are excluded from the technician report-visibility rule (APPROVED PD-R1). |

Active statuses (assigned, in_progress, on_hold):
- May receive work_logs.
- May receive status updates.
- Are marked cancelled atomically when parent report is cancelled (APPROVED PD-W4).

Non-active statuses (completed, reassigned, cancelled, declined):
- Cannot receive work_logs.
- Cannot receive further status updates (terminal for the assignment record).

### notification_type

| Value | Description |
|---|---|
| report_submitted | New report submitted. Sent to coordinators. |
| report_assigned | Report assigned to technician. Sent to assigned technician. |
| status_changed | Report status changed. Sent to reporter and coordinator. |
| priority_changed | Coordinator changed confirmed priority. Sent to reporter. |
| comment_added | New comment on report. Sent to all parties. |
| verification_required | Repair completed. Sent to coordinator for verification. |
| verification_complete | Coordinator verified satisfactory. Sent to reporter and technician. |
| verification_failed | Verification rejected. Sent to reporter and technician. |
| report_reassigned | Report reassigned to different technician. Sent to both technicians and coordinator. |
| report_cancelled | Report cancelled. Sent to all parties including affected technicians. |

Note: An assignment_declined notification type may be needed for coordinator notification
when a technician declines. This is a pending implementation detail (not yet formally approved).

---

## Table: profiles

Purpose: Extends auth.users with application-specific data.
Single source of truth for user identity and role.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | None | PK, references auth.users(id) ON DELETE CASCADE | User identifier from Supabase Auth. Set by T4. |
| email | TEXT | No | None | NOT NULL | User email address from Auth. |
| full_name | TEXT | No | None | NOT NULL | User display name. |
| role | user_role | No | student_personnel | NOT NULL DEFAULT student_personnel | Operational role (D1). Only administrator may change this column. |
| phone | TEXT | Yes | NULL | None | Optional phone number. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether account is active. Soft-deactivation (PD-D8 OPEN). |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Account creation timestamp. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Last profile modification. Updated by T1. |

---

## Table: role_change_audit

Purpose: Append-only audit log of every role assignment and change.
APPROVED (OD-NEW-1, 2026-10-18).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Audit record identifier. |
| user_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user whose role changed. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The administrator who performed the change. |
| old_role | user_role | No | None | NOT NULL | Role before the change. |
| new_role | user_role | No | None | NOT NULL | Role after the change. |
| reason | TEXT | Yes | NULL | None | Optional justification for the change. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the change was recorded. |

Check constraint: chk_role_changed: old_role <> new_role. Prevents no-op audit entries.
Append-only.

---

## Table: categories

Purpose: Predefined maintenance issue categories.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Category identifier. |
| name | TEXT | No | None | NOT NULL UNIQUE | Unique category name. |
| description | TEXT | Yes | NULL | None | Optional description. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether available for new reports. Soft-delete. |

---

## Table: locations

Purpose: Campus locations.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Location identifier. |
| building_name | TEXT | No | None | NOT NULL | Building name. |
| floor | TEXT | Yes | NULL | None | Floor number or description. |
| room | TEXT | Yes | NULL | None | Room number or name. |
| description | TEXT | Yes | NULL | None | Additional location details. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether available for new reports. Soft-delete. |

---

## Table: reports

Purpose: Central entity for the full lifecycle of each maintenance and incident report.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Report identifier. |
| report_number | TEXT | No | None | NOT NULL UNIQUE | Human-readable report number. Generated by T2 as RPT-000001 format using PostgreSQL SEQUENCE (APPROVED PD-D4). Immutable after creation. |
| title | TEXT | No | None | NOT NULL | Brief summary of the issue. |
| description | TEXT | No | None | NOT NULL | Detailed description of the problem. |
| category_id | UUID | No | None | NOT NULL, FK -> categories(id) RESTRICT | The maintenance category. |
| location_id | UUID | No | None | NOT NULL, FK -> locations(id) RESTRICT | Where the issue is located. |
| reporter_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who submitted the report. Set to auth.uid() at INSERT. Any authenticated role may submit (APPROVED PD-R6). Used in the coordinator self-verification check (APPROVED PD-R4) and reporter cancellation authority check (APPROVED PD-W2). |
| status | report_status | No | submitted | NOT NULL DEFAULT submitted | Current lifecycle status. Transitions validated by application and trigger T3. |
| is_urgent_hazard | BOOLEAN | No | false | NOT NULL DEFAULT false | Reporter-set urgent hazard flag (D3). Does not automatically set priority. |
| confirmed_priority | priority_level | Yes | NULL | None | Coordinator-confirmed priority (D3). NULL until coordinator sets it (RECOMMENDED PD-D7). |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Report creation timestamp. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Last modification. Updated by T1. |

---

## Table: report_attachments

Purpose: File metadata for optional photo attachments (D4).
APPROVED (PD-D2, PD-D5, 2026-10-18): immutable after upload; coordinator-controlled deletion.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Attachment identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report this attachment belongs to. |
| file_path | TEXT | No | None | NOT NULL | Path to the file in Supabase Storage. Preserved in any deletion audit log (OD-NEW-2). |
| file_name | TEXT | No | None | NOT NULL | Original filename (sanitized server-side). |
| file_size | INTEGER | No | None | NOT NULL, CHECK (file_size > 0 AND file_size <= 10485760) | File size in bytes. Max 10 MB (APPROVED PD-D5). |
| mime_type | TEXT | No | None | NOT NULL, CHECK (mime_type IN ('image/jpeg','image/png','image/webp')) | MIME type. Verified via magic bytes server-side before INSERT (APPROVED PD-D5). |
| uploaded_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who uploaded the file. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Upload timestamp. |

Key notes:
- Immutable after upload. UPDATE is DENY for all roles (APPROVED PD-D2).
- Per-report limit of 5 enforced server-side (APPROVED PD-D5). Not expressible as row-level CHECK.
- Coordinator-controlled deletion approved in principle (PD-D2). Not yet implementable:
  OD-NEW-2 (deletion audit mechanism) must be resolved first.
  Conservative default: DELETE DENY for all roles until OD-NEW-2 is resolved.
- Partial failure handling: DB record removed first, then Storage deletion attempted asynchronously.
  See OPEN_DECISIONS.md PD-D2 for full partial-failure handling documentation.

---

## Table: report_status_history

Purpose: Append-only audit trail of every status transition on a report.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | History entry identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report this history entry belongs to. |
| previous_status | report_status | Yes | NULL | None | Status before transition. NULL for initial submission record. |
| new_status | report_status | No | None | NOT NULL | Status after the transition. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who performed the transition. |
| reason | TEXT | Yes | NULL | None | Required for on_hold (APPROVED PD-W1), cancelled (APPROVED PD-W2, PD-W3), and reopened transitions. Optional for all other transitions. Application-enforced. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Transition timestamp. |

Append-only. No UPDATE or DELETE permitted (RLS-enforced).

---

## Table: report_comments

Purpose: User-authored comments on reports.
IMMUTABLE after creation (APPROVED PD-D3, 2026-10-18).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Comment identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report this comment belongs to. |
| author_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who wrote the comment. |
| content | TEXT | No | None | NOT NULL | Comment text. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the comment was created. |

Key notes:
- updated_at column REMOVED (APPROVED PD-D3): comments are immutable; no edits permitted.
- T1 trigger (fn_set_updated_at) does NOT apply to this table.
- UPDATE and DELETE are DENY for all roles including coordinator and administrator.
- Corrections must be posted as new follow-up comments.
- No moderation exception or retention policy for MVP. A separate decision is required
  if any deletion or editing need arises in the future.

---

## Table: assignments

Purpose: Links reports to assigned technicians. All records retained for audit trail.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Assignment identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report being assigned. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The assigned technician. Must have role = technician (application-enforced). |
| assigned_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The coordinator who made the assignment. Must have role = coordinator (application-enforced). |
| status | assignment_status | No | assigned | NOT NULL DEFAULT assigned | Current assignment status. Previous assignments are marked reassigned, not deleted. When a report is cancelled, all active assignments (status IN assigned, in_progress, on_hold) for that report are marked cancelled within a single atomic transaction (APPROVED PD-W4). Assignments at completed, reassigned, declined, or cancelled are not changed. Once an assignment reaches cancelled or declined it is terminal: no further status updates are permitted. |
| assigned_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this assignment was created. |
| started_at | TIMESTAMPTZ | Yes | NULL | None | When the technician transitioned to in_progress. |
| completed_at | TIMESTAMPTZ | Yes | NULL | None | When the technician marked the repair complete. |
| notes | TEXT | Yes | NULL | None | Assignment notes from coordinator to technician. Not to be used for technician decline reason (see OD-NEW-3). |

Schema gap (OD-NEW-3 OPEN): No field exists to store the technician's decline reason.
assignments.notes is for coordinator notes, not technician responses.
Until OD-NEW-3 is resolved, the decline reason cannot be reliably stored or audited.

---

## Table: work_logs

Purpose: Append-only records of technician work sessions.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this work log entry. |
| assignment_id | UUID | No | None | NOT NULL, FK -> assignments(id) ON DELETE CASCADE | The assignment this work log belongs to. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The technician who performed this work. Must match assignment.technician_id (application-enforced). Work log inserts against a cancelled or declined assignment are blocked by the work_logs RLS INSERT policy (APPROVED PD-W4, PD-R2): the policy predicate checks assignment.status NOT IN ('cancelled', 'declined'). |
| description | TEXT | No | None | NOT NULL | Description of the work performed during this session. |
| hours_spent | DECIMAL(5,2) | Yes | NULL | None | Hours spent. Optional. Supports up to 999.99 hours. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this log entry was created. |

---

## Table: verifications

Purpose: Coordinator verification decisions on completed repairs. One record per attempt.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Verification record identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report being verified. |
| verified_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The coordinator who performed verification. Must have role = coordinator (application-enforced). Must NOT be the technician_id of the active assignment (D2). Must NOT be reports.reporter_id for this report (APPROVED PD-R4). |
| is_satisfactory | BOOLEAN | No | None | NOT NULL | Whether the repair passed verification. |
| notes | TEXT | Yes | NULL | None | Verification notes or rejection reason. |
| verified_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When verification was performed. |

---

## Table: notifications

Purpose: In-app notification records (D7). MVP only — no email/SMS/push.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Notification identifier. |
| recipient_id | UUID | No | None | NOT NULL, FK -> profiles(id) ON DELETE CASCADE | The user receiving this notification. |
| type | notification_type | No | None | NOT NULL | Category of the notification event. |
| title | TEXT | No | None | NOT NULL | Notification title displayed to user. |
| message | TEXT | No | None | NOT NULL | Notification body text. |
| report_id | UUID | Yes | NULL | FK -> reports(id) ON DELETE SET NULL | Associated report (nullable; some notifications may not reference a specific report). |
| is_read | BOOLEAN | No | false | NOT NULL DEFAULT false | Whether the recipient has read this notification. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this notification was created. |

Only is_read may be updated (by the recipient). All other columns immutable.

---

*Phase 3C update 2026-10-18. See OPEN_DECISIONS.md for all decisions.*
*See SCHEMA_PROPOSAL.md for table structure and constraints.*
*See RLS_POLICY_PROPOSAL.md for access control policies.*
