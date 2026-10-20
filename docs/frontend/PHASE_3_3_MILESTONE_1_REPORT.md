# Phase 3.3 Milestone 1 Implementation Report: Mutation Contracts & Pure Input Validation

**Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
**Workspace:** `D:\CMIRS-System\my-app`  
**Milestone:** Phase 3.3 — Milestone 1 (Mutation Payload Contracts & Validation Service)  
**Status:** **COMPLETE**  
**Date:** October 20, 2026  
**Implementation Boundaries:** Milestone 1 Only (Local Types, Validation Service, and Unit Tests)

---

## 1. Executive Summary

Milestone 1 of **Phase 3.3: Report Submission & Mutation Integration** has been successfully implemented and verified locally. This milestone establishes the complete type-safe mutation foundation for CMIRS without introducing side effects, database writes, or remote API calls.

### Key Deliverables Completed
1. **Typed Mutation Contracts (`types/mutations.ts`):** Defined strict TypeScript interfaces for all approved mutation operations (`ReportSubmissionInput`, `ReportTriageInput`, `TechnicianAssignmentInput`, `AssignmentDeclineInput`, `StatusTransitionInput`, `WorkLogInput`, `VerificationInput`, `AttachmentUploadMetaInput`, `MutationResult<T>`, and `ActionFormState<T>`).
2. **Pure Synchronous Validation Service (`utils/reports/validation.ts`):** Implemented deterministic, zero-dependency validation functions enforcing field bounds, canonical database enums, UUID format invariants, text length limits, control character restrictions, work log decimal precision, decline reason constraints, and file attachment storage rules.
3. **Spoofing Defense Architecture:** Input validators explicitly detect and reject client attempts to pass server-derived identity or authority fields (e.g., `reporter_id`, `status`, `confirmed_priority`, `report_number`).
4. **Comprehensive Local Test Suite (`tests/unit/mutation-validation.test.mjs`):** Added 12 automated unit test scenarios verifying boundary conditions, malformed inputs, edge cases, whitespace trimming, and spoofing resistance.
5. **Quality Verification:** Full test suite executed with **70/70 tests passing**, `npx tsc --noEmit` clean (exit code 0), `npm run lint` clean (exit code 0), and Next.js Turbopack production build clean (exit code 0).

---

## 2. Business Decisions Verification & Alignment

The project owner approved three core business decisions for Phase 3.3. Milestone 1 aligns with all three:

| Decision | Approved Requirement | Milestone 1 Implementation & Schema Verification |
| :--- | :--- | :--- |
| **1. Reassignment** | When a coordinator reassigns an `in_progress` report, revert its status to `assigned` for the newly assigned technician, preserving assignment and status history. | **Verified:** The database schema (`maintenance_reports`, `technician_assignments`, `status_history`) and enum definitions (`assigned`, `in_progress`, `reassigned`) fully support this workflow without constraint violation. In `types/mutations.ts` and `utils/reports/validation.ts`, `TechnicianAssignmentInput` and `validateTechnicianAssignmentInput()` accept reassignments cleanly while enforcing valid UUIDs. Status transition logic in Milestone 2 will orchestrate the status update to `assigned` alongside the new assignment record. |
| **2. Verification Rejections** | Allow unlimited verification rejections in the Phase 3.3 MVP. Record each rejection and reopening in history without arbitrary retry limits or auto-escalation. | **Verified:** Database constraints do not restrict the count of reopenings or verification attempts. In `types/mutations.ts` and `utils/reports/validation.ts`, `VerificationInput` supports `isSatisfactory: boolean` and requires explanatory notes (min 5 chars) on rejection, allowing unlimited iterative cycles. |
| **3. Direct Assignment** | Permit direct assignment from `submitted` to `assigned`. | **Verified:** Migration `20261018000005_table_rls_policies.sql` defines coordinator update policies permitting coordinators to update reports across all statuses. There is no trigger or check constraint blocking `submitted -> assigned`. In `types/mutations.ts` and `utils/reports/validation.ts`, `ReportTriageInput` permits triage directly to `assigned` or `under_review`. |

---

## 3. Files Created and Modified

