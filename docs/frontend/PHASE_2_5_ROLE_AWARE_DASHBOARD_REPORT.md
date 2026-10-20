# CMIRS — Phase 2.5: Role-Aware Dashboard & Mock Data Isolation Report

> **Project:** Campus Maintenance & Incident Reporting System (CMIRS)  
> **Phase:** Frontend Phase 2.5 — Role-Aware Dashboard and Mock Data Isolation  
> **Application Root:** `D:\CMIRS-System\my-app`  
> **Date:** October 20, 2026  
> **Status:** Completed & Verified  

---

## 1. Executive Summary

In accordance with user authorization and canonical requirements, **Phase 2.5 (Role-Aware Dashboard and Mock Data Isolation)** has been implemented and locally verified.

Before introducing live report mutations or database queries, Phase 2.5 establishes strict, type-safe role filtering and dashboard isolation on prototype mock data. This guarantees that each authenticated role experiences the system from its authorized institutional perspective, and that report-derived metrics (active counts, triage queues, facility breakdowns, and hazard alerts) strictly compute from visible records without leaking hidden information.

All quality gates have been executed and passed:
- **Unit & Security Tests:** 40/40 passing across 4 suites in ~400ms (`node --test`).
- **TypeScript Typecheck:** `npx tsc --noEmit` passed with 0 errors.
- **ESLint:** `npm run lint` passed with 0 errors and 0 warnings.
- **Production Build:** `npm run build` compiled 11 routes successfully with Next.js 16.4.2 (Turbopack).
- **Security Boundaries:** Strict zero-remote-database adherence; Gate E.4D remains pending and unauthorized.

---

## 2. Canonical Role Matrix & Visibility Logic

