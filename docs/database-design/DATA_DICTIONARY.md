# CMIRS - Data Dictionary

> **Status: PROPOSAL - Updated Phase 3B (2026-10-18). Not implemented.**
> Reflects seven owner-approved decisions. Column-level definitions for all proposed tables.

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

Phase 3B changes are noted inline where applicable.

---

## Enums

### user_role

| Value | Description |
|---|---|
| student_personnel | Default role assigned at registration. Represents any student or school staff member who reports issues. Has the least operational permissions. |
| coordinator | Maintenance Coordinator. Reviews, assigns, and verifies reports. Central operational role. |
| technician | Maintenance Technician. Performs repairs and logs work. Can only interact with assigned reports. May initiate work holds per APPROVED PD-W1. |
| administrator | School Administrator. Manages user accounts and role assignments. Cannot perform operational actions. |
| management | School Management. Read-only visibility into system operations and reports. |

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
| cancelled | Yes | Report cancelled. No further transitions. Reason is always required. |

### priority_level

| Value | Description | Expected Response |
|---|---|---|
| low | Minor cosmetic or non-urgent issue. | Scheduled maintenance window. |
| medium | Functional issue affecting usability. | Addressed within normal workflow. |
| high | Significant issue affecting safety or operations. | Prioritized for prompt attention. |
| critical | Immediate safety hazard requiring urgent response. | Expedited handling per WORKFLOW.md. |

### assignment_status

| Value | Description |
|---|---|
| assigned | Technician has been assigned. Work not yet started. |
| in_progress | Technician has started work on the assignment. |
| completed | Technician has finished the assigned work. |
| reassigned | This assignment was superseded by a new assignment. Kept for audit trail. |
| cancelled | Assignment cancelled because the parent report was cancelled (APPROVED PD-W3). |

Note (PD-R2 OPEN): accepted and declined values are not included pending owner decision.

### notification_type

| Value | Description |
|---|---|
| report_submitted | A new report was submitted. Sent to coordinators. |
| report_assigned | A report was assigned to a technician. Sent to assigned technician. |
| status_changed | A report status was updated. Sent to reporter and assigned technician. |
| priority_changed | A report confirmed_priority was changed. Sent to reporter and assigned technician. |
| comment_added | A comment was added. Sent to reporter, assigned technician, and relevant coordinator. |
| verification_required | A completed report awaits verification. Sent to coordinators. |
| verification_complete | Repair verified as satisfactory. Sent to reporter and assigned technician. |
| verification_failed | Verification failed, report reopened. Sent to assigned technician. |
| report_reassigned | Report reassigned to different technician. Sent to previous and new technician. |
| report_cancelled | Report was cancelled. Sent to reporter and assigned technician if any. |

---

## Table: profiles

Purpose: Application user data extending auth.users.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | None (set by T4) | PK, FK -> auth.users(id) ON DELETE CASCADE | The Supabase Auth user ID. Same UUID as auth.users.id. Set by trigger T4 on registration. |
| email | TEXT | No | None | NOT NULL | User's email address. Synchronized from auth.users.email at profile creation. |
| full_name | TEXT | No | None | NOT NULL | User's display name. Collected at registration and stored in profile. |
| role | user_role | No | student_personnel | NOT NULL DEFAULT student_personnel | The user's assigned system role. Only administrator can change this column. |
| phone | TEXT | Yes | NULL | None | Optional contact phone number. Not required for any workflow. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether the account is active. Inactive accounts cannot log in or perform actions (soft-deactivation). |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the profile was created (on Supabase Auth signup). |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the profile was last modified. Updated by trigger T1. |

---

## Table: role_change_audit

Purpose: Append-only audit log for all role assignments and changes.
APPROVED (OD-NEW-1, 2026-10-18): Table is included in schema.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this audit record. |
| user_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user whose role was changed. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The administrator who performed the role change. Must have role = administrator at time of change. |
| old_role | user_role | No | None | NOT NULL | The role before the change. |
| new_role | user_role | No | None | NOT NULL, CHECK (new_role <> old_role) | The role after the change. Must differ from old_role. |
| reason | TEXT | Yes | NULL | None | Optional reason or notes for the role change. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the role change was made. |

---

## Table: categories

