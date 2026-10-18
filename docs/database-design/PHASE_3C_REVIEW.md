# CMIRS Phase 3C - Documentation Review

> **Phase 3C (2026-10-18):** Five owner-approved decisions recorded and reconciled.
> Prior history is in PHASE_3B_REVIEW.md. This document covers Phase 3C changes only.

---

## Summary

Phase 3C records five owner-approved decisions (PD-D2, PD-D3, PD-R1, PD-R2, PD-R6),
reconciles all four database-design proposal documents, identifies three schema gaps,
and confirms that the project is ready for migration preparation.

---

## Phase 3C Owner-Approved Decisions

| Decision | Summary |
|---|---|
| PD-D2 | Attachments immutable after upload. Coordinator-controlled deletion approved. Partial failure handling and Storage/DB relationship documented. Deletion audit mechanism deferred to OD-NEW-2. |
| PD-D3 | Comments immutable after creation. No editing or deletion for any role. Corrections must be follow-up comments. updated_at removed from report_comments. T1 trigger no longer applies to report_comments. |
| PD-R1 | Technicians access only their own assigned reports (any non-declined assignment record). Reassignment history preserved and visible. Work logs restricted to own assignments only. Declined assignments excluded from visibility. |
| PD-R2 | Technicians may decline assignments with a required reason. declined enum value added to assignment_status. Declined assignments are non-active and terminal. Reason storage deferred to OD-NEW-3. |
| PD-R6 | All five authenticated roles (student_personnel, coordinator, technician, administrator, management) may submit maintenance reports. No additional permissions granted beyond report submission. Coordinator self-verification restriction (PD-R4) preserved. |

---

## Previously Approved Decisions (Remain in Force)

| Decision | Summary |
|---|---|
| OD-NEW-1 | role_change_audit table included. |
| PD-D4 | Report numbers: RPT-000001 format, PostgreSQL SEQUENCE, concurrency-safe. |
| PD-D5 | Photo limits: 5 per report, 10 MB per file, JPEG/PNG/WebP. |
| PD-R4 | Coordinator self-verification prohibited. |
| PD-W1 | Work holds: technician or coordinator may initiate. Reason required. |
| PD-W2 | Reporter cancellation at submitted or under_review only. |
| PD-W3 | Coordinator cancellation at any non-terminal stage. |
| PD-W4 | Active assignments marked cancelled atomically on report cancellation. |

---

## Files Changed in Phase 3C

| File | Status | Change Summary |
|---|---|---|
| docs/database-design/OPEN_DECISIONS.md | Updated | Register: 5 rows updated to OWNER APPROVED, 3 new gaps added (OD-NEW-2, 3, 4). Migration-blocking status updated. Phase 3C sections added. PD-D2, PD-D3, PD-R1, PD-R2, PD-R6 decision bodies replaced with approved text. |
| docs/database-design/SCHEMA_PROPOSAL.md | Updated | Phase 3C decisions applied table added. assignment_status enum: declined added, on_hold added. report_comments: updated_at column removed. T1 trigger: report_comments removed. report_attachments: PD-D2 notes updated. reports INSERT: all roles. Open Items table: updated to remove resolved decisions, add gaps. |
| docs/database-design/RLS_POLICY_PROPOSAL.md | Updated | can_view_report: predicate updated to status != 'declined'. Phase 3C changes section added. report_comments: UPDATE/DELETE finalized as DENY all. report_attachments: UPDATE DENY all, DELETE pending OD-NEW-2. reports INSERT: all roles allowed. work_logs: declined added to blocked statuses. Unresolved table: updated. |
| docs/database-design/DATA_DICTIONARY.md | Updated | assignment_status: on_hold added, declined added. user_role: administrator/management descriptions updated for PD-R6. report_comments: updated_at row removed, immutability notes added. report_attachments: deletion notes updated for PD-D2/OD-NEW-2. assignments.status: declined terminal state documented. work_logs.technician_id: declined guard added. |
| docs/database-design/PHASE_3C_REVIEW.md | New | This document. |

