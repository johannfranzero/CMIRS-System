# CMIRS — User Roles and Permissions

> **Status:** This document describes the role-based access control design for CMIRS and is the
> normative reference for the implemented permissions. The controls are implemented in the
> application (Server Actions, route guards, navigation) and in PostgreSQL Row Level Security.
> It was updated on 2026-10-21 (Phase 4H) to record the withdrawal of PD-R6: only
> **Student / School Personnel** and **Maintenance Coordinator** may file a maintenance report.
> Where this document and `docs/database-design/OPEN_DECISIONS.md` disagree, the decision
> register records the current state of each decision.

## Table of Contents

- [Overview](#overview)
- [Role Definitions](#role-definitions)
  - [Student / School Personnel](#student--school-personnel)
  - [Maintenance Coordinator](#maintenance-coordinator)
  - [Maintenance Technician](#maintenance-technician)
  - [School Administrator](#school-administrator)
  - [School Management](#school-management)
- [Role Assignment](#role-assignment)
- [Role-Permission Matrix](#role-permission-matrix)
- [Verification Restrictions](#verification-restrictions)
- [Access Control Principles](#access-control-principles)
- [Pending Decisions](#pending-decisions)

## Overview

CMIRS uses role-based access control (RBAC) to govern what each user can do within the system. Every authenticated user is assigned exactly one role. Permissions are determined by role, not by individual user configuration.

### Design Principles

- **Least privilege:** Users receive only the permissions necessary for their role.
- **Safe defaults:** New registrations receive a restricted default role until an administrator assigns the appropriate role (D1).
- **No self-elevation:** Users cannot change their own role or grant themselves additional permissions.
- **Separation of duties:** The person who performs a repair should not be the one who verifies its completion (D2).
- **Server-side enforcement:** All permission checks must be enforced on the server. Hiding UI elements is not sufficient authorization. See [SECURITY.md](SECURITY.md).

## Role Definitions

### Student / School Personnel

The primary reporters in the system. Any campus community member who identifies a maintenance issue or safety hazard.

**Responsibilities:**

- Submit maintenance and incident reports with descriptions, category, location, and optional photos (D4).
- Flag reports as urgent hazards when immediate attention may be required (D3).
- Track the status of their own submitted reports.
- Add comments to their own reports for clarification or updates.
- Receive in-app notifications about status changes on their reports (D7).

**Restrictions:**

- Cannot view reports submitted by other users (except as permitted by future policy decisions).
- Cannot assign technicians or change report priority.
- Cannot verify completed repairs.
- Cannot manage user accounts or roles.
- **Cannot file a new maintenance report** (Phase 4H, 2026-10-21). A Maintenance Coordinator can
  raise a report on the user's behalf.

### Maintenance Coordinator

The operational manager who triages incoming reports, assigns work, and verifies completed repairs.

**Responsibilities:**

- View all submitted reports across the system.
- Review incoming reports and confirm or adjust their priority classification.
- Confirm or downgrade a reporter's urgent-hazard flag to an appropriate coordinator-confirmed priority level (D3).
- Assign reports to Maintenance Technicians.
- Reassign reports to different technicians when necessary.
- Monitor work progress and assignment status.
- **Verify completed repairs** — the designated verification authority (D2).
- Reopen reports that fail verification.
- Add comments to any report.
- Receive in-app notifications for new submissions, completed work, and items requiring verification (D7).

**Restrictions:**

- Cannot manage user accounts or roles.
- Cannot delete reports.
- See [Verification Restrictions](#verification-restrictions) for self-verification rules.

### Maintenance Technician

The field worker who performs inspections and repairs.

**Responsibilities:**

- View reports assigned to them.
- Update the status of their assigned work (e.g., mark as in progress, completed).
- Log work performed, including time spent and description of repairs.
- Add comments to assigned reports.
- Receive in-app notifications for new assignments and status changes (D7).

**Restrictions:**

- Cannot verify their own completed work (verification is the Coordinator's responsibility per D2).
- Cannot assign or reassign reports.
- Cannot change report priority.
- Cannot manage user accounts or roles.
- Cannot delete reports.
- **Cannot file a new maintenance report** (Phase 4H, 2026-10-21). A Maintenance Coordinator can
  raise a report on the user's behalf.
- Visibility of reports assigned to other technicians is a **pending decision** (PD-R1).

### School Administrator

The system administrator responsible for user management and role assignment.

**Responsibilities:**

- View and manage user accounts.
- **Assign and change user roles** after registration (D1).
- View system configuration and user activity.
- View all reports for administrative purposes.

**Restrictions:**

- Cannot verify repairs (unless also assigned a Coordinator role — role overlap is not currently planned).
- Cannot assign technicians to reports (operational function belongs to Coordinators).
- Cannot elevate their own role beyond what was assigned to them by another administrator.
- **Cannot file a new maintenance report** (Phase 4H, 2026-10-21).

### School Management

Oversight role for campus leadership who need visibility into maintenance operations.

**Responsibilities:**

- View all reports and their current status.
- View summary statistics, trends, and analytics.
- View verification and completion records.
- Monitor response times and workload distribution.

**Restrictions:**

- **Read-only access** to reports and data. Cannot create, modify, assign, or verify reports.
- Cannot manage user accounts or roles.
- **Cannot file a new maintenance report** (Phase 4H, 2026-10-21).

## Role Assignment

### Account Provisioning Flow

Public self-registration is **disabled**. There is no sign-up form and no self-service
password recovery in the application.

1. An administrator creates the account in the **Supabase dashboard** (Authentication → Users →
   Add user) and confirms the e-mail.
2. The `handle_new_user` trigger creates the matching `public.profiles` row automatically with
   the **default role**: Student / School Personnel.
3. The account appears immediately in the **administrator directory** in `/settings`, together
   with its real authentication-linkage status.
4. A **School Administrator** assigns the appropriate role and activation state.
5. The user's permissions update to reflect their new role, and the change is written to the
   append-only `public.role_change_audit` trail.

### Role Change Rules

- Only a School Administrator can change a user's role.
- Role changes take effect immediately.
- A user cannot change their own role — an administrator cannot alter their own account at all,
  including its activation state.
- Every role change is logged to the audit trail in the same transaction as the change, with a
  mandatory written reason.
- The audit trail is readable by administrators and management, and is append-only: no role
  other than the database owner can modify or delete an entry.

### Default Role Rationale

The default role (Student / School Personnel) is the most restricted operational role. This ensures that:

- New users can immediately submit reports without waiting for administrator action.
- No elevated permissions are granted until explicitly authorized.
- The system remains secure even if administrator review is delayed.

## Role-Permission Matrix

| Permission | Student / Personnel | Coordinator | Technician | Administrator | Management |
|---|:---:|:---:|:---:|:---:|:---:|
| **Reports** | | | | | |
| Submit new report | ✅ | ✅ | — | — | — |
| Flag as urgent hazard | ✅ | ✅ | ✅ | — | — |
| View own reports | ✅ | ✅ | ✅ | ✅ | ✅ |
| View all reports | — | ✅ | ⚠️ | ✅ | ✅ |
| Add comments (own reports) | ✅ | ✅ | ✅ | — | — |
| Add comments (any report) | — | ✅ | — | — | — |
| Add comments (assigned reports) | — | — | ✅ | — | — |
| **Priority and Triage** | | | | | |
| Confirm / adjust priority | — | ✅ | — | — | — |
| Confirm urgent-hazard flag | — | ✅ | — | — | — |
| **Assignment** | | | | | |
| Assign technician | — | ✅ | — | — | — |
| Reassign technician | — | ✅ | — | — | — |
| **Work and Status** | | | | | |
| Update work status | — | — | ✅ | — | — |
| Log work performed | — | — | ✅ | — | — |
| Mark as completed | — | — | ✅ | — | — |
| **Verification** | | | | | |
| Verify completed repair | — | ✅ | — | — | — |
| Reopen after failed verification | — | ✅ | — | — | — |
| **User Management** | | | | | |
| View user accounts | — | — | — | ✅ | — |
| Assign / change user roles | — | — | — | ✅ | — |
| **Analytics and Reporting** | | | | | |
| View summary statistics | — | ✅ | — | — | ✅ |

**Legend:**

- ✅ = Permitted
- — = Not permitted
- ⚠️ = **Pending decision** — see PD-R1 in [Pending Decisions](#pending-decisions)

## Verification Restrictions

Per confirmed decision D2, a **designated Maintenance Coordinator** verifies completed repairs. The following restrictions apply:

1. A Maintenance Technician **cannot** verify work they performed. The technician marks a repair as `completed`; a Coordinator performs verification.
2. A reporter **cannot** verify the repair on their own report, even if they hold a Coordinator role.
3. Whether a Coordinator can verify a report they themselves submitted is a **pending decision** (PD-R4).

These restrictions enforce separation of duties and ensure independent quality assurance.

## Access Control Principles

1. **Server-side enforcement is mandatory.** Every API endpoint and server action must validate the user's role and permissions. Client-side checks (hiding buttons, disabling links) improve user experience but do not constitute security. See [SECURITY.md](SECURITY.md).

2. **Role checks at every access point.** Middleware, API routes, and server components must independently verify authorization. Do not rely on a single checkpoint.

3. **Deny by default.** If a permission is not explicitly granted to a role, it is denied.

4. **Database-level enforcement.** PostgreSQL Row Level Security (RLS) policies must enforce role-based access at the database layer, providing defense in depth. See [DATABASE.md](DATABASE.md) and [SECURITY.md](SECURITY.md).

5. **Audit trail.** Role assignments, role changes, and permission-sensitive actions should be logged for accountability.

## Pending Decisions

The following decisions have not been finalized. They are recorded here to ensure they are addressed before implementation. Recommendations are included but **must not be treated as approved requirements**.

| ID | Decision | Affects | Recommendation |
|---|---|---|---|
| PD-R1 | Can technicians see reports assigned to other technicians? | Technician visibility scope, RLS policies on `reports`, query filters | Recommend restricting to own assignments for least privilege. Coordinators can provide necessary context when needed. |
| PD-R2 | Can technicians decline an assignment? | Assignment workflow, `assignment_status` enum, reassignment rules | Recommend allowing decline with a required reason, triggering coordinator reassignment. |
| PD-R3 | Can technicians request or initiate work holds? | Work-hold workflow, status transitions, `report_status` values | Recommend allowing technician-initiated holds with a required reason, subject to coordinator review. |
| PD-R4 | Can a Coordinator verify a report they themselves submitted? | Separation of duties, verification constraints, RLS policies | Recommend prohibiting self-verification to maintain independence. A different coordinator should verify. |
| PD-R5 | Can submitters cancel their own reports after assignment? | Cancellation workflow, status transitions, reporter authority | Recommend allowing reporter cancellation only before assignment. After assignment, require coordinator approval. |
| PD-R6 | Can Administrator and Management roles submit reports? | Role-permission matrix, `reports` insert policy | **Resolved 2026-10-21 (Phase 4H).** PD-R6 ("all authenticated roles may submit") is **withdrawn**: only Student / School Personnel and Maintenance Coordinator may file a maintenance report. Enforced on the server (`submitReportAction`, the `/reports/new` route). **Database-layer enforcement was claimed but was not in effect.** The production readiness audit of 2026-10-22 confirmed that migration `20261021000014_restrict_report_submission_roles.sql` had **not** been applied, and that the SECURITY DEFINER command `public.submit_report_with_notifications(...)` — which bypasses RLS — performed **no** reporter-role check. Two migrations now carry the database-layer enforcement and both require explicit owner authorization before they are applied: `…014` (the RLS policy) and `…015` (a BEFORE INSERT trigger on `public.reports` that closes the command path as well). The Maintenance Technician may not file a report; a Coordinator can raise one on the user's behalf. |

---

*This document is part of Phase 0 project documentation. See [README.md](../README.md) for project overview and links to other documents.*
