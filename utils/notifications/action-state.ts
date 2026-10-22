/**
 * CMIRS — Notification Action State Contract
 *
 * IMPORTANT ARCHITECTURAL RULE (Phase 4D, re-applied in the Phase 4C module):
 * A module that carries the file-level `'use server'` directive may ONLY export async functions.
 * Next.js enforces this at runtime through `ensureServerEntryExports()` in
 * `next/dist/build/webpack/loaders/next-flight-loader/action-validate.js`, which throws:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * Exporting the plain `INITIAL_NOTIFICATION_ACTION_STATE` object from
 * `actions/notifications.ts` therefore breaks every route that imports that module — the
 * `/notifications` page included — the moment the generated server-actions loader module is
 * evaluated.
 *
 * This module intentionally has no `'use server'` directive so that the constant can be
 * imported by both Server Components and Client Components as a real object.
 */

/**
 * The result contract shared by the notification read actions.
 */
export interface NotificationActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

/**
 * Initial idle state contract for React 19 `useActionState` hooks.
 */
export const INITIAL_NOTIFICATION_ACTION_STATE: NotificationActionState = { status: 'idle' };
