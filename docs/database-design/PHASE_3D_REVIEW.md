# CMIRS Phase 3D - Documentation Review

> **Phase 3D (2026-10-18):** Three schema gaps resolved — OD-NEW-2, OD-NEW-3, OD-NEW-4.
> All schema, enum, constraint, and RLS decisions are now owner-approved.
> Prior review history: PHASE_3B_REVIEW.md, PHASE_3C_REVIEW.md.

---

## Summary

Phase 3D records three owner-approved decisions that resolve the remaining schema gaps
identified in Phase 3C. All core schema, RLS, and constraint decisions are now finalized.
The project is ready for migration preparation.

---

## Phase 3D Owner-Approved Decisions

| Decision | Summary |
|---|---|
| OD-NEW-2 | Soft deletion of report_attachments via deleted_at (TIMESTAMPTZ) and deleted_by (UUID FK) columns. Hard DELETE remains DENY. Soft deletion implemented as SECURITY DEFINER RPC. File metadata remains immutable. Audit trail preserved indefinitely. Storage cleanup is asynchronous and retryable. |
| OD-NEW-3 | decline_reason TEXT column added to assignments. Required (non-null, non-empty) when status = declined. CHECK constraint: status != 'declined' OR decline_reason IS NOT NULL. Single field is sufficient (declined is terminal; one decline per assignment record). |
| OD-NEW-4 | Declined-only assignments excluded from technician report visibility. Predicate confirmed: assignments.status != 'declined'. Historical access for completed, reassigned, cancelled assignments is preserved. |

---

## Previously Approved Decisions (Remain in Force)

| Decision | Summary |
|---|---|
| OD-NEW-1 | role_change_audit table included. |
| PD-D2 | Attachments immutable after upload. Coordinator soft deletion approved. |
| PD-D3 | Comments immutable. updated_at removed from report_comments. |
| PD-D4 | Report numbers: RPT-000001 format, PostgreSQL SEQUENCE. |
| PD-D5 | Photo limits: 5 active per report, 10 MB per file, JPEG/PNG/WebP. |
| PD-R1 | Technicians see only own assigned reports (non-declined assignments). |
| PD-R2 | Technicians may decline assignments; decline_reason required. |
| PD-R4 | Coordinator cannot verify own submitted reports. |
| PD-R6 | All five roles may submit reports. |
| PD-W1 | Work holds by technician or coordinator. |
| PD-W2 | Reporter cancellation at submitted or under_review only. |
| PD-W3 | Coordinator cancellation at any non-terminal stage. |
| PD-W4 | Active assignments cancelled atomically on report cancellation. |

---

## Files Changed in Phase 3D

| File | Status | Change Summary |
|---|---|---|
| docs/database-design/OPEN_DECISIONS.md | Updated | OD-NEW-2, OD-NEW-3, OD-NEW-4 → OWNER APPROVED. Migration-blocking status: cleared. Phase 3D sections added. Three gap section bodies replaced with approved decision text including full implementation requirements. |
| docs/database-design/SCHEMA_PROPOSAL.md | Updated | Phase 3D decisions applied table added. assignment_status enum: Qualifies for Visibility column added, declined updated. report_attachments: deleted_at and deleted_by columns added; key notes updated. assignments: decline_reason column added with CHECK constraint; decline workflow documented. Status Transition Map: decline row updated. Deviations table: three new entries. Open Items: OD-NEW-2/3/4 removed. |
| docs/database-design/RLS_POLICY_PROPOSAL.md | Updated | can_view_report: FINALIZED with OD-NEW-4. Phase 3D changes section added. report_attachments matrix: SELECT distinction active/deleted; soft-delete via RPC; hard DELETE DENY all. assignments matrix: decline transition documented. work_logs INSERT guard: declined added. Unresolved table: replaced with questions (no formal blockers remain). |
| docs/database-design/DATA_DICTIONARY.md | Updated | assignment_status enum: on_hold in Active column; Qualifies for Visibility column added; declined updated. report_attachments: deleted_at and deleted_by column entries added; key notes updated. assignments: decline_reason column entry added; status column description updated. |
| docs/database-design/PHASE_3D_REVIEW.md | New | This document. |