No changes made to:
- docs/DATABASE.md
- docs/ROLES.md
- docs/WORKFLOW.md
- docs/SECURITY.md
- README.md
- Any application source code, environment files, migrations, or Supabase configuration.

---

## Schema Gaps Identified in Phase 3C

### OD-NEW-2: Attachment Deletion Audit Mechanism

**Source:** PD-D2 reconciliation.
PD-D2 approves coordinator-controlled deletion that must be authorized and auditable.
The current report_attachments table has no columns to record who deleted an attachment
and when (no deleted_at, no deleted_by).

Coordinator DELETE RLS policy cannot be fully specified without these columns.
Conservative current default: DELETE DENY for all roles.

**Recommended resolution:** Soft-delete approach — add deleted_at TIMESTAMPTZ and
deleted_by UUID FK -> profiles(id) to report_attachments.

**Blocks:** Coordinator attachment deletion feature.

### OD-NEW-3: Assignment Decline Reason Storage

**Source:** PD-R2 reconciliation.
PD-R2 requires a technician decline reason. No existing field stores this:
- assignments.notes is for coordinator notes to technician.
- report_status_history is for report-level status events.
- No assignment_status_history table exists.

The declined enum value is added. The reason cannot currently be stored or audited.

**Recommended resolution:** Add decline_reason TEXT (nullable) to assignments table.

**Blocks:** Complete audit trail for declined assignments.

### OD-NEW-4: Technician Visibility for Declined-Only Assignments

**Source:** PD-R1 reconciliation.
The approved PD-R1 policy gives visibility to reports where a technician has any
non-declined assignment record. A technician who ONLY declined (and never worked) would
be excluded from visibility under this implementation.

**Current implementation:** Declined assignments excluded from visibility predicate.
(can_view_report checks status != 'declined' in the assignments JOIN.)

**Open question:** Owner confirmation that this exclusion is correct would close OD-NEW-4.

**Blocks:** Nothing. Implementation proceeds with exclusion as the default.

---

## Schema Changes in Phase 3C

| Table | Change | Reason |
|---|---|---|
| assignment_status enum | on_hold added | Was omitted from enum definition in Phase 3B |
| assignment_status enum | declined added | APPROVED PD-R2 |
| report_comments | updated_at column REMOVED | APPROVED PD-D3: immutable comments need no edit timestamp |
| report_comments | T1 trigger removed | updated_at no longer exists on this table |
| reports INSERT policy | All roles allowed | APPROVED PD-R6 |
| report_attachments | Deletion documentation updated | APPROVED PD-D2 + OD-NEW-2 gap |

No tables were added or removed. No other columns were added or removed.

---

## RLS Changes in Phase 3C

| Policy | Change |
|---|---|
| can_view_report helper | status != 'declined' (was status != 'cancelled') |
| report_comments UPDATE | DENY all (finalized from PD-D3 pending) |
| report_comments DELETE | DENY all (finalized from PD-D3 pending) |
| report_attachments UPDATE | DENY all (finalized from PD-D2) |
| report_attachments DELETE | DENY all pending OD-NEW-2 (coordinator ALLOW deferred) |
| reports INSERT | ALLOW all authenticated roles (PD-R6) |
| work_logs INSERT predicate | assignment.status NOT IN ('cancelled', 'declined') (PD-R2 added) |
| assignments UPDATE | Declined status added as terminal — no further transitions (PD-R2) |

---

## Contradictions and Assessments

### 1. PD-D2 vs PD-D5: Deletion of files within upload limits

PD-D5 approves a max of 5 attachments per report. PD-D2 approves deletion.
Assessment: No contradiction. Deletion reduces the count below the max. The 5-file limit
applies to active (non-deleted) attachments. Confirmed consistent.

### 2. PD-R1 vs PD-R2: Declined assignment visibility

PD-R1 grants visibility based on assignment records. PD-R2 adds declined status.
Assessment: Declined-only assignments are excluded from visibility (OD-NEW-4 documents
the policy). No contradiction — the two decisions interact predictably.

