# CMIRS — Report Submission & Real Data Fix Report

**Date:** 2026-10-21  
**Scope:** Fix report submission failure · Eliminate inappropriate mock data from functional pages  

---

## Executive Summary

Three distinct defects were identified and fixed:

1. **`readOptionalRequestId` ReferenceError** in `validateReportTriageInput` — caused a runtime crash for every coordinator triage action and broke the unit test.
2. **Triage validation accepted `assigned` status** — violated the architectural decision that assignment is a separate dedicated command.
3. **Hardcoded mock data in the Operations Dashboard** — fake technician names (Alex Morgan, Elena Rostova, Marco Bellini) and a fabricated "94.2% On-Time" SLA metric.

**Verification:** TypeScript compiles with 0 errors, ESLint passes with 0 warnings, 113/115 unit tests pass. The 2 remaining failures are pre-existing for an unimplemented notification migration (out of scope).

---

## Root Cause Analysis

### Bug 1: `readOptionalRequestId` ReferenceError

**File:** `utils/reports/validation.ts` (line 305 pre-fix)

The helper `readOptionalRequestId` was removed during a refactor but the call was left in `validateReportTriageInput`. Every coordinator triage submission crashed with `ReferenceError: readOptionalRequestId is not defined`.

### Bug 2: Triage Accepts `assigned` Status

**Files:** `utils/reports/validation.ts`, `types/mutations.ts`

The triage validation accepted `status: under_review | assigned`, allowing coordinators to bypass the dedicated `assignTechnicianAction` command. The unit test at line 341-346 explicitly rejects this pattern.

### Bug 3: Dashboard Mock Data

**File:** `app/page.tsx`

The "Technicians On Duty" widget hardcoded Alex Morgan, Elena Rostova, and Marco Bellini with fake task counts and a pulsing live indicator. The "Resolution SLA" widget displayed a fabricated "94.2% On-Time" metric.

---

## Fixes

### Fix 1: Remove orphaned `readOptionalRequestId` call

`utils/reports/validation.ts` — removed the dead call and unused `requestId` variable assignment.

### Fix 2: Narrow triage status to `under_review` only

- `utils/reports/validation.ts` — status check narrowed; return value hardened to always return `under_review`
- `types/mutations.ts` — `ReportTriageInput.status` type narrowed to `under_review`
- `actions/reports.ts` — FormData extraction always produces `status: under_review` (client cannot inject `assigned`)
- `components/reports/report-action-panel.tsx` — removed dead `triageStatus` state and the status dropdown; replaced with an informational notice pointing to the Assign Tech tab

### Fix 3: Remove mock dashboard data

`app/page.tsx` — fake technician list and fake SLA metric removed and replaced with honest "not yet implemented" states.

---

## Mock Data Disposition

### Eliminated (was inappropriate in functional pages)

| Item | Location |
|---|---|
| Alex Morgan fake technician | `app/page.tsx` |
| Elena Rostova fake technician | `app/page.tsx` |
| Marco Bellini fake technician | `app/page.tsx` |
| "94.2% On-Time" SLA | `app/page.tsx` |
| "15 repairs this week" count | `app/page.tsx` |

### Retained (appropriate for their context)

| Item | Location | Reason |
|---|---|---|
| `FALLBACK_CATEGORIES` | `utils/reports/transform.ts` | Form reference fallback when DB unavailable; IDs match seed.sql; tests verify integrity |
| `FALLBACK_LOCATIONS` | `utils/reports/transform.ts` | Same as above |
| `FALLBACK_TECHNICIANS` | `utils/reports/transform.ts` | Test fixture only; not rendered to users |

### Other Pages — Clean

Analytics, Settings, Locations, Reports queue, Report detail, and New report pages contain no runtime FALLBACK_ references (enforced by existing unit tests).

---

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS — 0 errors (previously: TS2304 readOptionalRequestId) |
| `node --test tests/unit/*.test.mjs` | 113/115 PASS (2 pre-existing failures for unimplemented notification migration) |
| `mutation-validation.test.mjs` | 12/12 PASS (previously 11/12) |
| ESLint | PASS — 0 warnings or errors |

---

## Files Changed

| File | Change |
|---|---|
| `utils/reports/validation.ts` | Removed `readOptionalRequestId` call; narrowed triage status |
| `types/mutations.ts` | Narrowed `ReportTriageInput.status` to `under_review` |
| `actions/reports.ts` | Triage FormData always produces `status: under_review` |
| `components/reports/report-action-panel.tsx` | Removed dead triageStatus state + status dropdown |
| `app/page.tsx` | Removed fake technician roster and fake SLA metric |
