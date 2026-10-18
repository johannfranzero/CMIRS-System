# CMIRS - Data Dictionary

> **Status: PROPOSAL - Updated Phase 3D (2026-10-18). Not implemented.**
> Reflects all owner-approved decisions through Phase 3D.
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

Phase 3B, 3C, and 3D changes are noted inline.

---

## Enums

### user_role

| Value | Description |
|---|---|
| student_personnel | Default role assigned at registration. Primary reporters. Least operational permissions. |
| coordinator | Maintenance Coordinator. Reviews, assigns, verifies. Cannot verify own submitted reports (APPROVED PD-R4). |
| technician | Maintenance Technician. Performs repairs. Sees only qualifying assigned reports (APPROVED PD-R1). May decline assignments with a required reason (APPROVED PD-R2, OD-NEW-3). May submit reports (APPROVED PD-R6). |
| administrator | School Administrator. Manages user accounts and role assignments. No operational maintenance actions. May submit reports (APPROVED PD-R6). |
| management | School Management. Read-only oversight. May submit reports (APPROVED PD-R6). |

### report_status

| Value | Terminal | Description |
|---|---|---|
| submitted | No | Initial state. Awaiting coordinator review. Reporter or coordinator may cancel (APPROVED PD-W2). |
| under_review | No | Coordinator reviewing and assessing priority. Reporter or coordinator may cancel (APPROVED PD-W2). |
| assigned | No | Assigned to technician. Work not started. Coordinator may cancel (PD-W3). Technician may decline from this state (PD-R2). |
| in_progress | No | Technician actively working. Technician or coordinator may initiate hold (PD-W1). Coordinator may cancel (PD-W3). |
| on_hold | No | Work paused. Reason required. Technician or coordinator may resume (PD-W1). Coordinator may cancel (PD-W3). |
| completed | No | Technician finished. Awaiting coordinator verification. Coordinator may cancel (PD-W3). |
| verified | Yes | Coordinator verified repair satisfactory. Report closed. |
| reopened | No | Verification failed. Report returned for additional work. Coordinator may cancel (PD-W3). |
| cancelled | Yes | Cancelled. Reason always required. No further transitions. |

### priority_level

| Value | Description | Expected Response |
|---|---|---|
| low | Minor cosmetic or non-urgent issue. | Scheduled maintenance window. |
| medium | Functional issue affecting usability. | Addressed within normal workflow. |
| high | Significant issue affecting safety or operations. | Prioritized for prompt attention. |
| critical | Immediate safety hazard requiring urgent response. | Expedited per WORKFLOW.md. |

### assignment_status

| Value | Active | Qualifies for Technician Visibility | Description |
|---|---|---|---|
| assigned | Yes | Yes | Technician assigned. Work not yet started. |
| in_progress | Yes | Yes | Technician actively working. |
| on_hold | Yes | Yes | Work paused (APPROVED PD-W1). |
| completed | No | Yes | Work finished. Historical access preserved for own work_logs. |
| reassigned | No | Yes | Superseded by new assignment. Historical access preserved (APPROVED OD-NEW-4). |
| cancelled | No (terminal) | Yes | Cancelled with parent report (APPROVED PD-W4). Historical access preserved. |
| declined | No (terminal) | No | Technician declined before starting (APPROVED PD-R2, OD-NEW-4). decline_reason required. No work_logs. Excluded from visibility. |

Active statuses (assigned, in_progress, on_hold) may receive work_logs and status updates.
Non-active statuses block further work_logs and status updates.
Declined and cancelled are terminal for the assignment record.

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
| report_reassigned | Report reassigned. Sent to both technicians and coordinator. |
| report_cancelled | Report cancelled. Sent to all parties including affected technicians. |

Note: assignment_declined notification type not yet formally approved.

---

## Table: profiles

Purpose: Extends auth.users with application-specific data.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | None | PK, references auth.users(id) ON DELETE CASCADE | User identifier from Supabase Auth. Set by T4. |
| email | TEXT | No | None | NOT NULL | User email address. |
| full_name | TEXT | No | None | NOT NULL | User display name. |
| role | user_role | No | student_personnel | NOT NULL DEFAULT student_personnel | Operational role (D1). Only administrator may change. |
| phone | TEXT | Yes | NULL | None | Optional phone number. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Active account flag. Soft-deactivation (PD-D8 OPEN). |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Account creation timestamp. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Last modification. Updated by T1. |

---

## Table: role_change_audit

Purpose: Append-only audit log. APPROVED (OD-NEW-1).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Audit record identifier. |
| user_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | User whose role changed. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | Administrator who changed the role. |
| old_role | user_role | No | None | NOT NULL | Role before change. |
| new_role | user_role | No | None | NOT NULL | Role after change. |
| reason | TEXT | Yes | NULL | None | Optional justification. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When change was recorded. |

