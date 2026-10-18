# CMIRS — Security Architecture

> **Status:** This document describes the **planned** security architecture for CMIRS. No security controls, authentication, authorization policies, or Row Level Security rules have been implemented yet. All items described here are design requirements for future implementation. Do not treat any control as verified until it has been implemented and tested.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Role-Based Access Control](#role-based-access-control)
- [Server-Side Authorization](#server-side-authorization)
- [PostgreSQL Row Level Security](#postgresql-row-level-security)
- [Supabase Storage Security](#supabase-storage-security)
- [Environment Variables and Secrets](#environment-variables-and-secrets)
- [Input Validation](#input-validation)
- [File Upload Validation](#file-upload-validation)
- [Auditability and Status History](#auditability-and-status-history)
- [Security Testing Requirements](#security-testing-requirements)
- [Pending Decisions](#pending-decisions)

## Overview

CMIRS security is built on multiple layers of defense. No single layer is sufficient on its own — each layer reinforces the others.

### Core Principle

> **Hiding a UI element is not authorization.** Removing a button from the interface or redirecting a user from a page does not prevent them from accessing the underlying data or performing the action through direct API calls. All authorization must be enforced on the server and at the database level.

### Security Layers

| Layer | Technology | Purpose |
|---|---|---|
| Authentication | Supabase Auth | Verify user identity |
| Application Authorization | Next.js Middleware + Server Components | Enforce role-based access in the application |
| Database Authorization | PostgreSQL Row Level Security (RLS) | Enforce data access rules at the database level |
| Storage Security | Supabase Storage Policies | Control access to uploaded files |
| Input Validation | Application-level + Database constraints | Prevent malformed or malicious data |
| Audit Trail | `report_status_history`, `verifications` tables | Record all security-relevant actions |

## Authentication

### Planned Implementation

CMIRS will use **Supabase Auth** for user authentication. Supabase Auth provides:

- Email/password registration and login.
- Session management with JWT tokens.
- Integration with the Supabase client library for automatic token handling.

### Authentication Flow

1. User registers with email and password via Supabase Auth.
2. A `profiles` record is created with the default role `student_personnel` (D1).
3. User logs in and receives a session token (JWT).
4. The Supabase client automatically includes the JWT in all database requests.
5. RLS policies use the JWT claims to determine access.

### Session Security Requirements

- Sessions must be managed server-side using `@supabase/ssr` (once installed) to prevent token exposure.
- Tokens must be stored in HTTP-only cookies, not in `localStorage` or `sessionStorage`.
- Session refresh must be handled automatically by the Supabase client.
- Expired sessions must redirect to the login page.

### Authentication Rules

- All pages except the login and registration pages require authentication.
- Unauthenticated requests to protected API routes must return `401 Unauthorized`.
- Supabase Auth handles password hashing, rate limiting on auth endpoints, and token validation.

## Role-Based Access Control

### RBAC Design

User permissions are determined by the `role` field in the `profiles` table. See [ROLES.md](ROLES.md) for the complete role definitions and [Role-Permission Matrix](ROLES.md#role-permission-matrix).

### RBAC Enforcement Points

Authorization must be enforced at **every** access point, not just at the UI level:

| Enforcement Point | Mechanism | Description |
|---|---|---|
| Next.js Middleware | Route-level checks | Redirect unauthorized users before rendering |
| Server Components | Data-fetching checks | Verify permissions before querying data |
| Server Actions | Action-level checks | Validate role before performing mutations |
| API Routes | Request-level checks | Reject unauthorized API calls |
| RLS Policies | Query-level checks | Filter and restrict data at the database level |

### Role Assignment Security

- New users receive `student_personnel` as the default role (D1).
- Only users with `role = 'administrator'` can change another user's role.
- A user **cannot** change their own role. This must be enforced in both application logic and RLS policies.
- Role changes must be logged for audit purposes.

## Server-Side Authorization

### Next.js Middleware (Planned)

Middleware will run on every request to protected routes and will:

1. Verify the user's session is valid (authenticated).
2. Check the user's role against the route's requirements.
3. Redirect unauthorized users to an appropriate page (login page for unauthenticated, forbidden page for insufficient role).

**Important limitations of middleware:**

- Middleware runs at the edge and has access to cookies and headers, but should not perform complex database queries.
- Middleware provides a first line of defense but is **not sufficient** on its own. Server components and server actions must independently verify authorization.

### Server Components and Server Actions (Planned)

- Server components that fetch data must verify the user's role before executing queries.
- Server actions that mutate data must verify the user's role and ownership before performing operations.
- Authorization checks must use the server-side Supabase client, which has access to the authenticated user's session.

### Authorization Check Pattern (Planned)

The following pattern should be implemented consistently across all protected operations:

1. **Get the authenticated user** from the Supabase server client.
2. **Get the user's profile** including their role.
3. **Check permission** against the required role for the operation.
4. **Deny with an error** if the check fails — do not silently skip the operation.
5. **Proceed** only if all checks pass.

## PostgreSQL Row Level Security

### RLS Design Principles (Planned)

Row Level Security (RLS) provides the final line of defense at the database level. Even if application-level checks are bypassed, RLS policies prevent unauthorized data access.

- **Enable RLS on all tables.** No table should be accessible without a policy.
- **Deny by default.** When RLS is enabled on a table with no policies, all access is denied.
- **Use `auth.uid()`** to identify the current user in policies.
- **Use a helper function** to look up the current user's role from the `profiles` table.
- **Separate SELECT, INSERT, UPDATE, DELETE policies** for granular control.

### Proposed RLS Policy Overview

The following is a high-level summary of the proposed RLS policies. Detailed SQL policies will be written during the implementation phase.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Own profile: all users. All profiles: `administrator` | Via Supabase Auth trigger | Own non-role fields: all users. Role field: `administrator` only | Not permitted |
| `categories` | All users | `administrator` | `administrator` | Not permitted (soft deactivate) |
| `locations` | All users | `administrator` | `administrator` | Not permitted (soft deactivate) |
| `reports` | Own: reporter. Assigned: `technician`. All: `coordinator`, `administrator`, `management` | Users with submit permission | Own reports (limited fields): reporter. Status: authorized actors per transition rules | Not permitted |
| `report_attachments` | Same as parent report | Reporter at submission, `technician` on assigned reports | Not permitted (pending PD-D2) | Not permitted (pending PD-D2) |
| `report_status_history` | Same as parent report | System/trigger only | Not permitted (append-only) | Not permitted |
| `report_comments` | Same as parent report | Per comment permission rules in [ROLES.md](ROLES.md) | Own comments: author (pending PD-D3) | Not permitted (pending PD-D3) |
| `assignments` | Own: `technician`. All: `coordinator`, `administrator` | `coordinator` only | `coordinator` (reassignment), `technician` (status updates) | Not permitted |
| `work_logs` | Own: `technician`. All: `coordinator`, `administrator`, `management` | `technician` on own assignments | Not permitted (append-only) | Not permitted |
| `verifications` | Same as parent report | `coordinator` only (not self-verification of own repairs) | Not permitted (append-only) | Not permitted |
| `notifications` | Own only: all users | System/trigger only | Own (mark as read): recipient | Not permitted |

### RLS Helper Function (Planned)

A PostgreSQL function to retrieve the current user's role:

```
-- Pseudocode — not yet implemented
get_user_role() → user_role
  Returns the role from profiles where id = auth.uid()
```

This function will be called by RLS policies to make role-based decisions.

## Supabase Storage Security

### Storage Design (Planned)

Photo attachments (D4) will be stored in a **private** Supabase Storage bucket.

**Private bucket requirements:**

- Files are **not** publicly accessible via URL.
- Access requires a valid authenticated session.
- Storage policies control who can upload, download, and delete files.

### Proposed Storage Policies

| Operation | Policy |
|---|---|
| **Upload** | Authenticated users with report submission permission. File must pass validation checks (see [File Upload Validation](#file-upload-validation)). |
| **Download** | Users who can view the associated report (determined by report RLS policies). |
| **Delete** | Pending decision (PD-D2). Recommend restricting to `administrator` or preventing deletion entirely. |

### File Organization

Files should be organized in the storage bucket by report:

```
report-attachments/
  {report_id}/
    {attachment_id}_{filename}
```

This structure supports easy cleanup and access control scoped to individual reports.

## Environment Variables and Secrets

### Variable Classification

| Variable | Sensitivity | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Safe for client-side. Identifies the Supabase project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Safe for client-side **only with RLS enabled**. Provides authenticated access scoped by RLS policies. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Server-side only. **Bypasses RLS.** Must never be exposed to the client. |

### Handling Rules

1. **Never commit real credentials.** The `.gitignore` already excludes `.env*` files.
2. **Use `.env.local`** for local development credentials. Copy from `.env.example`.
3. **Use environment variables** in the deployment platform (Vercel) for production credentials.
4. **Never include credentials** in documentation, logs, error messages, or client-side code.
5. **The `NEXT_PUBLIC_` prefix** makes a variable available in the browser bundle. Only use this prefix for variables that are genuinely safe for public exposure.
6. **The service role key** bypasses all RLS policies. It should only be used in server-side code for administrative operations that genuinely require elevated access (e.g., user management functions). It must **never** appear in:
   - Client-side code or components.
   - `NEXT_PUBLIC_` prefixed variables.
   - Browser-accessible API responses.
   - Documentation or version control.
7. **Validate environment variables** at application startup. If required variables are missing, the application should fail with a clear error rather than proceeding with undefined behavior.

### Environment Template

See [.env.example](../.env.example) for the list of required environment variables with placeholder values.

## Input Validation

### Validation Strategy (Planned)

All user input must be validated at multiple levels:

| Level | Purpose | Implementation |
|---|---|---|
| Client-side | User experience (immediate feedback) | Form validation, TypeScript types |
| Server-side | Security enforcement | Server actions, API route handlers |
| Database | Data integrity | Constraints, types, enums, triggers |

### Validation Rules

- **Client-side validation is for UX only.** It can be bypassed and must never be relied upon for security.
- **Server-side validation is mandatory.** Every server action and API route must validate all inputs before processing.
- **Database constraints are the final safeguard.** NOT NULL, CHECK, FOREIGN KEY, and UNIQUE constraints catch any validation failures that slip through.

### Input Sanitization Requirements

- Sanitize text inputs to prevent Cross-Site Scripting (XSS).
- Use parameterized queries (Supabase client handles this) to prevent SQL injection.
- Validate enum values against the allowed set before database operations.
- Validate foreign key references (e.g., `category_id`, `location_id`) exist before creating reports.
- Enforce maximum lengths on text fields.
- Validate email format for user registration.

## File Upload Validation

### Upload Security Requirements (Planned)

Photo uploads (D4 — optional) must be validated to prevent malicious file uploads:

| Check | Requirement |
|---|---|
| **File type** | Accept only image MIME types (`image/jpeg`, `image/png`, `image/webp`). Verify the MIME type from file content, not just the file extension. |
| **File size** | Enforce a maximum file size per upload (specific limit is a pending decision — PD-D5). |
| **File count** | Enforce a maximum number of attachments per report (specific limit is a pending decision — PD-D5). |
| **File name** | Sanitize filenames to remove path traversal characters and special characters. |
| **Content validation** | Validate that the file content matches the declared MIME type (magic byte validation). |
| **Storage path** | Generate storage paths server-side. Never allow client-specified storage paths. |

### Upload Flow (Planned)

1. Client selects files and performs basic client-side validation (type, size).
2. Server action receives the files and performs server-side validation.
3. Server uploads validated files to the private Supabase Storage bucket.
4. Server creates `report_attachments` records with file metadata.
5. If any validation fails, the upload is rejected with a descriptive error.

## Auditability and Status History

### Audit Requirements

CMIRS must maintain a complete audit trail of all security-relevant actions:

| Action | Audit Mechanism |
|---|---|
| User registration | Supabase Auth logs |
| User login/logout | Supabase Auth logs |
| Role assignment/change | Application logs + `profiles.updated_at` |
| Report status transitions | `report_status_history` table |
| Technician assignments | `assignments` table (preserves reassignment history) |
| Repair verifications | `verifications` table |
| Work performed | `work_logs` table |

### Audit Data Integrity

- Audit records (`report_status_history`, `verifications`, `work_logs`) are **append-only**. They must never be updated or deleted.
- RLS policies must prevent non-system users from modifying audit tables.
- Each audit record includes the acting user's ID and a timestamp.

### Status History for Accountability

The `report_status_history` table (see [DATABASE.md](DATABASE.md)) records every status transition with:

- Who made the change (`changed_by` → `profiles.id`).
- What changed (`previous_status` → `new_status`).
- When it changed (`created_at`).
- Why it changed (`reason` — required for holds, cancellations, and reopenings).

This provides complete accountability for the report lifecycle described in [WORKFLOW.md](WORKFLOW.md).

## Security Testing Requirements

### Planned Testing Areas

The following security tests should be performed before deployment. These are requirements for future testing phases, not yet implemented.

| Area | Test Description |
|---|---|
| **Authentication** | Verify that unauthenticated users cannot access protected routes or API endpoints. |
| **Role enforcement** | For each role, verify that users can only perform actions permitted by their role. Attempt unauthorized actions and confirm they are denied. |
| **RLS policies** | Test each RLS policy by querying as different roles. Verify that users cannot read, create, update, or delete records outside their authorization scope. |
| **Self-elevation** | Verify that users cannot change their own role via direct API calls, SQL, or manipulated requests. |
| **Self-verification** | Verify that a technician cannot verify their own completed work. |
| **Status transitions** | Attempt invalid status transitions and verify they are rejected. |
| **File upload** | Attempt to upload non-image files, oversized files, and files with manipulated extensions or MIME types. Verify rejection. |
| **Storage access** | Verify that users cannot access attachments for reports they are not authorized to view. |
| **Environment variables** | Verify that server-side secrets (service role key) are not exposed in client-side bundles, API responses, or error messages. |
| **Input validation** | Test all input fields with boundary values, special characters, and injection attempts. |
| **Session handling** | Verify that expired sessions are properly invalidated and that session tokens cannot be reused after logout. |
| **CSRF protection** | Verify that state-changing operations are protected against cross-site request forgery. |

### Security Review Checklist (Pre-Deployment)

Before deploying to production, verify:

- [ ] RLS is enabled on all tables.
- [ ] All tables have appropriate SELECT, INSERT, UPDATE, and DELETE policies.
- [ ] The service role key is not exposed in any client-side code.
- [ ] All server actions and API routes validate user authentication and authorization.
- [ ] Input validation is implemented on all user-facing forms and API endpoints.
- [ ] File upload validation is implemented and tested.
- [ ] Environment variables are properly configured in the deployment platform.
- [ ] Audit tables are append-only and protected by RLS.
- [ ] Status transition validation is enforced at both application and database levels.
- [ ] Password policies meet minimum security requirements.

## Pending Decisions

The following security-related decisions have not been finalized. Some reference pending decisions in other documents.

| ID | Decision | Context | Reference |
|---|---|---|---|
| PD-S1 | Rate-limiting strategy for API endpoints and form submissions | Prevents abuse, brute-force attacks, and spam submissions | Consider Supabase built-in rate limiting and/or Next.js middleware-based limiting. |
| PD-S2 | Session timeout duration | Balances security with user convenience | Supabase Auth default session duration may be acceptable; review and configure as needed. |
| PD-S3 | Password policy requirements | Minimum length, complexity, common password rejection | Supabase Auth provides configurable password requirements. |
| PD-S4 | CORS configuration | Required if the API is accessed from domains other than the primary frontend | Review Supabase and Next.js CORS defaults. |
| PD-R4 | Can a Coordinator verify a report they themselves submitted? | Separation of duties enforcement | See [ROLES.md](ROLES.md) |
| PD-D2 | Can attachments be deleted after upload? | Affects storage cleanup and audit integrity | See [DATABASE.md](DATABASE.md) |
| PD-D5 | Photo size and count limits | Affects storage costs and upload validation rules | See [DATABASE.md](DATABASE.md) |

---

*This document is part of Phase 0 project documentation. See [README.md](../README.md) for project overview and links to other documents.*
