# CMIRS - Schema Proposal

> **Status: PROPOSAL - Updated Phase 3D (2026-10-18). Not approved for migration.**
> Reflects all owner-approved decisions through Phase 3D.
> Do not execute SQL. Do not apply migrations.

## Table of Contents

- [Purpose and Scope](#purpose-and-scope)
- [Authoritative Sources](#authoritative-sources)
- [Confirmed Requirements](#confirmed-requirements)
- [Phase 3B, 3C, and 3D Decisions Applied](#phase-3b-3c-and-3d-decisions-applied)
- [Proposed Enums](#proposed-enums)
- [Proposed Tables](#proposed-tables)
- [Relationships and Cardinalities](#relationships-and-cardinalities)
- [Status Transition Map](#status-transition-map)
- [Proposed Triggers](#proposed-triggers)
- [Timestamp Conventions](#timestamp-conventions)
- [Database Integrity Rules](#database-integrity-rules)
- [Deviations from DATABASE.md](#deviations-from-databasemd)
- [Open Items Requiring Owner Decision](#open-items-requiring-owner-decision)

---

## Purpose and Scope

Complete PostgreSQL schema proposal for CMIRS. Grounded in Phase 0 documentation:

- docs/DATABASE.md - primary schema reference
- docs/ROLES.md - role definitions and permission matrix
- docs/WORKFLOW.md - lifecycle, status transitions, notifications
- docs/SECURITY.md - security principles, RLS overview, audit requirements
- README.md - confirmed decisions D1-D8
- docs/database-design/OPEN_DECISIONS.md - all owner-approved decisions through Phase 3D

**No tables, enums, triggers, functions, or RLS policies have been created. Planning only.**

---

## Authoritative Sources

Confirmed decisions from README.md treated as hard requirements:

| ID | Decision |
|---|---|
| D1 | New users receive student_personnel default role. Administrator assigns actual role. |
| D2 | Designated Coordinator verifies completed repairs. Performing technician cannot verify own work. |
| D3 | Reporters flag urgent hazards. Coordinator confirms/adjusts priority independently. |
| D4 | Photo attachments optional. Zero attachments is a valid report. |
| D5 | Supabase project exists ref xyirfifvcntuzceivtho. No actions in this phase. |
| D6 | GitHub repository exists at johannfranzero/CMIRS-System. |
| D7 | In-app notifications only for MVP. Email/SMS/push out of scope. |
| D8 | main is primary branch. Feature branches for development. |

---

## Confirmed Requirements

1. User profiles linked to auth.users via same UUID (Supabase Auth pattern).
2. Default role is student_personnel. Only administrator can change roles.
3. Reports have two independent priority fields: is_urgent_hazard (boolean, reporter-set) and confirmed_priority (enum, coordinator-set, nullable until reviewed).
4. All status transitions recorded in report_status_history (append-only).
5. Assignments never deleted on reassignment — previous records marked reassigned.
6. Verifications stored per attempt. Multiple records per report on reopen cycles.
7. Work logs are append-only.
8. Notifications are in-app only. notifications table stores all records.
9. Audit tables (report_status_history, verifications, work_logs, role_change_audit) are append-only.
10. Photo attachments in Supabase Storage (private bucket). Database stores metadata and path only.
11. Categories and locations use soft-deactivation (is_active = false).
12. Referential integrity enforced via foreign keys at database level.
13. All timestamps use TIMESTAMPTZ stored in UTC.
14. All primary keys use UUID.
15. All identifiers use snake_case.

---

## Phase 3B, 3C, 3D, and 3F Decisions Applied

| Decision | Change Applied |
|---|---|
| OD-NEW-1 APPROVED | role_change_audit table included |
| OD-NEW-2 APPROVED | report_attachments: deleted_at and deleted_by columns added for soft deletion; hard DELETE DENY all |
| OD-NEW-3 APPROVED | assignments: decline_reason TEXT added; required on decline |
| OD-NEW-4 APPROVED | Technician visibility predicate confirmed: any assignment with status != 'declined' |
| OD-REC-1 APPROVED | assignments.decline_reason: check constraint rejects NULL, empty, and whitespace via btrim() |
| OD-REC-2 APPROVED | report_comments: SELECT permitted for administrator and management roles |
| OD-REC-3 APPROVED | Supabase Storage: report-attachments private bucket and storage.objects RLS design documented |
| PD-D2 APPROVED | report_attachments immutable after upload; soft-delete via SECURITY DEFINER RPC |
| PD-D3 APPROVED | report_comments: updated_at removed; T1 no longer on report_comments; UPDATE/DELETE DENY all |
| PD-D4 APPROVED | T2 trigger: RPT-000001 via PostgreSQL SEQUENCE, concurrency-safe |
| PD-D5 APPROVED | report_attachments: chk_file_size and chk_mime_type constraints; count applies to active only |
| PD-R1 APPROVED | Technician SELECT scope: qualifying (non-declined) assignment record |
| PD-R2 APPROVED | assignment_status enum: declined value added; decline_reason column required |
| PD-R4 APPROVED | verifications: verified_by != reports.reporter_id |
| PD-R6 APPROVED | reports INSERT: all five authenticated roles may submit |
| PD-W1 APPROVED | in_progress <-> on_hold: Technician or Coordinator |
| PD-W2 APPROVED | submitted/under_review to cancelled by Reporter or Coordinator |
| PD-W3 APPROVED | any non-terminal to cancelled by Coordinator |
| PD-W4 APPROVED | On report cancellation: active assignments (assigned, in_progress, on_hold) marked cancelled atomically |

---

## Proposed Enums

### user_role

Values: student_personnel (default), coordinator, technician, administrator, management.

| Value | Description |
|---|---|
| student_personnel | Default role. Primary reporters. |
| coordinator | Triages, assigns, verifies. Cannot verify own submitted reports (PD-R4). |
| technician | Performs repairs, logs work. Sees only assigned reports (PD-R1). May decline assignments (PD-R2). May submit reports (PD-R6). |
| administrator | Manages user accounts and roles. May submit reports (PD-R6). |
| management | Read-only oversight. May submit reports (PD-R6). |

### report_status

Values: submitted, under_review, assigned, in_progress, on_hold, completed, verified, reopened, cancelled.

Terminal states: verified, cancelled. No transitions from these states.

### priority_level

Values: low, medium, high, critical.

### assignment_status

Values: assigned, in_progress, on_hold, completed, reassigned, cancelled, declined.

| Value | Active | Qualifies for Technician Visibility | Description |
|---|---|---|---|
| assigned | Yes | Yes | Technician has been assigned. Work not yet started. |
| in_progress | Yes | Yes | Technician is actively working. |
| on_hold | Yes | Yes | Work temporarily paused (APPROVED PD-W1). |
| completed | No | Yes | Technician finished the work. Access to own work logs preserved. |
| reassigned | No | Yes | Superseded by new assignment. Historical access preserved (APPROVED OD-NEW-4). |
| cancelled | No (terminal) | Yes | Cancelled when parent report cancelled (APPROVED PD-W4). Historical access preserved. |
| declined | No (terminal) | No | Technician declined before starting (APPROVED PD-R2, OD-NEW-4). decline_reason required. No work logs. No visibility. |

Active statuses (assigned, in_progress, on_hold) receive work_logs and status updates.
Non-active statuses block work_logs and further status updates.
Declined is terminal for the assignment record; a NEW assignment row is created for reassignment.

### notification_type

Values: report_submitted, report_assigned, status_changed, priority_changed, comment_added,
verification_required, verification_complete, verification_failed, report_reassigned, report_cancelled.

Note: An assignment_declined notification type may be needed to notify coordinators.
Not yet formally approved; document as implementation detail pending decision.

---

## Proposed Tables

### profiles

Purpose: Extends auth.users with application-specific data.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK, references auth.users(id) ON DELETE CASCADE | User ID from Supabase Auth |
| email | TEXT | NOT NULL | User email address |
| full_name | TEXT | NOT NULL | User display name |
| role | user_role | NOT NULL DEFAULT student_personnel | Assigned role (D1) |
| phone | TEXT | | Optional phone number |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Whether account is active |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Account creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Last profile update timestamp |

T1 trigger applied. No direct INSERT by users (T4 only).

---

### role_change_audit

Purpose: Append-only audit log of every role assignment and change.
APPROVED (OD-NEW-1, 2026-10-18).

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Audit record identifier |
| user_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | User whose role changed |
| changed_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | Administrator who made the change |
| old_role | user_role | NOT NULL | Role before change |
| new_role | user_role | NOT NULL | Role after change |
| reason | TEXT | | Optional reason for change |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When change was made |

Check: old_role <> new_role. Append-only.

---

### categories

Purpose: Predefined maintenance issue categories.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Category identifier |
| name | TEXT | NOT NULL UNIQUE | Category name |
| description | TEXT | | Optional description |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Available for new reports |

---

### locations

Purpose: Campus locations. Single-table design (RECOMMENDED PD-D1).

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Location identifier |
| building_name | TEXT | NOT NULL | Building name |
| floor | TEXT | | Floor number or description |
| room | TEXT | | Room number or name |
| description | TEXT | | Additional location details |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Available for new reports |

---

### reports

Purpose: Central entity. Records the full lifecycle of each maintenance and incident report.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Report identifier |
| report_number | TEXT | NOT NULL UNIQUE | Human-readable report number, generated by T2 |
| title | TEXT | NOT NULL | Brief issue summary |
| description | TEXT | NOT NULL | Detailed problem description |
| category_id | UUID | NOT NULL FK -> categories(id) RESTRICT | Type of maintenance issue |
| location_id | UUID | NOT NULL FK -> locations(id) RESTRICT | Where issue is located |
| reporter_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who submitted report. Any authenticated role (PD-R6). Used in PD-R4 and PD-W2 checks. |
| status | report_status | NOT NULL DEFAULT submitted | Current lifecycle status |
| is_urgent_hazard | BOOLEAN | NOT NULL DEFAULT false | Reporter urgent-hazard flag (D3) |
| confirmed_priority | priority_level | | Coordinator-confirmed priority, NULL until reviewed |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Report creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Last modification timestamp |

T1 trigger applied. report_number generated by T2. Immutable report_number.

---

### report_attachments

Purpose: File metadata for optional photo attachments (D4). File content in Supabase Storage.
APPROVED (PD-D2, PD-D5, OD-NEW-2).

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Attachment identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| file_path | TEXT | NOT NULL | Path in Supabase Storage. Preserved in soft-deleted rows for Storage cleanup retry. |
| file_name | TEXT | NOT NULL | Original filename (sanitized) |
| file_size | INTEGER | NOT NULL CHECK (file_size > 0 AND file_size <= 10485760) | File size in bytes, max 10 MB (APPROVED PD-D5) |
| mime_type | TEXT | NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')) | MIME type, magic-byte verified server-side |
| uploaded_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who uploaded the file |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Upload timestamp |
| deleted_at | TIMESTAMPTZ | | Soft-delete timestamp. NULL = active. NOT NULL = soft-deleted (APPROVED OD-NEW-2). Immutable once set. |
| deleted_by | UUID | FK -> profiles(id) RESTRICT | Coordinator who performed soft deletion. NULL if active. Immutable once set. |

Key notes:
- File metadata (file_path, file_name, file_size, mime_type, uploaded_by, created_at) is
  immutable after upload. UPDATE on these columns is DENY for all roles (APPROVED PD-D2).
- Soft deletion (APPROVED OD-NEW-2): implemented as UPDATE setting deleted_at = now()
  and deleted_by = auth.uid(). Hard DELETE is DENY for all roles.
- Soft deletion is implemented via a SECURITY DEFINER RPC that validates the caller is a
  coordinator and the attachment is currently active (deleted_at IS NULL), then sets the
  two deletion columns. No other columns can be modified through this function.
- deleted_at and deleted_by are immutable once set (RLS USING clause prevents UPDATE
  on already-deleted rows: USING deleted_at IS NULL).
- Active attachments = WHERE deleted_at IS NULL.
- Soft-deleted attachments remain in the database for audit. Visible to coordinator,
  administrator, and management. Hidden from student_personnel and technicians.
- Per-report upload count limit (max 5, PD-D5) counts only active attachments:
  WHERE report_id = $1 AND deleted_at IS NULL.
- Storage cleanup: after soft deletion, application attempts to delete the Storage object
  (file_path). Failure does not affect the audit record. Retry is managed by an
  application-level background job (there is no storage_cleanup_completed column in
  the database schema). file_path is preserved in the row for retry purposes.

---

### report_status_history

Purpose: Append-only audit trail of every status transition.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | History entry identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| previous_status | report_status | | Status before transition, NULL for initial submission |
| new_status | report_status | NOT NULL | Status after transition |
| changed_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who performed transition |
| reason | TEXT | | Required for on_hold, cancelled, reopened; optional otherwise |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Transition timestamp |

Append-only. Reason required for on_hold (PD-W1), cancelled (PD-W2, PD-W3), reopened.

---

### report_comments

Purpose: User-authored comments. IMMUTABLE after creation (APPROVED PD-D3).

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Comment identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| author_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who wrote the comment |
| content | TEXT | NOT NULL | Comment text |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Comment creation timestamp |

updated_at REMOVED (APPROVED PD-D3). T1 does NOT apply. UPDATE/DELETE DENY all roles.
Corrections must be follow-up comments.

---

### assignments

Purpose: Links reports to assigned technicians. All records retained for audit trail.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Assignment identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| technician_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | Assigned technician |
| assigned_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | Coordinator who made assignment |
| status | assignment_status | NOT NULL DEFAULT assigned | Current assignment status |
| assigned_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When assignment was made |
| started_at | TIMESTAMPTZ | | When technician started work |
| completed_at | TIMESTAMPTZ | | When technician marked work complete |
| notes | TEXT | | Assignment notes from coordinator to technician |
| decline_reason | TEXT | CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != '')) | Technician's reason for declining (APPROVED OD-NEW-3, OD-REC-1). Required, non-empty, and non-whitespace when status = declined. NULL for all other statuses. Immutable once status = declined (terminal). |

Role constraints (application-enforced):
- technician_id must reference a profile with role = technician.
- assigned_by must reference a profile with role = coordinator.

Decline process (APPROVED PD-R2, OD-NEW-3, OD-REC-1):
1. Technician initiates decline from assigned status only.
2. Operation sets status = 'declined' and decline_reason = '<reason>'.
3. Check constraint ensures decline_reason IS NOT NULL AND btrim(decline_reason) != '' when status = 'declined'
   (database-level check rejecting NULL, empty string, or whitespace-only values directly via btrim).
4. Declined assignment is preserved (not deleted).
5. Coordinator is notified and creates a NEW assignment row for a different technician.
6. An assignment can be declined at most once (terminal status). Single field sufficient.

Reassignment process:
1. Coordinator creates new assignment record for new technician (new row).
2. Previous record status set to reassigned.
3. Both technicians receive notifications.
4. Technician with reassigned record retains report visibility (OD-NEW-4).

Cancellation handling (APPROVED PD-W4):
- Active assignments (assigned, in_progress, on_hold) marked cancelled atomically.
- Non-active (completed, reassigned, cancelled, declined) not modified.
- Transaction must cover: report status update, status history, assignment updates, notifications.

---

### work_logs

Purpose: Append-only records of technician work sessions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Work log identifier |
| assignment_id | UUID | NOT NULL FK -> assignments(id) ON DELETE CASCADE | Associated assignment |
| technician_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | Technician who performed work |
| description | TEXT | NOT NULL | Description of work performed |
| hours_spent | DECIMAL(5,2) | | Hours spent on this session |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When log was created |

Append-only. INSERT blocked for cancelled and declined assignments.

---

### verifications

Purpose: Coordinator verification decisions on completed repairs.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Verification record identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| verified_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | Coordinator who performed verification |
| is_satisfactory | BOOLEAN | NOT NULL | Whether repair passed verification |
| notes | TEXT | | Verification notes or rejection reason |
| verified_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When verification was performed |

- verified_by must have role = coordinator (application-enforced).
- verified_by must NOT be the assignment's performing technician (D2).
- verified_by must NOT be reports.reporter_id (APPROVED PD-R4).
- Append-only.

---

### notifications

Purpose: In-app notification records (D7). MVP only.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Notification identifier |
| recipient_id | UUID | NOT NULL FK -> profiles(id) ON DELETE CASCADE | User receiving notification |
| type | notification_type | NOT NULL | Category of notification event |
| title | TEXT | NOT NULL | Notification title |
| message | TEXT | NOT NULL | Notification body text |
| report_id | UUID | FK -> reports(id) ON DELETE SET NULL | Associated report (nullable) |
| is_read | BOOLEAN | NOT NULL DEFAULT false | Whether user has read notification |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When notification was created |

Only is_read updatable by recipient. All other columns immutable.

---

## Relationships and Cardinalities

| Relationship | Cardinality | Notes |
|---|---|---|
| auth.users to profiles | 1:1 | Profiles extend Auth users |
| profiles to reports (reporter) | 1:N | Any authenticated role may submit (APPROVED PD-R6) |
| profiles to role_change_audit | 1:N | APPROVED OD-NEW-1 |
| categories to reports | 1:N | Reports belong to one category |
| locations to reports | 1:N | Reports located at one location |
| reports to report_attachments | 1:0..5 (active) | 0 to 5 active photos; soft-deleted not counted |
| reports to report_status_history | 1:1..* | At least one entry per report |
| reports to report_comments | 1:0..* | Zero or more immutable comments (APPROVED PD-D3) |
| reports to assignments | 1:0..* | One active; many over report lifetime |
| assignments to work_logs | 1:0..* | Zero or more sessions (blocked for non-active) |
| reports to verifications | 1:0..* | One per verification attempt |
| reports to notifications | 1:0..* | Notifications may reference a report |
| profiles to notifications | 1:0..* | Users receive notifications |

---

## Status Transition Map

| From | To | Actor | Reason Required |
|---|---|---|---|
| submitted | under_review | Coordinator | No |
| submitted | assigned | Coordinator | No |
| submitted | cancelled | Reporter or Coordinator (APPROVED PD-W2, PD-W3) | Yes |
| under_review | assigned | Coordinator | No |
| under_review | cancelled | Reporter or Coordinator (APPROVED PD-W2, PD-W3) | Yes |
| assigned | in_progress | Technician | No |
| assigned | assigned (reassign) | Coordinator | No |
| assigned | declined | Technician only (APPROVED PD-R2, OD-NEW-3) | Yes — decline_reason required; non-empty |
| assigned | cancelled | Coordinator (APPROVED PD-W3) | Yes |
| in_progress | on_hold | Technician or Coordinator (APPROVED PD-W1) | Yes |
| in_progress | completed | Technician | No |
| in_progress | cancelled | Coordinator (APPROVED PD-W3) | Yes |
| on_hold | in_progress | Technician or Coordinator (APPROVED PD-W1) | No |
| on_hold | cancelled | Coordinator (APPROVED PD-W3) | Yes |
| completed | verified | Coordinator (D2 + PD-R4 restrictions) | No |
| completed | reopened | Coordinator | Yes |
| reopened | in_progress | Technician | No |
| reopened | cancelled | Coordinator (APPROVED PD-W3) | Yes |

Terminal assignment states: cancelled, declined. Technician may only decline from assigned.
Once declined, the assignment is terminal. A new assignment row is created for reassignment.

---

## Proposed Triggers

### T1 - Updated-At Trigger

Tables: profiles, reports (NOT report_comments — APPROVED PD-D3)
Event: BEFORE UPDATE
Action: Sets updated_at = now().

### T2 - Report Number Generation

Table: reports
Event: BEFORE INSERT
Action: 'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0') (APPROVED PD-D4)
Concurrency-safe. report_number immutable after creation.

### T3 - Status History Recording

Table: reports
Event: AFTER UPDATE when status changes
Action: Safety-net INSERT into report_status_history.
Recommended: application inserts history with reason, then updates reports.status.

### T4 - Profile Creation on Auth Signup

Table: auth.users
Event: AFTER INSERT
Action: Inserts new profiles row with role = student_personnel (D1).
SECURITY DEFINER.

---

## Timestamp Conventions

| Convention | Detail |
|---|---|
| Data type | TIMESTAMPTZ on all timestamp columns |
| Storage | UTC |
| Display | Frontend converts to user local timezone |
| created_at | Set once at creation; never modified |
| updated_at | T1 applies to profiles and reports only (NOT report_comments, per PD-D3) |
| deleted_at | Soft-delete timestamp on report_attachments. Set once; never cleared. |
| Audit tables | No updated_at — append-only |

---

## Database Integrity Rules

### Foreign Key Cascade Behavior

| Table | Column | On Delete |
|---|---|---|
| profiles | id from auth.users | CASCADE |
| role_change_audit | user_id, changed_by | RESTRICT |
| reports | category_id, location_id, reporter_id | RESTRICT |
| report_attachments | report_id | CASCADE |
| report_attachments | uploaded_by | RESTRICT |
| report_attachments | deleted_by | RESTRICT |
| report_status_history | report_id | CASCADE |
| report_status_history | changed_by | RESTRICT |
| report_comments | report_id | CASCADE |
| report_comments | author_id | RESTRICT |
| assignments | report_id | CASCADE |
| assignments | technician_id, assigned_by | RESTRICT |
| work_logs | assignment_id | CASCADE |
| work_logs | technician_id | RESTRICT |
| verifications | report_id | CASCADE |
| verifications | verified_by | RESTRICT |
| notifications | recipient_id | CASCADE |
| notifications | report_id | SET NULL |

### Append-Only Tables

- report_status_history
- verifications
- work_logs
- role_change_audit (APPROVED OD-NEW-1)

---

## Deviations from DATABASE.md

| # | Item | Status | Explanation |
|---|---|---|---|
| 1 | role_change_audit table | APPROVED OD-NEW-1 | Satisfies audit requirements in ROLES.md and SECURITY.md |
| 2 | chk_mime_type on report_attachments | APPROVED PD-D5 | JPEG, PNG, WebP confirmed |
| 3 | chk_file_size on report_attachments | APPROVED PD-D5 | 10 MB max, defense-in-depth |
| 4 | chk_role_changed on role_change_audit | APPROVED OD-NEW-1 | Prevents no-op audit entries |
| 5 | T2 trigger uses PostgreSQL SEQUENCE | APPROVED PD-D4 | Concurrency-safe RPT-000001 format |
| 6 | T4 profile creation trigger | Proposed | Required for Supabase Auth + profiles per SECURITY.md |
| 7 | RESTRICT on user FK references | Proposed | Formalizes no-cascade rule from DATABASE.md |
| 8 | PD-R4 reporter_id check on verifications | APPROVED PD-R4 | Self-verification prohibition |
| 9 | declined value in assignment_status | APPROVED PD-R2 | Technician may decline with required reason |
| 10 | updated_at REMOVED from report_comments | APPROVED PD-D3 | Comments are immutable |
| 11 | All 5 roles can INSERT into reports | APPROVED PD-R6 | administrator and management now permitted reporters |
| 12 | deleted_at on report_attachments | APPROVED OD-NEW-2 | Soft-delete timestamp; NULL = active |
| 13 | deleted_by on report_attachments | APPROVED OD-NEW-2 | Coordinator who soft-deleted; FK -> profiles RESTRICT |
| 14 | decline_reason on assignments | APPROVED OD-NEW-3, OD-REC-1 | Required when status = declined; CHECK constraint with btrim() |
| 15 | report_comments SELECT for admin/management | APPROVED OD-REC-2 | Administrator and management granted read access to comments |
| 16 | Supabase Storage bucket RLS design | APPROVED OD-REC-3 | Private bucket report-attachments with storage.objects RLS policies |

---

## Open Items Requiring Owner Decision

The following decisions do not block core migration preparation.

| Decision ID | Status | Impact |
|---|---|---|
| PD-D1 | RECOMMENDED | Location table structure |
| PD-D6 | RECOMMENDED | Notification creation method |
| PD-D7 | RECOMMENDED | confirmed_priority nullable |
| PD-D8 | OPEN | Hard user deletion support |
| PD-D9 | RECOMMENDED | Timestamps on categories |
| PD-D10 | RECOMMENDED | Uniqueness constraint on locations |
| PD-W5 | OPEN | Maximum reopening count |
| PD-W6 | RECOMMENDED | under_review always required |

Open implementation questions:
- Attachment deletion reason: the approved soft-delete records who and when but not why.
  If a justification is required for audit compliance, a new decision is needed.
- assignment_declined notification type: not yet formally approved.
- Historical visibility retention period: no policy approved; visibility persists indefinitely until an explicit decision is made.

---

*Phase 3F update 2026-10-18. All schema and RLS decisions are owner-approved.*
*See OPEN_DECISIONS.md for all decisions.*
*See RLS_POLICY_PROPOSAL.md for access control policies.*
*See DATA_DICTIONARY.md for column-level definitions.*
*See PHASE_3F_REVIEW.md for complete Phase 3F review.*
