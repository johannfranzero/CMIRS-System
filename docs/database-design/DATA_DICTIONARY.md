# CMIRS - Data Dictionary

> **Status: PROPOSAL - Not approved. Not implemented.**
> Phase 3A database planning. Column-level definitions for all proposed tables.

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

This data dictionary defines every column in every proposed CMIRS table. For each column it specifies:
- Name: the snake_case column identifier
- Type: the PostgreSQL data type
- Nullable: whether the column can be NULL
- Default: the default value if any
- Constraints: key constraints (PK, FK, UNIQUE, CHECK, NOT NULL)
- Description: semantic meaning and usage notes

---

## Enums

### user_role

| Value | Description |
|---|---|
| student_personnel | Default role assigned at registration. Represents any student or school staff member who reports issues. Has the least operational permissions. |
| coordinator | Maintenance Coordinator. Reviews, assigns, and verifies reports. Central operational role. |
| technician | Maintenance Technician. Performs repairs and logs work. Can only interact with assigned reports. |
| administrator | School Administrator. Manages user accounts and role assignments. Cannot perform operational actions. |
| management | School Management. Read-only visibility into system operations and reports. |

### report_status

| Value | Terminal | Description |
|---|---|---|
| submitted | No | Initial state when a report is created. Awaiting coordinator review. |
| under_review | No | Coordinator is actively reviewing the report and assessing priority. |
| assigned | No | Coordinator has assigned the report to a technician. Work has not started. |
| in_progress | No | Assigned technician is actively working on the repair. |
| on_hold | No | Work is temporarily paused. Requires a reason. |
| completed | No | Technician has finished the repair. Awaiting coordinator verification. |
| verified | Yes | Coordinator verified the repair is satisfactory. Report closed. |
| reopened | No | Verification failed. Report returned for additional work. |
| cancelled | Yes | Report cancelled. No further transitions permitted. Requires a reason. |

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
| cancelled | Assignment cancelled because the report was cancelled or reassigned. |

Note: accepted and declined are not included pending decision PD-R2.

### notification_type

| Value | Description |
|---|---|
| report_submitted | A new report was submitted. Sent to coordinators. |
| report_assigned | A report was assigned to a technician. Sent to assigned technician. |
| status_changed | A report status was updated. Sent to reporter and assigned technician. |
| priority_changed | A report confirmed_priority was changed. Sent to reporter and assigned technician. |
| comment_added | A comment was added to a report. Sent to reporter, assigned technician, and relevant coordinator. |
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
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether the account is active. Inactive accounts (is_active = false) cannot log in or perform actions. Used for soft-deactivation. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Timestamp of when the profile was created (on Supabase Auth signup). |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Timestamp of the last modification to this profile. Updated automatically by trigger T1. |

---

## Table: role_change_audit

Purpose: Append-only audit log for all role assignments and changes.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this audit record. |
| user_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user whose role was changed. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The administrator who performed the role change. Must have role = administrator. |
| old_role | user_role | No | None | NOT NULL | The role before the change. |
| new_role | user_role | No | None | NOT NULL | The role after the change. Must differ from old_role (CHECK constraint). |
| reason | TEXT | Yes | NULL | None | Optional reason or notes for the role change. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the role change was made. |

---

## Table: categories

Purpose: Predefined maintenance issue categories for classifying reports.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the category. |
| name | TEXT | No | None | NOT NULL UNIQUE | The category name displayed to users (e.g., Plumbing, Electrical, Structural). Must be unique. |
| description | TEXT | Yes | NULL | None | Optional longer description of what issues belong in this category. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether this category is available for new report submissions. Inactive categories remain in the database for FK integrity on historical reports. |

---

## Table: locations

Purpose: Campus locations where maintenance issues can occur.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the location. |
| building_name | TEXT | No | None | NOT NULL | Name of the building (e.g., Main Building, Science Hall). |
| floor | TEXT | Yes | NULL | None | Floor number or label (e.g., 1, Ground Floor, Basement). Nullable for outdoor locations. |
| room | TEXT | Yes | NULL | None | Room number or name (e.g., 201, Gymnasium, Cafeteria). Nullable for hallways or outdoor areas. |
| description | TEXT | Yes | NULL | None | Additional free-text location details (e.g., near the north staircase). |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Whether this location is available for new report submissions. Inactive locations remain for FK integrity. |

---

## Table: reports

Purpose: Central table recording the full lifecycle of each maintenance and incident report.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the report. |
| report_number | TEXT | No | None (generated by T2) | NOT NULL UNIQUE | Human-readable report identifier generated by trigger T2 (e.g., RPT-000001). Used in verbal communication and printed records. Format pending PD-D4. |
| title | TEXT | No | None | NOT NULL | Brief one-line summary of the maintenance issue. |
| description | TEXT | No | None | NOT NULL | Detailed description of the problem, including relevant observations. |
| category_id | UUID | No | None | NOT NULL, FK -> categories(id) RESTRICT | The maintenance category that best describes this issue. Must reference an active category at submission time (enforced by application). |
| location_id | UUID | No | None | NOT NULL, FK -> locations(id) RESTRICT | The campus location where the issue is occurring. Must reference an active location at submission time. |
| reporter_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who submitted this report. |
| status | report_status | No | submitted | NOT NULL DEFAULT submitted | Current position in the report lifecycle. Valid transitions are defined in WORKFLOW.md Status Transition Table. |
| is_urgent_hazard | BOOLEAN | No | false | NOT NULL DEFAULT false | Set by the reporter to indicate they believe this is an urgent safety hazard (D3). This is independent of confirmed_priority. Setting this flag alerts coordinators for expedited review but does not automatically set the priority. |
| confirmed_priority | priority_level | Yes | NULL | None | The coordinator-confirmed priority level (D3). NULL until a coordinator explicitly sets it during review. Nullable is intentional to distinguish unreviewed reports from those reviewed and assigned low priority. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the report was submitted. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the report was last modified. Updated automatically by trigger T1. |