Purpose: Predefined maintenance issue categories for classifying reports.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the category. |
| name | TEXT | No | None | NOT NULL UNIQUE | The category name. Must be unique. |
| description | TEXT | Yes | NULL | None | Optional longer description. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether available for new report submissions. Inactive categories remain for FK integrity. |

Note (PD-D9 RECOMMENDED): created_at not yet added pending owner decision.

---

## Table: locations

Purpose: Campus locations where maintenance issues can occur.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the location. |
| building_name | TEXT | No | None | NOT NULL | Name of the building. |
| floor | TEXT | Yes | NULL | None | Floor number or label. Nullable for outdoor or building-wide locations. |
| room | TEXT | Yes | NULL | None | Room number or name. Nullable for hallways or outdoor areas. |
| description | TEXT | Yes | NULL | None | Additional free-text location details. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether available for new reports. Inactive locations remain for FK integrity. |

Note (PD-D10 RECOMMENDED): UNIQUE constraint on (building_name, floor, room) not yet added.
Note (PD-D1 RECOMMENDED): Single-table design retained; split not yet decided.

---

## Table: reports

Purpose: Central table recording the full lifecycle of each maintenance and incident report.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the report. |
| report_number | TEXT | No | None (set by T2) | NOT NULL UNIQUE | Human-readable report identifier. APPROVED (PD-D4): format RPT-000001, generated by PostgreSQL sequence via trigger T2. Concurrency-safe: sequence nextval() returns unique values under concurrent inserts. Immutable after creation. |
| title | TEXT | No | None | NOT NULL | Brief one-line summary of the maintenance issue. |
| description | TEXT | No | None | NOT NULL | Detailed description of the problem. |
| category_id | UUID | No | None | NOT NULL, FK -> categories(id) RESTRICT | The maintenance category. Must reference an active category at submission time (application-enforced). |
| location_id | UUID | No | None | NOT NULL, FK -> locations(id) RESTRICT | The campus location. Must reference an active location at submission time. |
| reporter_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who submitted this report. Used in PD-R4 self-verification check and PD-W2 cancellation authorization. |
| status | report_status | No | submitted | NOT NULL DEFAULT submitted | Current lifecycle position. Transition rules enforced by application and RLS. |
| is_urgent_hazard | BOOLEAN | No | false | NOT NULL DEFAULT false | Set by the reporter to indicate an urgent safety hazard (D3). Independent of confirmed_priority. |
| confirmed_priority | priority_level | Yes | NULL | None | Coordinator-confirmed priority (D3). NULL until explicitly set by coordinator. Nullable distinguishes unreviewed from reviewed-and-low-priority. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the report was submitted. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When last modified. Updated by trigger T1. |

---

## Table: report_attachments

Purpose: Metadata for optional photo attachments. File content in Supabase Storage (private bucket).
APPROVED (PD-D5, 2026-10-18): Max 5 per report, 10 MB per file, JPEG/PNG/WebP only.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the attachment record. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report this attachment belongs to. |
| file_path | TEXT | No | None | NOT NULL | Storage path within the Supabase Storage bucket. Generated server-side. |
| file_name | TEXT | No | None | NOT NULL | Original filename as provided by the user. Sanitized before use in storage paths. |
| file_size | INTEGER | No | None | NOT NULL, CHECK (file_size > 0 AND file_size <= 10485760) | File size in bytes. CHECK constraint is a defense-in-depth layer; actual byte count verified server-side before upload. Maximum: 10,485,760 bytes (10 MB). |
| mime_type | TEXT | No | None | NOT NULL, CHECK (mime_type IN ('image/jpeg','image/png','image/webp')) | MIME type. CHECK constraint is a defense-in-depth layer. MIME type determined from file content (magic bytes) server-side, not from filename extension or browser-supplied Content-Type header. |
| uploaded_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who uploaded this file. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the file was uploaded. |

Validation layers (per APPROVED PD-D5):
- Client-side: UX-only pre-check. Not a security boundary.
- Server-side: Enforces count <= 5, size <= 10 MB from actual bytes, MIME from magic bytes.
- Supabase Storage policy: bucket-level size and MIME enforcement (defense-in-depth).
- Database constraints: chk_file_size and chk_mime_type (defense-in-depth).
- Per-report count limit enforced server-side before INSERT; not expressible as a row CHECK.