### 1. `types/mutations.ts` (New File — 129 lines)
Defines all mutation contracts, payload shapes, and operation result envelopes:
- `MutationResult<T>`: Standardized result envelope (`success`, `data?`, `error?`, `fieldErrors?`) returned by DAL mutation functions.
- `ActionFormState<T>`: React 19 Action State contract (`status: 'idle' | 'success' | 'error'`, `message?`, `data?`, `fieldErrors?`) designed for Server Actions bound via `useActionState`.
- `ReportSubmissionInput`: Client submission payload (`title`, `description`, `categoryId`, `locationId`, `isUrgentHazard`). Deliberately omits `reporter_id`, `status`, and `confirmed_priority`.
- `CreatedReportResult`: Return shape upon report creation (`id`, `reportNumber`, `status`, `createdAt`).
- `ReportTriageInput`: Coordinator triage payload (`reportId`, `confirmedPriority`, `status: 'under_review' | 'assigned'`).
- `TechnicianAssignmentInput`: Coordinator assignment payload (`reportId`, `technicianId`, `notes?`).
- `AssignmentDeclineInput`: Technician decline payload (`assignmentId`, `reason`).
- `StatusTransitionInput`: Lifecycle status transition payload (`reportId`, `targetStatus`, `reason?`, `assignmentId?`).
- `WorkLogInput`: Technician work log entry (`assignmentId`, `description`, `hoursSpent`).
- `VerificationInput`: Coordinator verification payload (`reportId`, `isSatisfactory`, `notes?`).
- `AttachmentUploadMetaInput`: Storage attachment metadata payload (`reportId`, `fileName`, `fileSize`, `mimeType`).
- `ValidationResult<T>`: Discriminated union for validation outcomes (`{ success: true; data: T }` vs `{ success: false; errors: Record<string, string> }`).

