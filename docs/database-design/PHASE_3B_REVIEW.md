# CMIRS - Phase 3B Review

> **Phase 3B complete. Documentation updated 2026-10-18.**
> No SQL executed. No migrations applied. No Supabase changes made.
> Awaiting owner authorization before migration preparation begins.

---

## Seven Owner-Approved Decisions

| Decision | Summary |
|---|---|
| OD-NEW-1 | role_change_audit table: APPROVED. Included in schema. |
| PD-D4 | Report number format: APPROVED. RPT-000001 via PostgreSQL sequence. Concurrency-safe. |
| PD-D5 | Photo limits: APPROVED. Max 5 per report, 10 MB per file, JPEG/PNG/WebP. Multi-layer validation required. |
| PD-R4 | Coordinator self-verification: PROHIBITED. verified_by must not equal reports.reporter_id. Enforced at RLS and application. |
| PD-W1 | Work holds: Technician or coordinator may initiate. Reason required. Both may resume. |
| PD-W2 | Reporter cancellation: Allowed at submitted or under_review only. Reason required. |
| PD-W3 | Coordinator cancellation: Allowed at any non-terminal stage. Reason required. Status history preserved. |
| PD-W4 | Assignment cancellation: APPROVED. Active assignments (assigned, in_progress, on_hold) marked cancelled atomically on report cancellation. Records preserved. Cancelled assignments block further work logging and status updates. |

---

## Documents Changed

| File | Changes Made |
|---|---|
| OPEN_DECISIONS.md | Registered 7 owner-approved decisions. Updated status column. Added migration-blocking analysis. Added Phase 3B approved decisions section with full implementation notes. Resolved PD-R3 (via PD-W1) and PD-R5 (via PD-W2). |
| SCHEMA_PROPOSAL.md | Added Phase 3B Decisions Applied section. Updated role_change_audit (OD-NEW-1 approved). Updated report_attachments: added chk_file_size constraint, updated key notes with count limit and multi-layer validation description. Updated reports key notes for report_number (PD-D4 approved, sequence described). Updated verifications key notes to add PD-R4 reporter_id check. Updated status transition map with new actors for all cancelled and on_hold transitions. Updated assignments with cancellation handling note. Updated Deviations table with new entries. Updated Open Items table with status and migration-blocking columns. |
| RLS_POLICY_PROPOSAL.md | Added Phase 3B Changes section. Updated reports UPDATE policies for cancellation (PD-W2) and on_hold (PD-W1). Updated report_status_history INSERT policy for student_personnel (PD-W2). Updated verifications INSERT constraints to include PD-R4 reporter_id prohibition. Updated Unresolved RLS Decisions table with resolved items. Added security warning about PD-R4 JOIN complexity. |
| DATA_DICTIONARY.md | Updated all enum descriptions that reference approved decisions. Updated report_status enum values to note cancellation authority. Updated report_number description with approved format and concurrency notes. Updated report_attachments: added chk_file_size and chk_mime_type to column constraints, added validation layers note. Updated verifications verified_by description with PD-R4 prohibition. Updated assignment_status cancelled description. Updated report_status_history reason description. |

---

## Schema Changes Caused by Approved Decisions

### OD-NEW-1 - role_change_audit Table

No schema structure changed (table was already proposed). Status changed from pending to approved.
The table was previously marked "Requires owner approval before implementation."
It is now marked "APPROVED (OD-NEW-1, 2026-10-18): This table is included in the schema."

### PD-D4 - Report Number Format

No columns added or removed. The existing report_number column (TEXT NOT NULL UNIQUE) is unchanged.

Change: T2 trigger description in SCHEMA_PROPOSAL.md now specifies:
- PostgreSQL SEQUENCE as the concurrency-safe number source.
- Format: 'RPT-' || LPAD(nextval('report_number_seq')::TEXT, 6, '0')
- report_number is immutable after creation.
- Gaps in the sequence are acceptable (e.g., on transaction rollback).