### 3. PD-R6 vs PD-R4: Coordinator as reporter and verifier

PD-R6 allows coordinators to submit reports. PD-R4 prohibits coordinators from verifying
reports they submitted.
Assessment: No contradiction. The two rules are complementary. PD-R4 remains fully in force.
The RLS verifications INSERT policy includes verified_by != reports.reporter_id.

### 4. PD-R6 scope: administrator and management reporting

PD-R6 grants administrator and management report submission only.
Assessment: Their SELECT scope remains what it was (administrator sees all, management sees
all). They do not gain coordinator or technician operational capabilities.
No RLS scope change needed for SELECT. Only reports INSERT policy updated.

---

## Remaining Open Decisions

### Feature-Level Gaps (Do Not Block Core Migration)

| ID | Status | Summary | Blocks |
|---|---|---|---|
| OD-NEW-2 | OPEN | Attachment deletion audit mechanism | Coordinator DELETE on report_attachments |
| OD-NEW-3 | OPEN | Assignment decline reason storage | Audit trail for declines |
| OD-NEW-4 | OPEN | Technician visibility for declined-only assignments | Confirm exclusion is correct |

### Not Blocking Migration

| ID | Status | Summary |
|---|---|---|
| PD-D1 | RECOMMENDED | Location table structure (proceed with single table) |
| PD-D6 | RECOMMENDED | Notification creation method (INSERT via service role or trigger) |
| PD-D7 | RECOMMENDED | confirmed_priority nullable (proceed nullable) |
| PD-D8 | OPEN | Hard user deletion (proceed with soft-deactivation for MVP) |
| PD-D9 | RECOMMENDED | Timestamps on categories |
| PD-D10 | RECOMMENDED | Uniqueness constraint on locations |
| PD-S1 | OPEN | Rate limiting (application concern) |
| PD-S2 | OPEN | Session timeout (Supabase Auth config) |
| PD-S3 | OPEN | Password policy (Supabase Auth config) |
| PD-S4 | OPEN | CORS (application/deployment concern) |
| PD-W5 | OPEN | Maximum reopening count |
| PD-W6 | RECOMMENDED | under_review not always required |

---

## Migration Readiness Assessment

**Recommendation: READY FOR MIGRATION PREPARATION.**

All decisions that affect the core schema, enums, constraints, and RLS policies have been
resolved. Specifically:

- All table definitions are finalized.
- All enum values are finalized (including declined for assignment_status).
- All primary key, foreign key, UNIQUE, and CHECK constraints are defined.
- All RLS policies are specified for all tables, with conservative defaults for
  the two pending features (OD-NEW-2 coordinator deletion, OD-NEW-3 decline reason).
- The pending gaps (OD-NEW-2, OD-NEW-3, OD-NEW-4) do not require schema migrations
  at this time; they will require additive changes (new columns or tables) when resolved.

No blocking decisions remain. Migration scripts may be prepared.

**Next step:** Owner authorizes migration script preparation. The first migration will
create all tables, enums, constraints, indexes, triggers, and RLS policies as documented.

---

## Validation: Git Diff Scope

The following files were changed in Phase 3C:

```
docs/database-design/OPEN_DECISIONS.md        (updated)
docs/database-design/SCHEMA_PROPOSAL.md       (updated)
docs/database-design/RLS_POLICY_PROPOSAL.md   (updated)
docs/database-design/DATA_DICTIONARY.md       (updated)
docs/database-design/PHASE_3C_REVIEW.md       (new)
```

No changes were made to:
- docs/DATABASE.md
- docs/ROLES.md
- docs/WORKFLOW.md
- docs/SECURITY.md
- README.md
- src/ (Next.js application code)
- utils/ (Supabase client utilities)
- .env.local / .env.example (no secrets accessed or exposed)
- Any migration files (none created)
- Remote Supabase database or Storage

---

*Phase 3C complete 2026-10-18. Awaiting owner authorization for migration preparation.*
*All OPEN and RECOMMENDED decisions still require explicit owner approval.*
*Prior review history: PHASE_3B_REVIEW.md.*
