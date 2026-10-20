# CMIRS — Phase 4B Readiness Report

**Phase:** 4B — Locations, Analytics, and Settings  
**Audit date:** 2026-10-20  
**Scope:** Read-only local repository audit. No Supabase request, Storage operation, RPC call, migration, policy change, dependency installation, build, or deferred RLS runner was executed.

## Executive Summary

The application has a sound server-rendered authentication and authorization foundation, established RLS-backed read helpers, responsive shared UI primitives, and the data required for a first read-only Locations directory and a bounded, RLS-scoped operational analytics view. The `/locations`, `/analytics`, and `/settings` routes themselves are still Phase 2 placeholders.

Phase 4B can safely begin with authenticated, read-only implementation using the existing server-side Supabase client and `requireAuth` / `requireRole` helpers. Full role management and notification preferences must not be implemented under the current constraints: role changes cannot be made atomically with their required audit record through an existing RPC or database trigger, and notification-preference storage does not exist. SLA compliance and preventative-maintenance trend reporting also lack authoritative source data.

## Audit Method and Repository State

- Read `AGENTS.md`, `package.json`, the current pages, navigation, shared UI, authentication helpers, report DAL/types/transforms, migrations, RLS policies, unit-test inventory, and Phase 3 through Phase 4A reports.
- `AGENTS.md` contains the Next.js 16 guidance applicable to future code changes.
- `package.json` provides `dev`, `build`, `start`, and `lint`; there is no package test script. Existing unit tests run through Node's test runner.
- The working tree already contained the Phase 4A implementation changes and report when this audit began. They were not edited as part of this audit.
- This report is the only Phase 4B audit artifact created. No remote environment was contacted.

## Existing Implementation Status

### Locations

**Route:** `app/locations/page.tsx`

- The route calls `requireAuth('/locations')`, so every authenticated role may access it.
- It currently renders a static “Campus Facilities Directory” placeholder and a dashboard return link; it does not retrieve or display locations.
- The sidebar navigation exposes Locations to every defined role, but marks it as `isPlaceholder: true` with a legacy “Phase 2” badge.
- `utils/reports/dal.ts` already has `getActiveLocations`, and `types/reports.ts` has `LocationOption`; the report submission flow therefore already has an established location shape and RLS-backed read pattern.
- The schema supports a directory record: `building_name`, optional `floor`, `room`, `description`, and `is_active`.

**Safe implementation now**

- Replace the placeholder with an authenticated directory of active locations, including search/filtering performed locally on the RLS-visible response.
- Use the existing authenticated server-side Supabase client and a narrow locations DAL function. The all-user view must request only active locations; it must not infer inactive records from missing rows.
- An optional location usage count may be computed only from reports visible to the current user. It must be labelled as the viewer's accessible data, not as a campus-wide total for restricted roles.

**Existing policy capability, requiring an explicit product decision**

- Coordinators and administrators may insert and update categories and locations under current RLS. The same policies let coordinators, administrators, and management read inactive reference records.
- A location/category editor could therefore be added without policy changes, but it is not present today. Its placement is unresolved: `/locations` is visible to all roles, while `/settings` is administrator-only even though the RLS permits coordinators to manage those records. Do not expose a coordinator-allowed capability only through an administrator-only route without confirming the intended product authorization model.
- There is no delete policy; deactivation through `is_active` is the appropriate existing-data lifecycle. The locations table has no unique campus/building/floor/room constraint, so a future editor needs duplicate prevention in validation and a documented residual race risk.

### Analytics

**Route:** `app/analytics/page.tsx`

- The route correctly enforces `requireRole(['coordinator', 'administrator', 'management'], '/analytics')` but renders only a static placeholder.
- Navigation has the same role restriction and legacy placeholder marker. Existing route-authorization/navigation unit tests cover these role assignments.
- The dashboard already uses `getDashboardKpiStats`, `getReportsQueue`, `calculateKpiStatsFromDbReports`, and `getFacilityBreakdownFromReports`. The former demonstrates a truncation safeguard; the latter is useful only for the rows supplied to it and must not be presented as a global result when fed a paginated queue.
- Current report data provides status, confirmed priority, urgent-hazard flag, category, location, timestamps, assignments, work logs, and verifications. These support operational distributions and workload views when retrieved through the authenticated client and current RLS scope.

**Safe implementation now**