---

## Table: report_attachments

Purpose: Metadata for optional photo attachments. File content is in Supabase Storage.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for the attachment record. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report this attachment belongs to. Deleting a report cascades to delete its attachment records. |
| file_path | TEXT | No | None | NOT NULL | The storage path within the Supabase Storage bucket (e.g., report-attachments/{report_id}/{attachment_id}_{filename}). Generated server-side. |
| file_name | TEXT | No | None | NOT NULL | The original filename as provided by the user. Sanitized before use in storage paths. |
| file_size | INTEGER | No | None | NOT NULL | File size in bytes. Used for display and validation purposes. |
| mime_type | TEXT | No | None | NOT NULL, CHECK (mime_type IN image/jpeg, image/png, image/webp) | The MIME type of the file. Limited to accepted image types per SECURITY.md. Verified from file content, not extension. |
| uploaded_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who uploaded this file. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the file was uploaded. |

---

## Table: report_status_history

Purpose: Append-only audit trail of all status transitions for every report.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this history entry. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report whose status changed. |
| previous_status | report_status | Yes | NULL | None | The status before the transition. NULL for the initial submission entry (the report did not have a previous status). |
| new_status | report_status | No | None | NOT NULL | The status after the transition. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The user who performed the transition. Populated from auth.uid() by application logic. |
| reason | TEXT | Yes | NULL | None | Explanation for the transition. Required when transitioning to on_hold, cancelled, or reopened. Optional for all other transitions. Enforcement is at the application level. |
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
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the comment was last edited. Equal to created_at if never edited. Pending PD-D3: if edits are not permitted, this column may be removed. |

---

## Table: assignments

Purpose: Links reports to assigned maintenance technicians. Preserves all assignment records for audit.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this assignment record. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report being assigned. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The technician assigned to this report. Must reference a profile with role = technician. Enforced at application level. |
| assigned_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The coordinator who made this assignment. Must reference a profile with role = coordinator. Enforced at application level. |
| status | assignment_status | No | assigned | NOT NULL DEFAULT assigned | Current state of this assignment record. Previous assignments on reassignment are marked reassigned, not deleted. |
| assigned_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this assignment was created by the coordinator. |
| started_at | TIMESTAMPTZ | Yes | NULL | None | When the technician transitioned this report to in_progress. Set by the application when the technician begins work. |
| completed_at | TIMESTAMPTZ | Yes | NULL | None | When the technician marked the repair complete. Set by the application on the in_progress to completed transition. |
| notes | TEXT | Yes | NULL | None | Optional notes from the coordinator to the technician about this assignment. |

---

## Table: work_logs

Purpose: Append-only records of work sessions performed by technicians.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this work log entry. |
| assignment_id | UUID | No | None | NOT NULL, FK -> assignments(id) ON DELETE CASCADE | The assignment this work log belongs to. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The technician who performed this work. Must match the technician_id of the referenced assignment. Enforced at application level. |
| description | TEXT | No | None | NOT NULL | Description of the work performed during this session. |
| hours_spent | DECIMAL(5,2) | Yes | NULL | None | Hours spent on this work session. Optional. Supports values up to 999.99 hours. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this log entry was created. |

---

## Table: verifications

Purpose: Records coordinator verification decisions on completed repairs.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this verification record. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | The report being verified. |
| verified_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | The coordinator who performed the verification. Must have role = coordinator. Must not be the technician who performed the work (D2). |
| is_satisfactory | BOOLEAN | No | None | NOT NULL | Whether the repair passed verification. true triggers the completed to verified transition. false triggers completed to reopened. |
| notes | TEXT | Yes | NULL | None | Verification notes or explanation of what was unsatisfactory if is_satisfactory = false. |
| verified_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When the verification was performed. |

---

## Table: notifications

Purpose: In-app notification records for all system events (D7).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Unique identifier for this notification. |
| recipient_id | UUID | No | None | NOT NULL, FK -> profiles(id) ON DELETE CASCADE | The user who should receive this notification. Deleting a profile cascades to delete their notifications. |
| type | notification_type | No | None | NOT NULL | The category of event that triggered this notification. Determines the icon and styling in the UI. |
| title | TEXT | No | None | NOT NULL | Short notification title displayed in the notification list. |
| message | TEXT | No | None | NOT NULL | The full notification body text. |
| report_id | UUID | Yes | NULL | FK -> reports(id) ON DELETE SET NULL | The report associated with this notification. NULL if the notification is not related to a specific report. ON DELETE SET NULL preserves notification history if the report is later deleted. |
| is_read | BOOLEAN | No | false | NOT NULL DEFAULT false | Whether the recipient has read this notification. The only updatable column after creation. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When this notification was created. |

---

*Phase 3A database planning. See SCHEMA_PROPOSAL.md for full table definitions.*
*See OPEN_DECISIONS.md for unresolved decisions.*
*See RLS_POLICY_PROPOSAL.md for access control policies.*