### PD-D5 - Photo Upload Limits

Two changes to report_attachments column definitions:

1. file_size column: constraint changed from "NOT NULL" to "NOT NULL, CHECK (file_size > 0 AND file_size <= 10485760)"
2. mime_type column: constraint clarified; the accepted MIME type set is now confirmed as image/jpeg, image/png, image/webp.

These CHECK constraints are defense-in-depth only. They do not replace server-side validation.

The per-report count limit (max 5) cannot be expressed as a single-row CHECK constraint.
It is enforced in the server-side action before insert. No new column is added for this.

### PD-R4 - Coordinator Self-Verification Prohibited

No columns added or removed.

Change: verifications INSERT constraints extended. The condition:
  auth.uid() != reports.reporter_id
must be added to the RLS policy predicate alongside the existing D2 check. The verifications
key notes in SCHEMA_PROPOSAL.md and the verified_by description in DATA_DICTIONARY.md are updated.

### PD-W1 - Work Holds

No columns added or removed.

Change: Status transition map updated. in_progress to on_hold actor changed from
"Pending PD-W1" to "Technician or Coordinator". on_hold to in_progress actor updated similarly.

RLS change: reports UPDATE policy for technician extended to include in_progress -> on_hold
and on_hold -> in_progress for their own assigned reports.

### PD-W2 - Reporter Cancellation

No columns added or removed.

Change: Status transition map updated. submitted to cancelled and under_review to cancelled
actors changed from "Pending PD-W2/PD-W3" to "Reporter or Coordinator".

RLS change: reports UPDATE policy for student_personnel extended to allow status change to
cancelled ONLY when reporter_id = auth.uid() AND current status IN (submitted, under_review).
RLS change: report_status_history INSERT policy for student_personnel extended to allow
cancellation record creation in the same conditions.

### PD-W3 - Coordinator Cancellation

No columns added or removed.

Change: Status transition map updated. assigned, in_progress, on_hold, completed, reopened
to cancelled actors all confirmed as Coordinator. Reason required for all.

No RLS change required: the existing coordinator UPDATE policy on reports already covers
all status transitions. The assignment cancellation update (assignments.status = cancelled)
is a secondary data operation covered by the coordinator's assignments UPDATE permission.

---

## Remaining Open Decisions

### Migration-Blocking (must resolve before migration scripts can be written)

| ID | Status | Summary | Why Blocking |
|---|---|---|---|
| PD-D2 | RECOMMENDED | Attachment mutability | UPDATE/DELETE RLS policies on report_attachments cannot be finalized |
| PD-D3 | RECOMMENDED | Comment mutability | UPDATE/DELETE RLS policies on report_comments cannot be finalized; updated_at may be removed |
| PD-R1 | RECOMMENDED | Technician visibility scope | Technician SELECT RLS policies on 7 tables cannot be finalized |
| PD-R2 | OPEN | Technician decline ability | assignment_status enum may need declined value |
| PD-R6 | OPEN | Administrator/Management as reporters | reports INSERT RLS policy for these roles cannot be finalized |

### Not Blocking Migration (schema and core RLS can proceed without these)

| ID | Status | Summary |
|---|---|---|
| PD-D1 | RECOMMENDED | Location table structure (proceed with single table) |
| PD-D6 | RECOMMENDED | Notification creation method (affects INSERT RLS approach only) |
| PD-D7 | RECOMMENDED | confirmed_priority nullable (proceed with nullable) |
| PD-D8 | OPEN | Hard user deletion (proceed with soft-deactivation for MVP) |
| PD-D9 | RECOMMENDED | Timestamps on categories (proceed without for now) |
| PD-D10 | RECOMMENDED | Uniqueness constraint on locations (proceed without for now) |
| PD-S1 | OPEN | Rate limiting (application concern, not schema) |
| PD-S2 | OPEN | Session timeout (Supabase Auth config, not schema) |
| PD-S3 | OPEN | Password policy (Supabase Auth config, not schema) |
| PD-S4 | OPEN | CORS configuration (application/deployment concern) |
| PD-W5 | OPEN | Maximum reopening count (no schema change required for alert approach) |
| PD-W6 | RECOMMENDED | under_review always required (both paths already in schema) |