No changes made to:
- docs/DATABASE.md, docs/ROLES.md, docs/WORKFLOW.md, docs/SECURITY.md, README.md
- Any application source code, environment files, migrations, or Supabase configuration.

---

## Schema Changes in Phase 3D

| Table | Change | Approved By |
|---|---|---|
| report_attachments | Added deleted_at TIMESTAMPTZ (nullable) | OD-NEW-2 |
| report_attachments | Added deleted_by UUID FK -> profiles(id) RESTRICT (nullable) | OD-NEW-2 |
| assignments | Added decline_reason TEXT (nullable, with CHECK constraint) | OD-NEW-3 |

No tables added or removed. No other columns added or removed.

---

## RLS Changes in Phase 3D

| Policy | Change |
|---|---|
| can_view_report | FINALIZED: status != 'declined' predicate confirmed (OD-NEW-4) |
| report_attachments SELECT | Active-only (deleted_at IS NULL) for student_personnel/technician; all rows for coordinator/admin/management |
| report_attachments soft-delete | Via SECURITY DEFINER RPC; no general UPDATE permission on coordinator |
| report_attachments hard DELETE | DENY for all roles (unchanged, confirmed) |
| assignments UPDATE (technician) | Decline transition: USING status = 'assigned', WITH CHECK status = 'declined' AND decline_reason IS NOT NULL |
| work_logs INSERT predicate | assignment.status NOT IN ('cancelled', 'declined') (OD-NEW-3 guard added) |

---

## OD-NEW-2 Implementation Detail: Soft Deletion

### What Coordinator Does
Coordinator calls a SECURITY DEFINER RPC. The RPC:
1. Verifies caller's role = coordinator.
2. Verifies the attachment's deleted_at IS NULL (currently active).
3. Sets deleted_at = now() and deleted_by = auth.uid().
4. Returns success or an error if preconditions are not met.

No general UPDATE permission on report_attachments is granted to the coordinator role.

### What Happens to File Metadata
file_path, file_name, file_size, mime_type, uploaded_by, and created_at are unchanged.
They remain in the soft-deleted row and are available for audit and Storage retry.

### What Happens to the Storage Object
After the RPC returns success, the application attempts to delete the Storage object
identified by file_path. If this fails:
- The database row is already soft-deleted (hidden from active queries).
- The file_path is still in the row.
- A background retry job queries rows WHERE deleted_at IS NOT NULL AND
  (application-level cleanup flag = pending) and retries the Storage deletion.
- The audit record (deleted_at, deleted_by) is never affected by Storage operations.

### Restoration Prevention
Once deleted_at IS NOT NULL, the RLS USING clause (USING: deleted_at IS NULL) prevents
any further UPDATE on that row. No role can clear deleted_at or change deleted_by.

### Open Question: Deletion Reason
The approved design does not record why an attachment was deleted — only who and when.
If a deletion justification is required for audit compliance, a new decision is needed
(no ID assigned until owner confirms the requirement).

---

## OD-NEW-3 Implementation Detail: Decline Reason

### CHECK Constraint
```
CHECK (status != 'declined' OR decline_reason IS NOT NULL)
```
Database enforces: if status is declined, decline_reason must not be null.
Application additionally enforces: reason must not be an empty string.

### Can an Assignment Be Declined More Than Once?
No. declined is terminal for the assignment record. Once set, no further status updates
are permitted (RLS USING clause: status = 'assigned' — blocks all UPDATE on declined rows).
A new assignment row is created if the coordinator reassigns. The new row has its own
decline_reason field. A single column is sufficient.

### Audit Guarantees
The declined assignment row retains: technician_id, assigned_by, assigned_at, status,
decline_reason. This is sufficient to answer: who was assigned, who declined, when they
were assigned, and their stated reason. No separate history table is needed for MVP.

---

