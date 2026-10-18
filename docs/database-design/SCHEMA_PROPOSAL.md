# CMIRS - Schema Proposal

> **Status: PROPOSAL - Updated Phase 3B (2026-10-18). Not approved for migration.**
> Reflects seven owner-approved decisions. Do not execute SQL. Do not apply migrations.

## Table of Contents

- [Purpose and Scope](#purpose-and-scope)
- [Authoritative Sources](#authoritative-sources)
- [Confirmed Requirements](#confirmed-requirements)
- [Phase 3B Decisions Applied](#phase-3b-decisions-applied)
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
- docs/database-design/OPEN_DECISIONS.md - owner-approved decisions D1-D8 and Phase 3B

**No tables, enums, triggers, functions, or RLS policies have been created. Planning only.**

---

## Authoritative Sources

Confirmed decisions from README.md treated as hard requirements:

| ID | Decision |
|---|---|
| D1 | New users receive student_personnel default role. Administrator assigns actual role. |
| D2 | Designated Coordinator verifies completed repairs. Performing technician cannot verify own work. |
| D3 | Reporters flag urgent hazards. Coordinator confirms/adjusts priority independently. Flag does not auto-set confirmed_priority. |
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
5. Assignments never deleted on reassignment - previous records marked reassigned.
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

## Phase 3B Decisions Applied

The following owner decisions from OPEN_DECISIONS.md Phase 3B section are reflected in this document:

| Decision | Change to Schema |
|---|---|
| OD-NEW-1 APPROVED | role_change_audit table included (was pending approval) |
| PD-D4 APPROVED | T2 trigger description finalized: RPT-000001 format via PostgreSQL sequence |
| PD-D5 APPROVED | report_attachments: added chk_file_size constraint; updated key notes with 5-file count limit and 10 MB limit; multi-layer validation described |
| PD-R4 APPROVED | verifications: updated key notes to add reporter_id check alongside D2 technician check |
| PD-W1 APPROVED | Status transition map: in_progress to on_hold actor updated to Technician or Coordinator |
| PD-W2 APPROVED | Status transition map: submitted and under_review to cancelled actor updated to Reporter or Coordinator |
| PD-W3 APPROVED | Status transition map: all non-terminal to cancelled actor confirmed as Coordinator for all remaining stages |

---

## Proposed Enums

### user_role

Values: student_personnel (default), coordinator, technician, administrator, management.

| Value | Description |
|---|---|
| student_personnel | Default role. Primary reporters. |
| coordinator | Triages, assigns, verifies. |
| technician | Performs repairs, logs work. |
| administrator | Manages user accounts and roles. |
| management | Read-only oversight. |

### report_status

Values: submitted, under_review, assigned, in_progress, on_hold, completed, verified, reopened, cancelled.

Terminal states: verified, cancelled. No transitions permitted from these states.

### priority_level

Values: low, medium, high, critical.

### assignment_status

Values: assigned, in_progress, completed, reassigned, cancelled.

Note (PD-R2 OPEN): accepted and declined intentionally omitted pending owner decision.
Do not extend this enum without approval.

### notification_type

Values: report_submitted, report_assigned, status_changed, priority_changed, comment_added,
verification_required, verification_complete, verification_failed, report_reassigned, report_cancelled.

---

## Proposed Tables

### profiles

Purpose: Extends auth.users with application-specific data. Single source of truth for
user identity and role within the application.

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

Indexes: Primary key on id. Index on role. Index on email.

Key notes:
- id is set by profile-creation trigger T4 on Auth signup, not auto-generated here.
- role defaults to student_personnel (D1). No user can update their own role column.
- ON DELETE CASCADE from auth.users. See PD-D8 for deletion policy.
- updated_at trigger T1 applied.

---

### role_change_audit

Purpose: Append-only audit log of every role assignment and change. Required by
ROLES.md Section Role Change Rules and SECURITY.md Section Auditability.

APPROVED (OD-NEW-1, 2026-10-18): This table is included in the schema.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Audit record identifier |
| user_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | User whose role changed |
| changed_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | Administrator who made the change |
| old_role | user_role | NOT NULL | Role before change |
| new_role | user_role | NOT NULL | Role after change |
| reason | TEXT | | Optional reason for change |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When change was made |

Check constraint: old_role <> new_role (prevents no-op audit entries).
Index on user_id.
Append-only: No UPDATE or DELETE permitted (RLS-enforced).
changed_by must reference a profile with role = administrator at time of change.

---

### categories

Purpose: Predefined maintenance issue categories for report classification.
Managed by administrators. Deactivated categories remain for historical FK integrity.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Category identifier |
| name | TEXT | NOT NULL UNIQUE | Category name |
| description | TEXT | | Optional description |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Available for new reports |

Notes: No created_at/updated_at in DATABASE.md design. See PD-D9 (RECOMMENDED, not yet decided).

---

### locations

Purpose: Campus locations. Single-table design per DATABASE.md.
PD-D1 (RECOMMENDED): Keep single table unless owner decides to split.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Location identifier |
| building_name | TEXT | NOT NULL | Building name |
| floor | TEXT | | Floor number or description |
| room | TEXT | | Room number or name |
| description | TEXT | | Additional location details |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Available for new reports |

Index on building_name.
No uniqueness constraint on (building_name, floor, room). See PD-D10 (RECOMMENDED, not yet decided).

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
| reporter_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who submitted report |
| status | report_status | NOT NULL DEFAULT submitted | Current lifecycle status |
| is_urgent_hazard | BOOLEAN | NOT NULL DEFAULT false | Reporter urgent-hazard flag (D3) |
| confirmed_priority | priority_level | | Coordinator-confirmed priority, NULL until reviewed |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Report creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Last modification timestamp |

Indexes: Unique on report_number. Index on status. Index on reporter_id.
Index on confirmed_priority. Index on created_at. Composite index on (status, confirmed_priority).

Key notes:
- is_urgent_hazard: reporter-set boolean, independent from confirmed_priority (D3).
- confirmed_priority: NULL until coordinator sets it. Nullable intentional (PD-D7 recommended).
- report_number: generated by T2 (APPROVED PD-D4). Format: RPT-000001 via PostgreSQL sequence.
  The sequence is concurrency-safe; each INSERT receives a unique value.
  UNIQUE constraint provides final database-level guarantee.
  report_number is immutable after creation.
- updated_at trigger T1 applied.

---

### report_attachments

Purpose: File metadata for optional photo attachments (D4). File content in Supabase Storage (private bucket).

APPROVED (PD-D5, 2026-10-18): Maximum 5 per report, 10 MB per file, JPEG/PNG/WebP only.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Attachment identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| file_path | TEXT | NOT NULL | Path in Supabase Storage |
| file_name | TEXT | NOT NULL | Original filename (sanitized) |
| file_size | INTEGER | NOT NULL, CHECK (file_size > 0 AND file_size <= 10485760) | File size in bytes, max 10 MB |
| mime_type | TEXT | NOT NULL, CHECK (mime_type IN ('image/jpeg','image/png','image/webp')) | MIME type |
| uploaded_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who uploaded the file |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Upload timestamp |

Index on report_id.

Key notes:
- 0 to 5 per report (D4 preserved: zero attachments valid; owner-approved max 5).
- ON DELETE CASCADE: application must also clean up Supabase Storage files.
- file_size CHECK constraint: defense-in-depth only. Actual byte count verified server-side.
- mime_type CHECK constraint: defense-in-depth only. MIME type is determined from file content
  (magic bytes) server-side, not from filename extension or browser-supplied Content-Type.
- Per-report count limit (max 5) is enforced server-side before insert; cannot be expressed
  as a single-row CHECK constraint.
- Supabase Storage bucket policy should also enforce size and MIME type limits as additional
  defense-in-depth layer.
- PD-D2 RECOMMENDED: mutability not decided. UPDATE and DELETE currently denied for all roles.

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

Indexes: Index on report_id. Index on created_at. Composite index on (report_id, created_at).

Key notes:
- Append-only. No UPDATE or DELETE permitted (RLS-enforced).
- previous_status is NULL for the initial submission record.
- reason required for on_hold (APPROVED PD-W1), cancelled (APPROVED PD-W2, PD-W3),
  and reopened transitions. Application-enforced; cannot be expressed as a row-level CHECK
  without knowing the new_status at insert time (which the trigger or application supplies).
- changed_by populated from auth.uid() by application at transition time.

---

### report_comments

Purpose: User-authored comments on reports.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Comment identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| author_id | UUID | NOT NULL FK -> profiles(id) RESTRICT | User who wrote the comment |
| content | TEXT | NOT NULL | Comment text |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Comment creation timestamp |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Last edit timestamp |

Indexes: Index on report_id. Index on created_at.

Permission rules (ROLES.md):
- Reporters: own reports only.
- Technicians: assigned reports only.
- Coordinators: any report.
- Administrator and Management: not permitted to comment.

Note (PD-D3 RECOMMENDED): If edits not permitted, remove updated_at and its trigger.
Until decided, updated_at is retained and edits are provisionally allowed by the original author.

---

### assignments

Purpose: Links reports to assigned technicians. All records retained for reassignment audit trail.

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
| notes | TEXT | | Assignment notes from coordinator |

Indexes: Index on report_id. Index on technician_id. Composite index on (technician_id, status).

Role constraints (application-enforced):
- technician_id must reference a profile with role = technician.
- assigned_by must reference a profile with role = coordinator.

Reassignment process:
1. Coordinator creates new assignments record for new technician.
2. Previous record status set to reassigned (not deleted).
3. report_status_history records the reassignment.
4. Both technicians receive notifications.

Cancellation handling (per APPROVED PD-W3):
- When a report is cancelled, the active assignment record status is set to cancelled.
- The assigned technician receives a report_cancelled notification.
- See PD-W4 (RECOMMENDED) for the full assignment-handling policy confirmation.

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

Index on assignment_id.

Key notes:
- Append-only. No UPDATE or DELETE permitted (RLS-enforced).
- technician_id must match assignments.technician_id (application-enforced).
- hours_spent optional. DECIMAL(5,2) supports up to 999.99 hours.

---

### verifications

Purpose: Coordinator verification decisions on completed repairs. One record per attempt.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() | Verification record identifier |
| report_id | UUID | NOT NULL FK -> reports(id) ON DELETE CASCADE | Associated report |
| verified_by | UUID | NOT NULL FK -> profiles(id) RESTRICT | Coordinator who performed verification |
| is_satisfactory | BOOLEAN | NOT NULL | Whether repair passed verification |
| notes | TEXT | | Verification notes or rejection reason |
| verified_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | When verification was performed |

Index on report_id.

Key notes:
- Append-only. No UPDATE or DELETE permitted (RLS-enforced).
- verified_by must have role = coordinator (application-enforced).
- verified_by must NOT be the technician who performed the work (D2, application-enforced).
- verified_by must NOT be the original submitter of the report (reports.reporter_id).
  APPROVED (PD-R4, 2026-10-18). Enforced at both RLS and application levels.
  This is distinct from D2: it checks against reports.reporter_id, not the assignment technician_id.
- is_satisfactory = true triggers completed to verified transition.
- is_satisfactory = false triggers completed to reopened transition (reason required).

---

### notifications

Purpose: In-app notification records (D7).

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

Indexes: Composite index on (recipient_id, is_read, created_at). Index on report_id.

Key notes:
- report_id ON DELETE SET NULL preserves notification history if report is deleted.
- Only is_read updatable by recipient. All other columns immutable.
- Creation by application logic recommended (PD-D6 RECOMMENDED).

Notification events and recipients (WORKFLOW.md):

| Event | Recipients |
|---|---|
| New report submitted | All coordinators |
| Report flagged as urgent hazard | All coordinators (high priority) |
| Report assigned to technician | Assigned technician |
| Report status changed | Reporter, assigned technician |
| Report priority changed | Reporter, assigned technician |
| Comment added | Reporter, assigned technician, relevant coordinator |
| Repair completed awaiting verification | All coordinators |
| Repair verified | Reporter, assigned technician |
| Repair verification failed | Assigned technician |
| Report reassigned | Previous technician, new technician |
| Report cancelled | Reporter, assigned technician if any |

---

## Relationships and Cardinalities

| Relationship | Cardinality | Notes |
|---|---|---|
| auth.users to profiles | 1:1 | Profiles extend Auth users |
| profiles to reports (reporter) | 1:N | User submits many reports |
| profiles to role_change_audit (subject) | 1:N | Role changes applied to user (APPROVED OD-NEW-1) |
| profiles to role_change_audit (changer) | 1:N | Administrator who changed role (APPROVED OD-NEW-1) |
| categories to reports | 1:N | Reports belong to one category |
| locations to reports | 1:N | Reports located at one location |
| reports to report_attachments | 1:0..5 | Zero to five photos (D4 + APPROVED PD-D5) |
| reports to report_status_history | 1:1..* | At least one entry per report |
| reports to report_comments | 1:0..* | Zero or more comments |
| reports to assignments | 1:0..* | One active; many over report lifetime |
| assignments to work_logs | 1:0..* | Zero or more work sessions |
| reports to verifications | 1:0..* | One per verification attempt |
| reports to notifications | 1:0..* | Notifications may reference a report |
| profiles to notifications | 1:0..* | Users receive notifications |

---

## Status Transition Map

Updated with APPROVED decisions PD-W1, PD-W2, and PD-W3.

| From | To | Actor | Reason Required |
|---|---|---|---|
| submitted | under_review | Coordinator | No |
| submitted | assigned | Coordinator | No |
| submitted | cancelled | Reporter or Coordinator (APPROVED PD-W2, PD-W3) | Yes |
| under_review | assigned | Coordinator | No |
| under_review | cancelled | Reporter or Coordinator (APPROVED PD-W2, PD-W3) | Yes |
| assigned | in_progress | Technician | No |
| assigned | assigned (reassign) | Coordinator | No |
| assigned | cancelled | Coordinator (APPROVED PD-W3) | Yes |
| in_progress | on_hold | Technician or Coordinator (APPROVED PD-W1) | Yes |
| in_progress | completed | Technician | No |
| in_progress | cancelled | Coordinator (APPROVED PD-W3) | Yes |
| on_hold | in_progress | Technician or Coordinator (APPROVED PD-W1) | No |
| completed | verified | Coordinator (subject to D2 + PD-R4 restrictions) | No |
| completed | reopened | Coordinator | Yes |
| reopened | in_progress | Technician | No |
| reopened | cancelled | Coordinator (APPROVED PD-W3) | Yes |

Terminal states: verified, cancelled. No transitions permitted from these states.

Unauthorized actors for each transition:
- student_personnel may only cancel reports where reporter_id = their own id AND
  status is submitted or under_review (APPROVED PD-W2).
- Technician may transition in_progress to on_hold and on_hold to in_progress only
  for reports where they have an active assignment (APPROVED PD-W1).
- No role can transition from verified or cancelled.

---

## Proposed Triggers

All triggers are pseudocode proposals. Not implemented. Require owner authorization.

### T1 - Updated-At Trigger

Tables: profiles, reports, report_comments
Event: BEFORE UPDATE
Action: Sets updated_at = now() on each modified row.
Implementation: Single shared function fn_set_updated_at() applied via separate triggers.

### T2 - Report Number Generation

Table: reports
Event: BEFORE INSERT
Action: Generates report_number from a dedicated PostgreSQL SEQUENCE.

APPROVED (PD-D4): Format is RPT-000001 via nextval('report_number_seq').

Implementation notes (pseudocode):
  CREATE SEQUENCE IF NOT EXISTS report_number_seq START 1;

  fn_generate_report_number() BEFORE INSERT ON reports:
    NEW.report_number = 'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0')

Concurrency safety:
- nextval() always returns a unique value per invocation, even under concurrent inserts.
- Gaps in the sequence are acceptable and expected (e.g., on transaction rollback).
- The UNIQUE constraint on report_number provides the final guarantee.
- report_number must not be overrideable by INSERT input - the trigger always sets it.

### T3 - Status History Recording

Table: reports
Event: AFTER UPDATE when status changes
Action: Inserts record into report_status_history as safety net.

Important limitation: reason cannot be auto-populated by trigger.
Recommended approach: application inserts into report_status_history (with reason
for transitions requiring it per PD-W1, PD-W2, PD-W3 decisions), then updates
reports.status. Trigger is a safety net only.

### T4 - Profile Creation on Auth Signup

Table: auth.users
Event: AFTER INSERT
Action: Inserts new profiles row with role = student_personnel.
Implementation: SECURITY DEFINER function. Keep body minimal.
Note: Not listed in DATABASE.md triggers. Required per SECURITY.md authentication flow.

---

## Timestamp Conventions

| Convention | Detail |
|---|---|
| Data type | TIMESTAMPTZ on all timestamp columns |
| Storage | UTC |
| Display | Frontend converts to user local timezone |
| Precision | Microsecond (PostgreSQL default) |
| created_at | Set once at creation; never modified |
| updated_at | Updated by T1 trigger; on profiles, reports, report_comments only |
| Audit tables | No updated_at - append-only |

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

RESTRICT on user references: soft-deactivation (is_active = false) is the intended pattern.
RESTRICT prevents accidental data loss if a profile is deleted while referenced by historical records.

### Append-Only Tables

No UPDATE or DELETE permitted (enforced via RLS):
- report_status_history
- verifications
- work_logs
- role_change_audit (APPROVED OD-NEW-1)

---

## Deviations from DATABASE.md

| # | Item | Nature | Status | Explanation |
|---|---|---|---|---|
| 1 | role_change_audit table | New table | APPROVED OD-NEW-1 | Satisfies ROLES.md and SECURITY.md audit requirements. |
| 2 | chk_mime_type on report_attachments | New constraint | APPROVED PD-D5 | Database-level MIME enforcement. Types confirmed: JPEG, PNG, WebP. |
| 3 | chk_file_size on report_attachments | New constraint | APPROVED PD-D5 | file_size > 0 AND file_size <= 10485760 (10 MB). Defense-in-depth layer. |
| 4 | chk_role_changed on role_change_audit | New constraint | APPROVED OD-NEW-1 | Prevents no-op audit log entries. |
| 5 | T2 trigger uses PostgreSQL SEQUENCE | Clarification | APPROVED PD-D4 | Sequence guarantees concurrency-safe unique values. |
| 6 | T4 profile creation trigger | New trigger | Proposed | Required for Supabase Auth + profiles integration per SECURITY.md. Not in DATABASE.md. |
| 7 | RESTRICT on user FK references | Clarification | Proposed | Formalizes DATABASE.md note about no cascade for user references. |
| 8 | PD-R4 self-verification check on verifications | Additional constraint | APPROVED PD-R4 | verified_by must not equal reports.reporter_id. Enforced at RLS + app. |

---

## Open Items Requiring Owner Decision

See OPEN_DECISIONS.md for full context and migration-blocking status.

| Decision ID | Status | Blocks Migration | Impact on Schema |
|---|---|---|---|
| PD-D1 | RECOMMENDED | No | locations table structure |
| PD-D2 | RECOMMENDED | Yes (RLS only) | report_attachments UPDATE/DELETE policy |
| PD-D3 | RECOMMENDED | Yes (RLS only) | report_comments UPDATE/DELETE policy; updated_at retention |
| PD-D6 | RECOMMENDED | No | Notification creation method |
| PD-D7 | RECOMMENDED | No | confirmed_priority nullable vs default |
| PD-D8 | OPEN | No | Hard user deletion support |
| PD-D9 | RECOMMENDED | No | Timestamps on categories |
| PD-D10 | RECOMMENDED | No | Uniqueness constraint on locations |
| PD-R1 | RECOMMENDED | Yes (RLS only) | Technician SELECT scope |
| PD-R2 | OPEN | Yes (enum) | assignment_status extension with declined |
| PD-R6 | OPEN | Yes (RLS only) | Administrator and Management INSERT on reports |
| PD-W4 | RECOMMENDED | No | Assignment status on cancellation |
| PD-W5 | OPEN | No | Maximum reopening count |
| PD-W6 | RECOMMENDED | No | under_review always required |

---

*Phase 3B update 2026-10-18. See OPEN_DECISIONS.md for all decisions.*
*See RLS_POLICY_PROPOSAL.md for access control policies.*
*See DATA_DICTIONARY.md for column-level definitions.*
