/**
 * CMIRS — Administrator Account-Management Action State Contract
 *
 * IMPORTANT ARCHITECTURAL RULE (Phase 4D, re-applied in the Phase 4E module):
 * A module that carries the file-level `'use server'` directive may ONLY export async functions.
 * Next.js enforces this at runtime through `ensureServerEntryExports()` in
 * `next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`, which throws:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * Exporting the plain `INITIAL_ACCOUNT_MANAGEMENT_STATE` object from
 * `actions/accounts.ts` therefore breaks every route that imports that module — the
 * `/settings` administrator page included — the moment the generated server-actions loader
 * module is evaluated.
 *
 * This module intentionally has no `'use server'` directive so that the constant can be
 * imported by both Server Components and Client Components as a real object.
 */

/**
 * The result contract shared by the administrator account-management action.
 */
export interface AccountManagementActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  profileId?: string;
}

/**
 * Initial idle state contract for React 19 `useActionState` hooks.
 */
export const INITIAL_ACCOUNT_MANAGEMENT_STATE: AccountManagementActionState = { status: 'idle' };