The reusable, type-safe filtering helper [`utils/reports/mock-filter.ts`](file:///d:/CMIRS-System/my-app/utils/reports/mock-filter.ts) implements the canonical role visibility specifications matching the database security model ([`20261018000004_security_functions_and_rpc.sql`](file:///d:/CMIRS-System/my-app/supabase/migrations/20261018000004_security_functions_and_rpc.sql#L38-L76)):

| Canonical Role | Dashboard Scope | Filter Rule in `filterMockReportsForRole` | Information Leakage Prevention |
| :--- | :--- | :--- | :--- |
| `student_personnel` | Own Submissions Only | Matches `reporterId === user.id`, `reporterEmail === user.email`, or `reporterName === user.profile.full_name`. | KPI statistics, facility counts, and report queues strictly reflect the student's own requests. Reports from other users are completely excluded. |
| `technician` | Assigned Work Orders + Own Submissions | Matches `assignedTechnicianId === user.id`, `assignedTechnicianEmail === user.email`, or `assignedTechnician === user.profile.full_name` (excluding `assignmentStatus === 'declined'` or report `status === 'cancelled'`), plus own submissions. | Technicians only see work dispatched to them or submitted by them; other technician queues and unassigned triage reports remain concealed. |
| `coordinator` | Campus-Wide Operational Triage | Returns all campus reports across facilities. | Can view all reports for intake triage, technician dispatch, priority reassessment, and verification. |
| `administrator` | Campus-Wide Oversight & Governance | Returns all campus reports across facilities. | Full system oversight including audit trails, configuration, and facility analytics. |
| `management` | Campus-Wide Read-Only Monitoring | Returns all campus reports across facilities. | High-level read-only operational oversight and institutional reporting. |
| *Unauthenticated / Inactive* | Fails Closed (Empty) | If `user === null` or `user.profile.is_active === false`, immediately returns `[]`. | Zero reports leaked to unauthenticated sessions or deactivated accounts. |

---

## 3. The Mock Data Gap & Explicit Isolation Strategy

### 3.1 Gap Analysis
The prototype mock data in [`data/mock-reports.ts`](file:///d:/CMIRS-System/my-app/data/mock-reports.ts) was created during Phase 1 for visual layout purposes. It contained display strings (`reporterName: "Dr. Robert Chen"`, `assignedTechnician: "Marcus Vance"`) but lacked relational UUID foreign keys (`reporter_id`, `technician_id`, `reporter_email`, `assigned_technician_email`) mapping to the provisioned test users (`test-student@cmirs.internal`, `test-technician@cmirs.internal`, etc.).

### 3.2 Explicit, Safe Strategy
In accordance with instructions:
1. **No Artificial Identities Fabricated:** We did NOT invent fake user accounts or fabricate synthetic identities to pretend that Phase 1 mock records belong to the test accounts.
2. **Type-Safe Domain Extension:** Extended `MaintenanceReport` in [`types/reports.ts`](file:///d:/CMIRS-System/my-app/types/reports.ts) with optional relational fields:
   - `reporterId?: string`
   - `reporterEmail?: string`
   - `assignedTechnicianId?: string`
   - `assignedTechnicianEmail?: string`
   - `assignmentStatus?: 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'reassigned' | 'cancelled' | 'declined'`
3. **Multi-Field Matching:** `filterMockReportsForRole()` checks UUID (`reporterId`), email (`reporterEmail`), and name (`reporterName`) so that when live data is connected, UUID matching takes immediate precedence while mock fixtures can test all matching paths.
4. **Honest Empty States:** When an account (such as `test-student@cmirs.internal`) logs in and has no authored reports in the mock dataset, the filter safely returns `[]` (empty array). The dashboard displays a role-specific empty state with a "Submit a Maintenance Report" action button rather than leaking unowned reports.

---

## 4. Dashboard Presentation & Leakage Prevention

### 4.1 Statistics Derivation (`calculateRoleDashboardStats`)
Dashboard KPI cards and metric summaries are calculated **strictly from the role-filtered report array**:
```typescript
const filteredReports = filterMockReportsForRole(MOCK_REPORTS, user);
const stats = calculateRoleDashboardStats(filteredReports);
```
- **Total Active:** Counts only active reports visible to the current role.
- **Pending Review / Triage:** Computed from visible reports; for students this shows only their own pending submissions; for technicians it shows their assigned intake.
- **In Progress:** Only repairs within the user's view scope.
- **Resolved:** Only completions within the user's view scope.
- **Urgent Hazards:** Flags hazards within the user's view scope.
- **Zero Leakage:** If a student has 0 reports, all 4 KPI cards display `0`. They never observe the coordinator's campus-wide active count.

### 4.2 Facility Breakdown Isolation (`getFacilityBreakdown`)
The facility breakdown sidebar widget groups and counts reports strictly from `filteredReports`. Facilities containing reports not visible to the current role are never displayed.

### 4.3 Role Perspective UI Indicators
- **Mock Data Disclosure Banner:** Preserved at the top of the dashboard, displaying the active user's verified role and perspective scope (e.g., `Viewing Scope: Student / Personnel (Own Submissions Only)` or `Viewing Scope: Maintenance Technician (Assigned Work Orders)`).
- **Dynamic Greetings:** `getRoleDashboardConfig` tailors the welcome message, card titles, and table headers to each role's responsibilities:
  - Student: *"My Incident & Maintenance Submissions"* / *"My Active Reports"*
  - Technician: *"My Assigned Work Orders"* / *"Assigned Tasks"*
  - Coordinator / Admin / Management: *"Recent Campus Reports"* / *"Total Active"*

---

## 5. Summary of Files Changed

| File Path | Type | Nature of Change |
| :--- | :--- | :--- |
| [`types/reports.ts`](file:///d:/CMIRS-System/my-app/types/reports.ts) | Modified | Added `AssignmentStatus` union type and optional relational fields (`reporterId`, `reporterEmail`, `assignedTechnicianId`, `assignedTechnicianEmail`, `assignmentStatus`) to `MaintenanceReport`. |
| [`utils/reports/mock-filter.ts`](file:///d:/CMIRS-System/my-app/utils/reports/mock-filter.ts) | Created | Implemented `filterMockReportsForRole()`, `calculateRoleDashboardStats()`, `getRoleDashboardConfig()`, and `getFacilityBreakdown()`. Enforces fail-closed isolation on unauthenticated/inactive users. |
| [`data/mock-reports.ts`](file:///d:/CMIRS-System/my-app/data/mock-reports.ts) | Modified | Re-exported filter helpers for convenience across dashboard consumers. |
| [`components/dashboard/report-list.tsx`](file:///d:/CMIRS-System/my-app/components/dashboard/report-list.tsx) | Modified | Added `userRole`, `emptyTitle`, `emptyDescription` props. Implemented role-aware empty states with Next.js `useRouter` navigation to `/reports/new` for students. |
| [`app/page.tsx`](file:///d:/CMIRS-System/my-app/app/page.tsx) | Modified | Integrated server-side role filtering, derived KPI stats, role-perspective badge in the disclosure banner, dynamic card titles, and role-scoped sidebar widgets. |
| [`tests/unit/role-mock-filtering.test.mjs`](file:///d:/CMIRS-System/my-app/tests/unit/role-mock-filtering.test.mjs) | Created | Added 12 unit tests verifying all 5 canonical roles, ownership matching, assignee matching, declined work order exclusion, inactive account fail-close, stats zero-leakage, and greeting configs. |

---

## 6. Verification & Quality Gates

### 6.1 Automated Unit & Security Test Suites
Ran all 4 test suites via Node.js native test runner:
```bash
node --test tests/unit/validation.test.mjs tests/unit/security-boundaries.test.mjs tests/unit/navigation-and-shell.test.mjs tests/unit/role-mock-filtering.test.mjs
```
**Results:**
- Total tests: **40**
- Passing: **40**
- Failing: **0**
- Execution time: **~372ms**

#### Specific Role-Filtering Tests Covered:
1. `Filter: Student Personnel sees only own submissions` (matches `reporterId`)
2. `Filter: Student Personnel matching by email fallback` (matches `reporterEmail`)
3. `Filter: Student Personnel with no matching reports returns empty array (empty result)`
4. `Filter: Technician sees assigned work orders + own submissions` (excludes `declined` assignments)
5. `Filter: Technician with no assigned work and no submissions returns empty array`
6. `Filter: Coordinator role sees all campus-wide reports`
7. `Filter: Administrator role sees all campus-wide reports`
8. `Filter: Management role sees all campus-wide reports`
9. `Filter: Unauthenticated or inactive users fail closed (empty result)`
10. `Statistics Consistency: Derived strictly from visible reports with zero leakage`
11. `Facility Breakdown: Aggregates counts strictly from visible reports`
12. `Dashboard Configuration: Generates role-appropriate greeting and KPI card labels`

### 6.2 TypeScript Static Typecheck
```bash
npx tsc --noEmit
```
**Result:** Code 0. Zero TypeScript errors across all components, utilities, and page routes.

### 6.3 ESLint
```bash
npm run lint
```
**Result:** Code 0. Zero errors, zero warnings.

### 6.4 Next.js Production Build
```bash
npm run build
```
**Result:** Code 0. Successfully compiled with Turbopack in 16.3s. All 11 application routes collected, rendered, and optimized without defects:
- `/` (Dynamic Server-Rendered)
- `/_not-found` (Static)
- `/analytics` (Dynamic Server-Rendered)
- `/locations` (Dynamic Server-Rendered)
- `/login` (Partial Prerender)
- `/reports` (Dynamic Server-Rendered)
- `/reports/new` (Dynamic Server-Rendered)
- `/settings` (Dynamic Server-Rendered)
- `/unauthorized` (Dynamic Server-Rendered)

---

## 7. Explicit Protection & Boundary Confirmations

1. **NO remote Supabase requests or CLI commands** were executed.
2. **NO database schemas, RLS policies, migrations, seed scripts, or accounts** were modified.
3. **NO environment files** (`.env`, `.env.local`) were modified.
4. **NO dependencies** were installed, removed, or changed.
5. **Gate E.4D** remains strictly **PENDING AND UNAUTHORIZED**.
6. **Zero secrets, tokens, or passwords** were logged or exposed.
7. **NO Git commits or pushes** were performed.

---

## 8. Remaining Limitations & Next Steps

1. **Mock Data Baseline:** As documented, the static `MOCK_REPORTS` list contains a fixed set of sample reports. Because test accounts provisioned in auth do not have authoring history in the legacy mock data, their filtered dashboard displays empty states until reports are authored or live database queries are connected.
2. **Phase 3 Preparation:** When report submission (`/reports/new`) and live Supabase queries are enabled in Phase 3, `filterMockReportsForRole` can serve as a client-side/SSR filter for optimistic updates, while database RLS policies enforce security at the persistence tier.

Phase 2.5 is complete. Awaiting explicit user instruction before proceeding to subsequent stages.