---

## Contradictions and Ambiguities Found

### 1. Cancellation reason for assignment: PD-W3 and PD-W4 resolved together

PD-W3 (APPROVED) required that active assignments be notified when their report is cancelled.
PD-W4 is now also APPROVED (2026-10-18): active assignments (assigned, in_progress, on_hold)
must be marked cancelled atomically when their parent report is cancelled. Records are preserved.

**Assessment:** Resolved. No contradiction. Both decisions are consistent and complementary.
PD-W4 explicitly confirms and extends PD-W3 with: active-status definitions, atomicity
requirements, and the RLS guard blocking further work logging against cancelled assignments.

### 2. PD-R4 and D2 are complementary, not conflicting

D2 (confirmed): technician who performed the work cannot verify it.
PD-R4 (APPROVED): coordinator who submitted the report cannot verify it.

These apply to different columns: D2 checks against assignments.technician_id;
PD-R4 checks against reports.reporter_id.

**Assessment:** No contradiction. Both restrictions apply simultaneously. The verifications
INSERT policy must check both conditions.

### 3. Work hold initiator ambiguity for on_hold to in_progress resumption

PD-W1 states both technician and coordinator may initiate a work hold. The decision also
implies both may resume. The approved decision text confirms both may resume from on_hold.

**Assessment:** No ambiguity. Both actors initiate and resume. No schema change needed.

### 4. Technician INSERT on report_status_history for on_hold transition

PD-W1 approves technicians initiating work holds. This requires the technician to insert
a record into report_status_history (new_status = on_hold, reason = <required reason>).

The current RLS proposal for report_status_history INSERT includes "own assigned transitions"
for technicians. This already accommodates the on_hold transition.

**Assessment:** No contradiction. The technician INSERT policy covers this case.

---

## Validation: Git Diff Scope

The following files were changed in Phase 3B:

```
docs/database-design/OPEN_DECISIONS.md    (updated)
docs/database-design/SCHEMA_PROPOSAL.md  (updated)
docs/database-design/RLS_POLICY_PROPOSAL.md (updated)
docs/database-design/DATA_DICTIONARY.md  (updated)
docs/database-design/PHASE_3B_REVIEW.md  (new)
```

No changes were made to:
- docs/DATABASE.md
- docs/ROLES.md
- docs/WORKFLOW.md
- docs/SECURITY.md
- README.md
- Any source code files
- Any Supabase project configuration
- Any environment files
- Any migration files

No SQL was executed. No migrations were applied. No Supabase changes were made.
No commits or pushes were performed.

---

## Recommended Next Steps

1. **Resolve the 6 migration-blocking decisions** (PD-D2, PD-D3, PD-R1, PD-R2, PD-R6, PD-W4)
   by providing owner answers in OPEN_DECISIONS.md.

2. **Confirm PD-W4 closure**: If the assignment should be marked cancelled when its report
   is cancelled (which PD-W3 implies), state so explicitly and the item can be marked closed.

3. **Once all migration-blocking decisions are resolved**, authorize migration preparation.
   The next phase will produce executable Supabase migration SQL covering:
   - Enum type creation (user_role, report_status, priority_level, assignment_status, notification_type)
   - Table creation with all constraints and indexes
   - Trigger functions T1, T2, T3, T4
   - RLS enablement and policy creation
   - Helper functions (get_user_role, can_view_report)

4. **Security review**: Before migration, a focused security review of the proposed RLS
   policies (particularly the verifications INSERT policy with the PD-R4 JOIN) is recommended.

---

*Phase 3B complete. Documentation planning only. No database changes made.*
*See OPEN_DECISIONS.md for all pending decisions.*
