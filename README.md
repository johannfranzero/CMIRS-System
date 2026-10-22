# CMIRS — Campus Maintenance & Incident Reporting System

CMIRS is a web-based application for students and school personnel to report campus maintenance problems and safety hazards, and for maintenance coordinators, technicians, administrators and management to triage, assign, track, verify and audit those repairs through a structured workflow.

> **Status:** Feature-complete and verified against the live Supabase project. **Not deployed.**
> The current production-readiness verdict is **READY AFTER REQUIRED FIXES** — see
> [docs/PRODUCTION_READINESS_AUDIT.md](docs/PRODUCTION_READINESS_AUDIT.md) for the findings,
> the evidence, and the exact conditions that must be met before deployment approval.

## Table of Contents

- [Project Purpose](#project-purpose)
- [Technology Stack](#technology-stack)
- [User Roles](#user-roles)
- [Report Lifecycle](#report-lifecycle)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Configuration](#environment-configuration)
- [Available Scripts](#available-scripts)
- [Verification Scripts](#verification-scripts)
- [Project Documentation](#project-documentation)
- [Repository and Infrastructure](#repository-and-infrastructure)
- [Confirmed Decisions](#confirmed-decisions)

## Project Purpose

CMIRS enables campus communities to:

- **Report** maintenance issues and safety hazards with optional photo evidence.
- **Triage** incoming reports by assigning priority and coordinating responses.
- **Track** repair assignments, work progress, and status changes.
- **Verify** completed repairs before closing reports.
- **Audit** the full history of each report for accountability.

## Technology Stack

| Component | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router, `proxy.ts` perimeter) | 16.4.2 |
| Language | TypeScript | 5.9.3 |
| UI Library | React | 19.3.0 |
| Styling | Tailwind CSS (with Turbopack) | 4.x |
| Backend / Database | Supabase (PostgreSQL, Auth, RLS, Storage) | Integrated |
| Runtime | Node.js | 24.22.0 |
| Package Manager | npm | 11.19.1 |
| Linting | ESLint | 9.x |
| Deployment Target | Vercel (or any Node host) | Not yet configured |

## User Roles

CMIRS defines five user roles. See [docs/ROLES.md](docs/ROLES.md) for full details and the role-permission matrix.

| Role | Summary |
|---|---|
| Student / School Personnel | Submit and track maintenance reports |
| Maintenance Coordinator | Review reports, assign technicians, verify completed repairs |
| Maintenance Technician | Inspect and perform assigned repairs |
| School Administrator | Manage user accounts and role assignments |
| School Management | View reports and analytics for oversight |

Public self-registration and self-service password recovery are **disabled**. An account is
created in the Supabase dashboard, the `handle_new_user` trigger creates the matching profile
with the safe default role `student_personnel`, and a School Administrator assigns the real
role from `/settings`. Every role change is written to an append-only audit trail.

## Report Lifecycle

The high-level maintenance report workflow:

1. A reporter **submits** a report describing the issue (with optional photos and an urgent-hazard flag).
2. A Maintenance Coordinator **reviews** the report and confirms or adjusts its priority.
3. The Coordinator **assigns** the report to a Maintenance Technician.
4. The Technician **inspects and repairs** the issue, logging work progress.
5. The Technician marks the report as **completed**.
6. A Maintenance Coordinator **verifies** the repair (D2).
7. The report is **resolved** (or reopened if verification fails).

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the complete lifecycle, status definitions, transition rules, and Mermaid diagram.

## Prerequisites

- **Node.js** >= 24.x
- **npm** >= 11.x
- **Git**
- **Supabase CLI** (only for migration work: `npm install -g supabase`)

## Local Setup

```bash
# Clone the repository
git clone https://github.com/johannfranzero/CMIRS-System.git
cd CMIRS-System/my-app

# Install dependencies (use `npm ci` for a reproducible install)
npm ci

# Copy the environment template and fill in your values
cp .env.example .env.local

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application. The application
reads the Supabase project live — there is no mock or fixture data in the runtime path.

## Environment Configuration

Copy `.env.example` to `.env.local` and provide your Supabase project credentials:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url_here
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key_here
```

- Only the **publishable** key is used. The application has no service-role client and must
  never be given an `sb_secret_*` or service-role key.
- **Never commit `.env.local`** or any file containing real credentials. The `.gitignore`
  already excludes `.env*` files.
- `CMIRS_ENABLE_TEST_PERSONAS=true` optionally enables the local QA quick-fill panel on the
  login page. It is honoured **only** under `next dev`; a production build cannot enable it.
- See [docs/SECURITY.md](docs/SECURITY.md) for environment variable handling guidelines.
- See [.env.example](.env.example) for the full list of variables and their descriptions.

## Available Scripts

These commands are defined in `package.json` and verified against the current project:

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js development server (Turbopack) |
| `npm run build` | Create an optimized production build |
| `npm run start` | Serve the production build locally |
| `npm run lint` | Run ESLint on the project |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm test` | Run the unit test suite (`node --test tests/unit/*.test.mjs`) |
| `npm run verify:bundle` | Scan the production build output for development-only data and secrets |
| `npm run verify:prod` | typecheck → lint → test → build → bundle scan |

## Verification Scripts

These scripts produce the evidence recorded in
[docs/PRODUCTION_READINESS_AUDIT.md](docs/PRODUCTION_READINESS_AUDIT.md). All of them are
read-only with respect to the application and the database.

| Command | Description |
|---|---|
| `node scripts/verify-supabase-connectivity.mjs` | Validates the Supabase configuration without printing any secret |
| `node --import ./scripts/register-next-subpath-hook.mjs scripts/verify-server-action-exports.mjs` | Runs Next.js's own `ensureServerEntryExports()` guard against every `'use server'` module |
| `node scripts/probe-local-routes.mjs http://localhost:<port>` | HTTP route/perimeter smoke test |
| `node scripts/verify-in-browser.mjs http://localhost:<port>` | Headless-browser load and console-error check |
| `node tests/integration/rls-runner-safety.test.ts` | Offline safety tests for the remote RLS harness |
| `npx supabase db query --linked --file scripts/remote-production-readiness-probe.sql` | Read-only live schema / RLS / privilege probe |
| `npx supabase db query --linked --file scripts/remote-rls-verification.sql` | 25-assertion live RLS harness (read-only, rolled back) |
| `npx supabase db query --linked --file scripts/remote-notification-lifecycle-verification.sql` | 42-assertion live notification-lifecycle harness (read-only, rolled back) |
| `npx supabase db query --linked --file scripts/remote-account-management-verification.sql` | 12-assertion live account-management harness (read-only, rolled back) |

> The three remote `*-verification.sql` harnesses and the readiness probe run inside a
> transaction that is always rolled back. They never write to the remote project.

## Project Documentation

| Document | Description |
|---|---|
| [docs/PRODUCTION_READINESS_AUDIT.md](docs/PRODUCTION_READINESS_AUDIT.md) | **The deployment-readiness assessment** — findings, evidence, remaining work |
| [docs/DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md) | Deployment prerequisites, owner actions, and the deployment checklist |
| [docs/ROLES.md](docs/ROLES.md) | User roles, permissions, and role-permission matrix |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Report lifecycle, status transitions, and actor permissions |
| [docs/DATABASE.md](docs/DATABASE.md) | Database schema, relationships, and integrity rules |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model and access control |
| [docs/FINAL_ACCEPTANCE_REPORT.md](docs/FINAL_ACCEPTANCE_REPORT.md) | Acceptance matrix and historical verification evidence |
| [.env.example](.env.example) | Environment variable template (no real credentials) |

## Repository and Infrastructure

| Resource | Status |
|---|---|
| GitHub Repository | [`johannfranzero/CMIRS-System`](https://github.com/johannfranzero/CMIRS-System) |
| Supabase Project | Reference `xyirfifvcntuzceivtho` — linked to the local CLI (`supabase/.temp/project-ref`) |
| Migrations | 15 files in `supabase/migrations/`. **Four are prepared but not applied** — see [docs/DEPLOYMENT_READINESS.md](docs/DEPLOYMENT_READINESS.md) §5 |
| Deployment | Not yet configured. The blocking prerequisites are listed in [docs/PRODUCTION_READINESS_AUDIT.md](docs/PRODUCTION_READINESS_AUDIT.md) §10 |

## Confirmed Decisions

These decisions are treated as requirements throughout all project documentation:

| ID | Decision |
|---|---|
| D1 | New users receive a safe default role. A School Administrator assigns or changes roles after registration. |
| D2 | A designated Maintenance Coordinator verifies completed repairs. |
| D3 | Reporters can flag urgent hazards. Coordinators review and confirm or adjust priority. A reporter's flag does not automatically become the confirmed priority. |
| D4 | Photo attachments are optional. A report is valid without any attachments. |
| D5 | Supabase project exists (ref: `xyirfifvcntuzceivtho`). Its configuration and readiness must be inspected before use. |
| D6 | GitHub repository exists. Local connection to be established when separately authorized. |
| D7 | In-app notifications only for the MVP. Email, SMS, and push notifications are out of scope. |
| D8 | Use `main` as the primary branch with feature branches for development. |