- Build a server-rendered analytics page for the existing oversight roles using read-only DAL queries and pure aggregation transforms.
- Initially support visible-report totals and distributions by status, priority, urgency, category, and location, plus current assignment workload. The UI should explicitly handle no accessible rows and any incomplete/truncated data set.
- Fetch with an exact count and reject or clearly degrade aggregate presentation when the query limit cannot represent the entire RLS-visible data set. Do not reuse a dashboard preview page as analytics input.
- Resolution duration may be considered only after the DAL selects an authoritative verification timestamp and tests establish the intended definition. `reports.updated_at` is not an authoritative resolution-time field.

**Not supportable from the existing data model**

- SLA/on-time compliance: no SLA target, response target, or category/location threshold is stored.
- Preventative-maintenance trends: there is no scheduled-maintenance, maintenance-plan, or recurrence data model.
- Campus-wide claims for a role whose RLS scope is restricted: all analytics must reflect the authenticated role's visible data only.

### Settings

**Route:** `app/settings/page.tsx`

- The route correctly enforces `requireRole(['administrator'], '/settings')` but is a static placeholder.
- Navigation exposes Settings only to administrators and marks it as a placeholder.
- The authenticated profile is already loaded by `getCurrentUserAndProfile`. The `profiles` table contains email, name, role, phone, active state, and timestamps; administrators can read profiles under RLS.
- `role_change_audit` exists and is append-only by policy. Administrators may read and insert audit rows; administrators may update other profiles but cannot update their own role.

**Safe implementation now**

- Provide an administrator-only, read-only settings overview: current administrator account information, a role-labelled user directory sourced through RLS, and (if useful) a read-only role-audit history. These require new narrow DAL functions but no schema or policy change.
- Surface category/location configuration status read-only until the product owner decides whether coordinator-authorized maintenance belongs under Locations or Settings.

**Blocked features**

- **Role assignment/change UI:** the schema and policies permit an administrator to update another profile and separately insert an audit row, but there is no existing transaction-capable RPC or database trigger that guarantees both occur atomically. Implementing two client/server action calls could leave an unlogged role change. Do not implement this feature without an approved atomic database mechanism; this audit does not create one.
- **Notification preferences:** the notifications table stores delivered notifications, not per-user preference settings. No preference fields or table were found. This feature requires a schema/policy decision and is also outside the permitted Phase 4C scope.
- **User creation/deactivation workflow:** no existing application workflow or supporting DAL/validation was found. Deactivation is a privileged profile mutation and must not be introduced incidentally with the read-only page.

## Reusable Foundation

| Area | Existing reusable functionality |
|---|---|
| Authentication | `utils/auth/server.ts` provides `getCurrentUserAndProfile`, `requireAuth`, and `requireRole`; it fails closed for missing or inactive profiles. |
| Data access | `utils/reports/dal.ts` uses the authenticated server-side Supabase client and already exposes active categories/locations, report queues, KPI data, and report details. |
| Data transforms | `utils/reports/transform.ts` has report mapping, KPI and facility-breakdown transforms, timezone helpers, and `isDatasetTruncated`. |
| Types | `types/auth.ts` defines the five roles; `types/reports.ts` contains report, category, location, technician, and KPI types. |
| UI | `AppShell`, `Card`, `Button`, `EmptyState`, `StatCard`, badges, icons, and dashboard/report components establish responsive and accessible presentation conventions. |
| Authorization tests | Existing unit tests cover navigation visibility and server-side page route role requirements. |

No Analytics- or Settings-specific DAL, transform, type, or UI component currently exists. New functionality should extend these patterns rather than embed Supabase access in client components or duplicate the report DAL's authorization logic.

## Security and Authorization Considerations

- Keep each page server-rendered and authenticate before querying. Use only the existing authenticated server-side client; do not use a service-role client or client-supplied role assertion.
- Treat RLS as the authoritative row scope. Do not fetch unrestricted data and filter it in application code.
- Preserve page guards: Locations for authenticated users; Analytics for coordinator/administrator/management; Settings for administrators.
- Query the least fields necessary, especially in a profile directory and audit view. Never include credentials, tokens, or `.env.local` contents in code, tests, reports, or output.
- Reference-data write policies currently allow coordinators and administrators, whereas Settings navigation is administrator-only. Resolve this authorization/product mismatch before enabling configuration writes.
- Do not run the deferred RLS integration runner as part of Phase 4B. Local mocks and pure-transform tests are sufficient for implementation validation under the stated boundaries.