Check: old_role <> new_role. Append-only.

---

## Table: categories

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Category identifier. |
| name | TEXT | No | None | NOT NULL UNIQUE | Unique category name. |
| description | TEXT | Yes | NULL | None | Optional description. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Available for new reports. Soft-delete. |

---

## Table: locations

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Location identifier. |
| building_name | TEXT | No | None | NOT NULL | Building name. |
| floor | TEXT | Yes | NULL | None | Floor number or description. |
| room | TEXT | Yes | NULL | None | Room number or name. |
| description | TEXT | Yes | NULL | None | Additional location details. |
| is_active | BOOLEAN | No | true | NOT NULL DEFAULT true | Available for new reports. Soft-delete. |

---

## Table: reports

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Report identifier. |
| report_number | TEXT | No | None | NOT NULL UNIQUE | Generated by T2 as RPT-000001 (APPROVED PD-D4). Immutable. |
| title | TEXT | No | None | NOT NULL | Brief issue summary. |
| description | TEXT | No | None | NOT NULL | Detailed description. |
| category_id | UUID | No | None | NOT NULL, FK -> categories(id) RESTRICT | Maintenance category. |
| location_id | UUID | No | None | NOT NULL, FK -> locations(id) RESTRICT | Issue location. |
| reporter_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | User who submitted the report. Set to auth.uid() at INSERT. Any authenticated role may submit (APPROVED PD-R6). Used in PD-R4 self-verification check and PD-W2 cancellation. |
| status | report_status | No | submitted | NOT NULL DEFAULT submitted | Current lifecycle status. |
| is_urgent_hazard | BOOLEAN | No | false | NOT NULL DEFAULT false | Reporter urgent-hazard flag (D3). |
| confirmed_priority | priority_level | Yes | NULL | None | Coordinator-confirmed priority. NULL until set (RECOMMENDED PD-D7). |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Report creation timestamp. |
| updated_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Last modification. Updated by T1. |

---

## Table: report_attachments

Purpose: File metadata for optional photo attachments. APPROVED (PD-D2, PD-D5, OD-NEW-2).
Soft deletion via deleted_at/deleted_by (APPROVED OD-NEW-2).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Attachment identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | Associated report. |
| file_path | TEXT | No | None | NOT NULL | Path in Supabase Storage. Preserved in soft-deleted rows for Storage retry. |
| file_name | TEXT | No | None | NOT NULL | Original filename (sanitized server-side). |
| file_size | INTEGER | No | None | NOT NULL, CHECK (file_size > 0 AND file_size <= 10485760) | File size in bytes. Max 10 MB (APPROVED PD-D5). |
| mime_type | TEXT | No | None | NOT NULL, CHECK (mime_type IN ('image/jpeg','image/png','image/webp')) | MIME type. Magic-byte verified server-side (APPROVED PD-D5). |
| uploaded_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | User who uploaded. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Upload timestamp. |
| deleted_at | TIMESTAMPTZ | Yes | NULL | None | Soft-delete timestamp. NULL = active. NOT NULL = soft-deleted (APPROVED OD-NEW-2). Set by coordinator via SECURITY DEFINER RPC. Immutable once set (RLS prevents UPDATE on deleted rows). |
| deleted_by | UUID | Yes | NULL | FK -> profiles(id) RESTRICT | Coordinator who initiated soft deletion. NULL if active (APPROVED OD-NEW-2). Set alongside deleted_at. Immutable once set. FK ON DELETE RESTRICT preserves audit trail even if coordinator profile is deactivated. |

Key notes:
- Active attachments: deleted_at IS NULL.
- Soft-deleted attachments: deleted_at IS NOT NULL. Retained indefinitely for audit.
- File metadata (file_path through created_at) is immutable after upload. UPDATE is DENY
  for all roles on these columns (APPROVED PD-D2).
- Soft deletion is performed via a SECURITY DEFINER RPC that validates role and current state.
- Per-report active count: COUNT WHERE report_id = $1 AND deleted_at IS NULL <= 5 (PD-D5).
- Soft-deleted attachments visible to coordinator, administrator, management for audit.
  Hidden from student_personnel and technicians (SELECT WHERE deleted_at IS NULL).
- Open question: no deletion reason is recorded. A separate decision is needed if
  a justification field is required for audit compliance.

---

## Table: report_status_history

Purpose: Append-only audit trail of every status transition.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | History entry identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | Associated report. |
| previous_status | report_status | Yes | NULL | None | Status before transition. NULL for initial submission. |
| new_status | report_status | No | None | NOT NULL | Status after transition. |
| changed_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | User who performed the transition. |
| reason | TEXT | Yes | NULL | None | Required for on_hold, cancelled, reopened. Optional otherwise. Application-enforced. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | Transition timestamp. |

