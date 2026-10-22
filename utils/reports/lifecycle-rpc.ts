/**
 * CMIRS — Notification-Bearing Lifecycle RPC Integration
 *
 * Phase 4C implementation support (approved design: PHASE_4C_2_NOTIFICATION_BACKEND_SPEC.md,
 * decisions PHASE_4C_6_OWNER_DECISION_SUMMARY.md).
 *
 * The five report-lifecycle commands now execute through narrow, hardened
 * `SECURITY DEFINER` database functions so that the source mutation and the resulting
 * notifications commit in ONE transaction (S-01). This module provides:
 *
 * - `resolveRequestId()` — the idempotency token (S-03). A caller-supplied token is reused so
 *   that a retry of the same user action returns the original result instead of creating a
 *   second report / assignment / notification. When no token is supplied a fresh one is minted.
 * - `describeLifecycleRpcError()` — maps the controlled `CMIRS_*` database errors onto accurate,
 *   non-revealing user-facing notices. Raw SQL, table names, and constraint names are never
 *   surfaced.
 * - `invokeLifecycleRpc()` — a small typed wrapper around `supabase.rpc()`.
 *
 * This module uses only relative imports so that it can be imported directly by the Node test
 * runner, exactly like `utils/reports/transform.ts`.
 */

import { describeDatabaseError } from './transform.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the idempotency token for a lifecycle command.
 *
 * The client supplies `requestId` so that the SAME token is reused for every retry of the same
 * user action. A missing or malformed token falls back to a freshly generated UUID, which keeps
 * the database contract satisfied (a token is always present) at the cost of retry-safety for
 * that one call.
 */
export function resolveRequestId(input: unknown): string {
  if (typeof input === 'string' && UUID_PATTERN.test(input.trim())) {
    return input.trim();
  }

  if (input && typeof input === 'object') {
    const raw = input as Record<string, unknown>;
    for (const key of ['requestId', 'request_id', 'p_request_id']) {
      const candidate = raw[key];
      if (typeof candidate === 'string' && UUID_PATTERN.test(candidate.trim())) {
        return candidate.trim();
      }
    }
  }

  return globalThis.crypto.randomUUID();
}

/**
 * Maps a lifecycle RPC failure onto an accurate, safe user-facing notice.
 *
 * The command functions raise controlled errors prefixed with `CMIRS_<CODE>:`. Only a fixed
 * allow-list of messages is ever returned to the browser; the raw error text is written to the
 * server log by the caller.
 */
export function describeLifecycleRpcError(error: unknown, fallback: string): string {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : typeof error === 'string'
        ? error
        : '';

  if (message.includes('CMIRS_NOT_AUTHENTICATED')) {
    return 'Your session is no longer valid. Please sign in again and retry.';
  }
  if (message.includes('CMIRS_FORBIDDEN')) {
    return 'You do not have permission to perform this action.';
  }
  if (message.includes('CMIRS_NOT_FOUND')) {
    return 'The requested record could not be found.';
  }
  if (message.includes('CMIRS_REPLAY_MISMATCH')) {
    return 'This action was already submitted with different details. Please reload the page and try again.';
  }
  if (message.includes('CMIRS_INVALID_STATE')) {
    return 'This action is not valid for the current state of the report.';
  }
  if (message.includes('CMIRS_INVALID_INPUT')) {
    return 'The submitted details were rejected. Please review the form and try again.';
  }

  // Not a controlled command error: fall back to the accurate, non-revealing database
  // classification so a genuine constraint or connectivity failure is still reported
  // truthfully rather than as a generic message.
  return describeDatabaseError(error) ?? fallback;
}

/**
 * Invokes a lifecycle command RPC and normalises the outcome.
 *
 * The command functions return a single `jsonb` document; PostgREST therefore resolves the
 * call with that document as the payload.
 */
export async function invokeLifecycleRpc<T>(
  supabase: {
    rpc: (
      fn: string,
      params: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  },
  fn: string,
  params: Record<string, unknown>,
  fallbackMessage: string
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(fn, params);

  if (error) {
    console.error(`[lifecycle-rpc] ${fn} failed:`, error.message);
    return { ok: false, error: describeLifecycleRpcError(error, fallbackMessage) };
  }

  if (data === null || data === undefined) {
    console.error(`[lifecycle-rpc] ${fn} returned no payload.`);
    return { ok: false, error: fallbackMessage };
  }

  return { ok: true, data: data as T };
}