## Recommended Implementation Order

### 1. Shared Read-only Data Foundation

Create narrow Phase 4B types, authenticated DAL functions, and pure transforms for locations and analytics. Preserve existing report DAL behavior; add exact-count/truncation handling for aggregates.

**Acceptance criteria**

- Every query begins after the established server-side auth/role guard and uses the authenticated client.
- No remote operation, RPC, service role, migration, policy change, or client-side authorization bypass is introduced.
- Aggregates are not rendered as complete when the RLS-visible source set is incomplete.

### 2. Locations Directory

Replace the placeholder with an all-authenticated-user active-location directory. Use existing cards, empty states, responsive layout, and plain local filtering. Defer create/edit/deactivate actions until the product decision on coordinator versus administrator management placement.

**Acceptance criteria**

- All authenticated roles can view only RLS-visible active locations.
- Unauthenticated access redirects through `requireAuth`.
- Empty, unavailable, and search-no-match states do not expose fallback/private location data.
- The navigation entry is no longer marked as a placeholder only when the route is implemented.

### 3. Oversight Analytics

Replace the placeholder with RLS-scoped status/priority/urgency/category/location distributions and current workload metrics. Use semantic tables or CSS-based bars with existing components; do not install a chart dependency without approval.

**Acceptance criteria**

- Only coordinator, administrator, and management can reach the route.
- Totals reconcile to the complete, RLS-visible source rows used by the page.
- Empty and truncation/degradation states are explicit.
- No fabricated SLA, preventative-maintenance, or global claims are shown.

### 4. Administrator Settings Read View

Replace the placeholder with a read-only account/system overview and, if the queried fields are approved, RLS-backed profile directory and role-audit history. Keep role mutation, notification preferences, and user lifecycle controls disabled and visibly documented as unavailable rather than partially implemented.

**Acceptance criteria**

- Only administrators can reach the route.
- The page is read-only and requests no more profile/audit data than it displays.
- No role update can occur without an approved atomic audit mechanism.
- No notification-preference controls are shown without a supporting schema/policy decision.

### 5. Deferred Configuration Writes (Only After Product Confirmation)

If the product owner confirms the intended location/category management role and route, add server actions with explicit role checks, validation, error states, and soft-deactivation only. This work is intentionally not included in the initial read-only pass.

**Acceptance criteria**

- The chosen UI access matches existing RLS exactly or the discrepancy is resolved by an approved future policy decision.
- Inputs validate names and optional location fields; duplicate location risk is communicated because the database has no unique location key.
- No hard delete is introduced.

## Local Test Plan for an Approved Implementation

1. Add pure-transform unit fixtures for empty data, status/priority/urgency distributions, location/category totals, assignment workload, and truncation refusal/degradation.
2. Add mocked authenticated DAL tests asserting the requested fields, active-only location filter, role-aware inactive handling where applicable, exact counts, and error mapping. Do not invoke Supabase remotely.
3. Extend route/navigation authorization tests for page guards and visibility across all five roles.
4. Add component tests, where the current local test setup supports them, for loading/error/empty/degraded states and responsive-safe content without adding dependencies.
5. Run the affected local Node unit tests, `npx tsc --noEmit`, and `npm run lint` after implementation. Do not run the deferred RLS runner, remote integration tests, Storage operations, or a production build unless separately requested.

## Limitations and Unresolved Questions

- Confirm whether Phase 4B intends a read-only facilities directory first or also immediate coordinator/administrator location/category maintenance.
- Confirm whether management should see only analytics (current navigation) or also a read-only settings/audit view (current RLS allows audit reads but the application route does not).
- Define an approved atomic role-change mechanism before role editing is planned; a client/server two-step update plus audit insert is insufficient.
- Define notification-preference requirements and approve supporting schema/policies before that UI is designed.
- Define formal SLA targets and preventative-maintenance data requirements before requesting compliance or trend analytics.
- This audit intentionally did not verify live data volume, real-world data completeness, or remote policy behavior; those remain for the separately controlled integration phase.

## Conclusion

Proceed with the read-only Phase 4B foundation, Locations directory, and RLS-scoped oversight analytics after approval. Implement only the administrator Settings read view in this phase. Keep role changes, notification preferences, SLA claims, preventative-maintenance trends, and unconfirmed configuration writes out of scope until their dependencies are approved.