Note (PD-D2 RECOMMENDED): mutability not decided. UPDATE and DELETE currently DENY.

---

## Table: report_status_history

Purpose: Append-only audit trail of all status transitions for every report.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this history entry. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report whose status changed. |
| previous_status | report_status | Yes | NULL | None | Status before the transition. NULL for the initial submission entry. |
| new_status | report_status | No | None | NOT NULL | Status after the transition. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who performed the transition. Always equals auth.uid() at time of write. |
| reason | TEXT | Yes | NULL | None | Transition reason. Required by application logic when new_status is on_hold (APPROVED PD-W1), cancelled (APPROVED PD-W2, PD-W3), or reopened. Optional for all other transitions. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the transition occurred. |

---

## Table: report_comments

Purpose: User-authored comments and notes on reports.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the comment. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report this comment belongs to. |
| author_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who wrote this comment. |
| content | TEXT | No | None | NOT NULL | The text body of the comment. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the comment was originally posted. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When last edited. Equal to created_at if never edited. Retained pending PD-D3 decision on comment mutability. |

---

## Table: assignments

Purpose: Links reports to assigned maintenance technicians. All records preserved for audit trail.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this assignment. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report being assigned. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The assigned technician. Must have role = technician (application-enforced). |
| assigned_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The coordinator who made the assignment. Must have role = coordinator (application-enforced). |
| status | assignment_status | No | assigned | NOT NULL DEFAULT assigned | Current state. Previous assignments are marked reassigned, not deleted. Marked cancelled when parent report is cancelled (APPROVED PD-W3). |
| assigned_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this assignment was created. |
| started_at | TIMESTAMPTZ | Yes | NULL | None | When the technician transitioned to in_progress. |
| completed_at | TIMESTAMPTZ | Yes | NULL | None | When the technician marked the repair complete. |
| notes | TEXT | Yes | NULL | None | Optional coordinator notes to the technician. |

---

## Table: work_logs

Purpose: Append-only records of technician work sessions.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this work log entry. |
| assignment_id | UUID | No | None | NOT NULL, FK -> assignments(id) ON DELETE CASCADE | The assignment this work log belongs to. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The technician who performed this work. Must match assignment.technician_id (application-enforced). |
| description | TEXT | No | None | NOT NULL | Description of the work performed during this session. |
| hours_spent | DECIMAL(5,2) | Yes | NULL | None | Hours spent. Optional. Supports up to 999.99 hours. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this log entry was created. |

---

## Table: verifications

Purpose: Coordinator verification decisions on completed repairs. One record per attempt.
APPROVED (PD-R4, 2026-10-18): Self-verification (verified_by = reporter_id) prohibited.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this verification record. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report being verified. |
| verified_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The coordinator who performed the verification. Must satisfy two prohibitions: (1) must not be the technician who performed the work (D2); (2) must not be the original submitter of the report, i.e., verified_by != reports.reporter_id (APPROVED PD-R4). Both enforced at RLS and application levels. |
| is_satisfactory | BOOLEAN | No | None | NOT NULL | Whether the repair passed verification. true triggers completed to verified. false triggers completed to reopened. |
| notes | TEXT | Yes | NULL | None | Verification notes. Explanation required when is_satisfactory = false. |
| verified_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the verification was performed. |

---

## Table: notifications

Purpose: In-app notification records for all system events (D7).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this notification. |
| recipient_id | UUID | No | None | NOT NULL, FK -> profiles(id) ON DELETE CASCADE | The user receiving this notification. |
| type | notification_type | No | None | NOT NULL | The category of event that triggered this notification. |
| title | TEXT | No | None | NOT NULL | Short notification title. |
| message | TEXT | No | None | NOT NULL | Full notification body text. |
| report_id | UUID | Yes | NULL | FK -> reports(id) ON DELETE SET NULL | Associated report. NULL if not related to a specific report. ON DELETE SET NULL preserves notification history if report is deleted. |
| is_read | BOOLEAN | No | false | NOT NULL DEFAULT false | Whether the recipient has read this notification. Only this column is updatable after creation. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this notification was created. |

---

*Phase 3B update 2026-10-18. See SCHEMA_PROPOSAL.md for table definitions.*
*See OPEN_DECISIONS.md for all unresolved decisions.*
*See RLS_POLICY_PROPOSAL.md for access control policies.*