Append-only. No UPDATE or DELETE permitted.

---

## Table: report_comments

Purpose: User-authored comments. IMMUTABLE after creation (APPROVED PD-D3).

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Comment identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | Associated report. |
| author_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | User who wrote the comment. |
| content | TEXT | No | None | NOT NULL | Comment text. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When comment was created. |

updated_at REMOVED (APPROVED PD-D3). T1 does NOT apply. UPDATE/DELETE DENY for all roles.

---

## Table: assignments

Purpose: Links reports to assigned technicians. All records retained for audit trail.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Assignment identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | Associated report. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | Assigned technician (role = technician, app-enforced). |
| assigned_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | Coordinator who made assignment (role = coordinator, app-enforced). |
| status | assignment_status | No | assigned | NOT NULL DEFAULT assigned | Current status. Active (assigned, in_progress, on_hold) may receive work_logs. Non-active (completed, reassigned, cancelled, declined) are blocked. Declined and cancelled are terminal. When report is cancelled, active assignments (assigned, in_progress, on_hold) are marked cancelled atomically (APPROVED PD-W4). |
| assigned_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When assignment was created. |
| started_at | TIMESTAMPTZ | Yes | NULL | None | When technician transitioned to in_progress. |
| completed_at | TIMESTAMPTZ | Yes | NULL | None | When technician marked work complete. |
| notes | TEXT | Yes | NULL | None | Assignment notes from coordinator to technician. Not for decline reason. |
| decline_reason | TEXT | Yes | NULL | CHECK (status != 'declined' OR decline_reason IS NOT NULL) | Technician's reason for declining this assignment (APPROVED OD-NEW-3). Required (non-null, non-empty) when status = declined. NULL for all other statuses. Set atomically with status change to declined. Immutable once status = declined (terminal). Application enforces non-empty string. An assignment can be declined at most once (declined is terminal); a single field is sufficient. |

---

## Table: work_logs

Purpose: Append-only records of technician work sessions.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Work log identifier. |
| assignment_id | UUID | No | None | NOT NULL, FK -> assignments(id) ON DELETE CASCADE | Associated assignment. |
| technician_id | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | Technician who performed this work. Must match assignment.technician_id (app-enforced). INSERT blocked when assignment.status IN ('cancelled', 'declined') (APPROVED PD-W4, PD-R2, OD-NEW-3). |
| description | TEXT | No | None | NOT NULL | Description of work performed. |
| hours_spent | DECIMAL(5,2) | Yes | NULL | None | Hours spent. Optional. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When log was created. |

---

## Table: verifications

Purpose: Coordinator verification decisions on completed repairs.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Verification identifier. |
| report_id | UUID | No | None | NOT NULL, FK -> reports(id) ON DELETE CASCADE | Associated report. |
| verified_by | UUID | No | None | NOT NULL, FK -> profiles(id) RESTRICT | Coordinator who performed verification. Must have role = coordinator (app-enforced). Must NOT be the assignment's performing technician (D2). Must NOT equal reports.reporter_id (APPROVED PD-R4). |
| is_satisfactory | BOOLEAN | No | None | NOT NULL | Whether repair passed verification. |
| notes | TEXT | Yes | NULL | None | Verification notes or rejection reason. |
| verified_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When verification was performed. |

Append-only.

---

## Table: notifications

Purpose: In-app notifications (D7). MVP only.

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| id | UUID | No | gen_random_uuid() | PK DEFAULT gen_random_uuid() | Notification identifier. |
| recipient_id | UUID | No | None | NOT NULL, FK -> profiles(id) ON DELETE CASCADE | User receiving notification. |
| type | notification_type | No | None | NOT NULL | Notification category. |
| title | TEXT | No | None | NOT NULL | Notification title. |
| message | TEXT | No | None | NOT NULL | Notification body text. |
| report_id | UUID | Yes | NULL | FK -> reports(id) ON DELETE SET NULL | Associated report. Nullable. |
| is_read | BOOLEAN | No | false | NOT NULL DEFAULT false | Whether recipient has read notification. |
| created_at | TIMESTAMPTZ | No | now() | NOT NULL DEFAULT now() | When notification was created. |

Only is_read updatable by recipient. All other columns immutable.

---

*Phase 3D update 2026-10-18. All schema decisions are now owner-approved.*
*See OPEN_DECISIONS.md for all decisions.*
*See SCHEMA_PROPOSAL.md for table structure.*
*See RLS_POLICY_PROPOSAL.md for access control policies.*
