/**
 * CMIRS — Shared Server Action State Contracts
 *
 * IMPORTANT ARCHITECTURAL RULE (Phase 4D):
 * A module that carries the file-level `'use server'` directive may ONLY export async functions.
 * Next.js enforces this at runtime through `ensureServerEntryExports()` in
 * `next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`, which throws:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * That failure happens while the generated server-actions loader module is evaluated, which
 * breaks every route that imports the offending module — including `/reports/new` and
 * `/reports/[id]`. Plain state constants therefore MUST live outside `'use server'` modules.
 *
 * This module intentionally has no `'use server'` directive so that `INITIAL_ACTION_STATE`
 * can be imported by both Server Components and Client Components as a real object.
 */

import type { ActionFormState } from '../../types/mutations';

/**
 * Initial idle state contract for React 19 `useActionState` hooks.
 */
export const INITIAL_ACTION_STATE: ActionFormState<never> = {
  status: 'idle',
};