## OD-NEW-4 Implementation Detail: Visibility Predicate

### Confirmed Predicate
```
EXISTS (SELECT 1 FROM assignments
        WHERE assignments.report_id = $1
          AND assignments.technician_id = auth.uid()
          AND assignments.status != 'declined')
```

### Historical Access Summary

| Assignment Status | Can Technician View Report? | Reason |
|---|---|---|
| assigned | Yes | Active current assignment |
| in_progress | Yes | Active current assignment |
| on_hold | Yes | Active current assignment |
| completed | Yes | Technician performed work; needs access to own work_logs |
| reassigned | Yes | Technician worked on report before replacement; accountability |
| cancelled | Yes | Active assignment cancelled with the report; technician was involved |
| declined | No | Technician refused before any work; no work_logs; no accountability requirement |

### Unresolved: Visibility Retention Period
No policy has been approved on when completed/reassigned/cancelled visibility should
expire. The current implementation grants indefinite access as long as the qualifying
assignment row exists. A retention policy would require a new decision.

---

## Remaining Open Decisions

### No Core Migration Blockers
All schema, enum, constraint, and RLS decisions are now owner-approved.
Migration scripts may be prepared.

### Not Blocking Migration

| ID | Status | Summary |
|---|---|---|
| PD-D1 | RECOMMENDED | Location table structure |
| PD-D6 | RECOMMENDED | Notification creation method |
| PD-D7 | RECOMMENDED | confirmed_priority nullable |
| PD-D8 | OPEN | Hard user deletion policy |
| PD-D9 | RECOMMENDED | Timestamps on categories |
| PD-D10 | RECOMMENDED | Uniqueness constraint on locations |
| PD-S1 | OPEN | Rate limiting |
| PD-S2 | OPEN | Session timeout |
| PD-S3 | OPEN | Password policy |
| PD-S4 | OPEN | CORS |
| PD-W5 | OPEN | Maximum reopening count |
| PD-W6 | RECOMMENDED | under_review always required |

### Implementation Questions (No Formal ID Yet)

| Question | Context |
|---|---|
| Attachment deletion reason | OD-NEW-2 approved design records who/when but not why. A justification field requires a new decision. |
| Visibility retention period | OD-NEW-4 approved indefinite access for qualifying assignments. Explicit revocation requires a new decision. |
| assignment_declined notification type | Notification to coordinator when technician declines. Not yet formally approved. |

---

## Migration Readiness Assessment

**Recommendation: READY FOR MIGRATION PREPARATION.**

All decisions that affect the core schema, enums, constraints, and RLS policies are
owner-approved. Specifically:

- All table definitions finalized (including deleted_at/deleted_by on report_attachments and decline_reason on assignments).
- All enum values finalized.
- All PRIMARY KEY, FOREIGN KEY, UNIQUE, and CHECK constraints defined.
- All RLS policies specified for all tables.
- The soft-delete implementation approach (SECURITY DEFINER RPC) is documented.
- The decline operation authorization model is documented.
- The technician visibility predicate is confirmed (APPROVED OD-NEW-4).

The remaining open items (PD-D1 through PD-W6) and implementation questions do not
require schema migration and will be resolved during application implementation.

**Next step:** Owner authorizes migration script preparation. The first migration will
create all tables, enums, constraints, indexes, triggers, and RLS policies as documented
in SCHEMA_PROPOSAL.md and RLS_POLICY_PROPOSAL.md.

---

## Validation

Git diff scope confirmed: only docs/database-design/*.md files changed.
No credentials, secrets, environment values, or application code in any changed file.
No SQL or migration files created.
No Phase 0 source documents modified (DATABASE.md, ROLES.md, WORKFLOW.md, SECURITY.md, README.md).

---

*Phase 3D complete 2026-10-18. Awaiting owner authorization for migration preparation.*
*All OPEN and RECOMMENDED decisions still require explicit owner approval.*
*Prior review history: PHASE_3B_REVIEW.md, PHASE_3C_REVIEW.md.*