### 2. `utils/reports/validation.ts` (New File — 503 lines)
Implements pure, synchronous, deterministic validators:
- `isValidUuid(value)`: Strict regex check (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`).
- `isReportStatus(value)`: Validates against all 9 canonical database `report_status` enum values (`submitted`, `under_review`, `assigned`, `in_progress`, `on_hold`, `completed`, `verified`, `reopened`, `cancelled`).
- `isPriorityLevel(value)`: Validates against all 4 canonical database `priority_level` enum values (`low`, `medium`, `high`, `critical`).
- `isAssignmentStatus(value)`: Validates against all 7 canonical database `assignment_status` enum values (`assigned`, `in_progress`, `on_hold`, `completed`, `reassigned`, `cancelled`, `declined`).
- `validateReportSubmissionInput(input)`:
  - Enforces `title` length between 5 and 120 characters; rejects newline/tab control characters.
  - Enforces `description` length between 10 and 2000 characters.
  - Enforces valid UUIDs for `categoryId` and `locationId`.
  - Normalizes `isUrgentHazard` to a strict boolean.
  - Trims all string fields.
  - **Spoofing Guard:** Rejects payloads containing `reporter_id`, `reporterId`, `status`, `confirmed_priority`, `confirmedPriority`, `report_number`, or `reportNumber`.
- `validateAssignmentDeclineInput(input)`:
  - Validates `assignmentId` UUID.
  - Enforces `reason` non-empty with minimum 5 characters and maximum 500 characters, matching PostgreSQL constraint `chk_decline_reason CHECK (status != 'declined' OR (decline_reason IS NOT NULL AND btrim(decline_reason) != ''))`.
- `validateWorkLogInput(input)`:
  - Validates `assignmentId` UUID.
  - Enforces `description` length between 5 and 1000 characters.
  - Enforces `hoursSpent` between 0.1 and 24.0 hours, with a maximum of 2 decimal places to match PostgreSQL column `DECIMAL(5,2)`.
- `validateReportTriageInput(input)`:
  - Validates `reportId` UUID.
  - Enforces canonical `confirmedPriority` enum.
  - Enforces target status restricted to `'under_review' | 'assigned'`.
- `validateTechnicianAssignmentInput(input)`:
  - Validates `reportId` and `technicianId` UUIDs.
  - Enforces optional `notes` maximum length 500 characters.
- `validateStatusTransitionInput(input)`:
  - Validates `reportId` UUID and canonical `targetStatus` enum.
  - Enforces mandatory `reason` (minimum 5 characters) for transitions to `on_hold`, `cancelled`, and `reopened`.
  - Validates optional `assignmentId` UUID when provided.
- `validateVerificationInput(input)`:
  - Validates `reportId` UUID.
  - Normalizes `isSatisfactory` boolean.
  - Enforces mandatory explanatory `notes` (minimum 5 characters) when `isSatisfactory === false` (repair rejected).
- `validateAttachmentMetaInput(input)`:
  - Validates `reportId` UUID.
  - Enforces maximum file size of 10,485,760 bytes (10MB) matching `chk_file_size` and Storage RLS.
  - Enforces MIME types `image/jpeg`, `image/png`, `image/webp` matching `chk_mime_type`.
  - Validates file extensions (`.jpg`, `.jpeg`, `.png`, `.webp`) and filename length <= 255 characters.

### 3. `tests/unit/mutation-validation.test.mjs` (New File — 554 lines)
Contains 12 automated unit test suites exercising every validator:
1. `Enum & Identifier Guards`: Validates UUIDs, case-insensitivity, and all 20 canonical enum values across the 3 enums.
2. `Report Submission (Valid)`: Validates trimmed strings and normalized booleans.
3. `Report Submission (Spoofing Defense)`: Tests rejection of payloads injecting `reporter_id`, `status`, `confirmed_priority`, and `report_number`.
4. `Report Submission (Boundaries)`: Tests 4-char title (fails), 5-char title (passes), 120-char title (passes), 121-char title (fails), control chars (fails), 9-char desc (fails), 10-char desc (passes), 2000-char desc (passes), 2001-char desc (fails).
5. `Report Submission (Malformed Identifiers)`: Tests non-UUID strings and empty strings for foreign keys.
6. `Assignment Decline`: Tests whitespace-only reasons, reasons < 5 chars, reasons > 500 chars, and valid decline text.
7. `Work Log`: Tests negative hours, zero hours, > 24 hours, > 2 decimal places (e.g., 2.345), empty descriptions, and valid decimal hours.
8. `Report Triage`: Tests invalid priorities, unapproved triage statuses, and valid triage transitions.
9. `Technician Assignment`: Tests invalid report and technician UUIDs, note length limits, and valid assignment payloads.
10. `Status Transition`: Tests mandatory reasons for `on_hold`, `cancelled`, and `reopened`, and valid transitions for `in_progress` and `completed`.
11. `Verification`: Tests mandatory notes on unsatisfactory inspection, optional notes on satisfactory inspection, and notes length boundaries.
12. `Attachment Metadata`: Tests file size boundaries (0 bytes, 10,485,760 bytes, 10,485,761 bytes), invalid MIME types (e.g., `application/pdf`, `image/gif`), invalid extensions, and valid image metadata.

---

## 4. Test Execution and Actual Results

All local verification checks completed successfully with zero errors.

### 1. Local Unit Tests (`node --test tests/unit/*.test.mjs`)
```
✔ Finding 1 & Schema: Verified column selection enforces categories!inner join semantics (35.3822ms)
✔ Finding 1: Category filter excludes non-matching reports and handles UUIDs and names (0.6475ms)
✔ Finding 2: Dataset truncation detection prevents silent undercounting of KPI metrics (0.4913ms)
✔ Finding 2: Large dataset KPI aggregation calculates correctly when complete data is provided (40.9823ms)
✔ Finding 3: Deterministic pagination sort applies created_at DESC and id DESC tiebreaker (0.8691ms)
✔ Finding 4: Pagination URL builder preserves status, category, and search filters with encoding (0.6744ms)
✔ Finding 5: Database errors are sanitized and never expose raw SQL or internal details (0.7372ms)
✔ Approved Business Decision 1: Calendar Week in Philippine Standard Time (PST / UTC+8) (0.3927ms)
✔ Approved Business Decision 1: Never substitutes created_at for resolution timestamp (0.5301ms)
✔ Approved Business Decision 2: completed reports count as Total Active, NOT resolved (0.6307ms)
✔ DAL Transformer: Accurately maps joined database row to MaintenanceReport (0.8424ms)
✔ DAL Transformer: Handles nullable confirmed_priority as null (Pending Triage) (0.3546ms)
✔ DAL Transformer: Active assignment priority over historical declined/reassigned rows (0.3166ms)
✔ DAL Transformer: Gracefully falls back when relations are missing or null (0.2779ms)
✔ DAL Facility Breakdown: Accurately groups report counts by campus facility (1.9214ms)
✔ Pagination: Computes bounds and limits correctly (0.6104ms)
✔ Security Guard: Avoidance of service-role credentials in client/user-facing code (1.2392ms)
✔ Read-Only Scope: DAL contains strictly read-only operations (0.6125ms)
✔ Enum & Identifier Guards: Accurately validates UUIDs and canonical database enums (3.9932ms)
✔ Report Submission: Accepts valid submission payload and trims text fields (0.9853ms)
✔ Report Submission: Rejects payloads with spoofed authorization or identity fields (0.7506ms)
✔ Report Submission: Enforces title and description length boundaries and control characters (0.4824ms)
✔ Report Submission: Rejects malformed categoryId and locationId identifiers (0.3575ms)
✔ Assignment Decline: Validates decline reason matching database constraint chk_decline_reason (0.4841ms)
✔ Work Log: Enforces hour limits, precision, and description boundaries (0.623ms)
✔ Report Triage: Validates confirmed priority level and triage status transition (0.6362ms)
✔ Technician Assignment: Validates reportId and technicianId UUIDs with optional notes (0.6069ms)
✔ Status Transition: Enforces mandatory reasons for holds, cancellations, and reopenings (0.7735ms)
✔ Verification: Enforces detailed notes when repair is marked unsatisfactory (0.5257ms)
✔ Attachment Metadata: Validates file size, MIME types, and file extensions per Storage RLS (0.5947ms)
✔ Navigation: Student / Personnel role sees only operational routes (9.8167ms)
...
✔ isUserRole validates all five canonical roles (0.2352ms)
✔ formatRoleLabel maps canonical roles to UI labels (0.2866ms)
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 541.096
```
**Result:** **70/70 passing tests** across 6 test suites. 0 failures.

### 2. TypeScript Compilation (`npx tsc --noEmit`)
```
Exit code: 0
Stdout: (empty)
Stderr: (empty)
```
**Result:** **Clean pass.** All types, imports, and interface definitions are strictly valid.

### 3. ESLint Static Analysis (`npm run lint`)
```
> my-app@0.1.0 lint
> eslint

Exit code: 0
```
**Result:** **Clean pass.** 0 warnings, 0 errors.

### 4. Next.js Turbopack Production Build (`npm run build`)
```
▲ Next.js 16.4.2 (Turbopack)
- Environments: .env.local
✓ Running next.config.ts took 127ms
✓ Compiled successfully in 3.4s
  Running TypeScript ...
  Finished TypeScript in 5.6s ...
✓ Generating static pages using 3 workers (11/11) in 829ms
  Finalizing page optimization ...

Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /analytics
├ ƒ /locations
├ ◐ /login
├ ƒ /reports
├ ƒ /reports/new
├ ƒ /settings
└ ƒ /unauthorized

Exit code: 0
```
**Result:** **Clean pass.** All static and dynamic routes compiled successfully.

---

## 5. Security & Boundary Compliance Verification

| Boundary Requirement | Status | Compliance Details |
| :--- | :--- | :--- |
| **Milestone 1 Scope Only** | **COMPLIANT** | Only `types/mutations.ts`, `utils/reports/validation.ts`, and `tests/unit/mutation-validation.test.mjs` were implemented. No Milestone 2–4 files were touched. |
| **No Database Writes / Mutations** | **COMPLIANT** | No `INSERT`, `UPDATE`, or `DELETE` queries were implemented. Zero mutation functions exist in `utils/reports/dal.ts`. |
| **No Server Actions** | **COMPLIANT** | No Server Actions were created in `actions/reports.ts` or elsewhere. |
| **No UI Form Modifications** | **COMPLIANT** | `app/reports/new/page.tsx` was not modified. No new forms or submit handlers were introduced. |
| **No Remote Supabase Queries** | **COMPLIANT** | No calls to remote Supabase instances. Gate E.4D and `tests/integration/rls-runner.ts` were not executed. |
| **No Schema, RLS, or Migration Changes** | **COMPLIANT** | `supabase/migrations/` was completely untouched. |
| **No Environment / Secret Changes** | **COMPLIANT** | `.env.local` was untouched; no service-role keys were introduced or referenced. |
| **No Git Commits or Pushes** | **COMPLIANT** | Git working tree preserved; no `git commit` or `git push` executed. |
| **Separation of Validation vs Authorization** | **COMPLIANT** | Validators only inspect input structure, constraints, and data types. They do not query profiles, evaluate user roles, or authorize requests. Authorization will be enforced by server-side identity extraction (`auth.uid()`) and PostgreSQL RLS policies in subsequent milestones. |

---

## 6. Unresolved Requirements & Discrepancies

- **None.** All validation limits, bounds, and enum checks directly correspond to deployed database constraints in `supabase/migrations/20261018000001_core_schema.sql` through `20261018000006_storage_setup.sql`.
- Direct assignment from `submitted` to `assigned` is fully supported by the existing schema and coordinator RLS update policies.
- Reassignment status reversion to `assigned` is supported by the schema and lifecycle model.
- Unlimited verification rejections are supported without constraint conflicts.

---

## 7. Next Steps

Milestone 1 is complete. Milestone 2 (**Data Access Layer Mutations: `utils/reports/mutations.ts`**) is ready to begin upon explicit user approval:
1. Create `utils/reports/mutations.ts` wrapping authenticated Supabase client calls for:
   - `createReportRecord()`
   - `triageReport()`
   - `assignTechnician()` (incorporating reassignment status reversion to `assigned`)
   - `declineAssignment()`
   - `transitionReportStatus()`
   - `createWorkLog()`
   - `verifyReport()`
   - `recordStatusHistory()`
2. Add mocked DAL mutation unit tests verifying correct Supabase query construction, payload mappings, and error sanitization.
3. Stop for Milestone 3 approval.
