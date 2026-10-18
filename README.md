# CMIRS — Campus Maintenance & Incident Reporting System

CMIRS is a web-based application designed to help students and school personnel report campus maintenance problems and safety hazards. Maintenance coordinators and administrators can manage, assign, track, and verify repairs through a structured workflow.

> **Development Status:** Phase 0 — Project documentation and architecture definition. No application features, authentication, database tables, or dashboards have been implemented. The project currently contains a default Next.js starter scaffold.

## Table of Contents

- [Project Purpose](#project-purpose)
- [Technology Stack](#technology-stack)
- [User Roles](#user-roles)
- [Report Lifecycle](#report-lifecycle)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Configuration](#environment-configuration)
- [Available Scripts](#available-scripts)
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
| Framework | Next.js (App Router) | 16.4.2 |
| Language | TypeScript | 5.9.3 |
| UI Library | React | 19.3.0 |
| Styling | Tailwind CSS (with Turbopack) | 4.x |
| Backend / Database | Supabase (PostgreSQL, Auth, Storage) | *Not yet integrated* |
| Runtime | Node.js | 24.22.0 |
| Package Manager | npm | 11.19.1 |
| Linting | ESLint | 9.x |
| Deployment Target | Vercel | *Not yet configured* |

## User Roles

CMIRS defines five user roles. See [docs/ROLES.md](docs/ROLES.md) for full details and the role-permission matrix.

| Role | Summary |
|---|---|
| Student / School Personnel | Submit and track maintenance reports |
| Maintenance Coordinator | Review reports, assign technicians, verify completed repairs |
| Maintenance Technician | Inspect and perform assigned repairs |
| School Administrator | Manage user accounts and role assignments |
| School Management | View reports and analytics for oversight |

New users receive a safe default role after registration. A School Administrator assigns or changes their actual role (D1).

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

Supabase CLI and a configured Supabase project will be required for backend development in a later phase.

## Local Setup

```bash
# Clone the repository (remote not yet configured — see Repository section below)
git clone https://github.com/johannfranzero/CMIRS-System.git
cd CMIRS-System/my-app

# Install dependencies
npm install

# Copy the environment template and fill in your values
cp .env.example .env.local

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

> **Note:** The application currently displays the default Next.js starter page. Supabase environment variables are defined in `.env.example` but are not yet consumed by any application code.

## Environment Configuration

Copy `.env.example` to `.env.local` and provide your Supabase project credentials:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url_here
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key_here
```

- **Never commit `.env.local`** or any file containing real credentials. The `.gitignore` already excludes `.env*` files.
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

## Project Documentation

| Document | Description |
|---|---|
| [docs/ROLES.md](docs/ROLES.md) | User roles, permissions, and role-permission matrix |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Report lifecycle, status transitions, and actor permissions |
| [docs/DATABASE.md](docs/DATABASE.md) | Proposed database schema, relationships, and integrity rules |
| [docs/SECURITY.md](docs/SECURITY.md) | Planned security architecture and access control |
| [.env.example](.env.example) | Environment variable template (no real credentials) |

## Repository and Infrastructure

| Resource | Status |
|---|---|
| GitHub Repository | [`johannfranzero/CMIRS-System`](https://github.com/johannfranzero/CMIRS-System) — exists but **not yet connected** as a local Git remote |
| Local Git Branch | `master` (D8 specifies `main` as the primary branch — rename is pending) |
| Supabase Project | Reference `xyirfifvcntuzceivtho` — exists but **not yet integrated** locally |
| Vercel Deployment | Not yet configured |

> **Pending setup tasks** (outside Phase 0 scope):
>
> - Configure the GitHub remote and connect the local repository.
> - Rename the default branch from `master` to `main` per D8.
> - Install Supabase packages (`@supabase/supabase-js`, `@supabase/ssr`) and configure the client.
> - Set up Vercel deployment.

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
