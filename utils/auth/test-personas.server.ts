/**
 * CMIRS — QA Test-Persona Catalogue (SERVER ONLY)
 *
 * ## Purpose
 *
 * During local QA the login page offered a panel that listed the five Stage 2.1
 * test personas and filled the e-mail field on click. That panel is a
 * development-only affordance and must never reach a production build.
 *
 * ## Production safety contract
 *
 * This module holds the only copy of the test e-mail addresses in the
 * repository, and it is imported **exclusively** by the Server Component
 * `app/login/page.tsx`. It is therefore never part of the browser bundle.
 *
 * Two independent guarantees keep it out of production:
 *
 *   1. A runtime guard throws if the module is ever evaluated in a browser.
 *   2. `getTestPersonas()` returns an empty list unless
 *      `isDevTestPersonaPanelEnabled()` is true, which requires
 *      `NODE_ENV === 'development'` — a build-time constant that is `false`
 *      in every production build.
 *
 * No password, token or key is stored here; only public institutional
 * identifiers of the locally provisioned QA accounts.
 */

import { isDevTestPersonaPanelEnabled } from './dev-tools.ts';

/**
 * A single QA persona entry shown by the development-only quick-fill panel.
 */
export interface TestPersona {
  /** Human-readable role label rendered in the panel. */
  role: string;
  /** Institutional e-mail address of the locally provisioned QA account. */
  email: string;
  /** Short machine-readable role badge. */
  badge: string;
  /** One-line description of what the persona can exercise. */
  desc: string;
}

/**
 * Browser guard. A Server-Only module that is evaluated in the browser means
 * the persona catalogue would be exposed in the client bundle. Fail loudly
 * during development instead of shipping the addresses.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    '[CMIRS] utils/auth/test-personas.server.ts must never be loaded in the browser. ' +
      'Import it from a Server Component only.'
  );
}

/**
 * The QA personas provisioned for local Stage 2.1 verification.
 */
const TEST_PERSONAS: readonly TestPersona[] = [
  {
    role: 'Student / Personnel',
    email: 'test-student@cmirs.internal',
    badge: 'student_personnel',
    desc: 'Report issues & track own submissions',
  },
  {
    role: 'Maintenance Coordinator',
    email: 'test-coord@cmirs.internal',
    badge: 'coordinator',
    desc: 'Triage, assign work & verify repairs',
  },
  {
    role: 'Maintenance Technician',
    email: 'test-tech@cmirs.internal',
    badge: 'technician',
    desc: 'Work on assigned repairs & decline RPC',
  },
  {
    role: 'School Administrator',
    email: 'test-admin@cmirs.internal',
    badge: 'administrator',
    desc: 'Manage roles, facilities & categories',
  },
  {
    role: 'School Management',
    email: 'test-mgmt@cmirs.internal',
    badge: 'management',
    desc: 'Read-only operational analytics & oversight',
  },
] as const;

/**
 * Returns the QA persona catalogue **only** when the development-only switch is
 * enabled. In every other case an empty list is returned, so the caller cannot
 * accidentally render the panel in production.
 */
export function getTestPersonas(): readonly TestPersona[] {
  if (!isDevTestPersonaPanelEnabled()) {
    return [];
  }

  return TEST_PERSONAS;
}
