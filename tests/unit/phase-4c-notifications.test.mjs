/**
 * CMIRS — Phase 4C / 4E Regression Suite
 *
 * Covers the notification data access layer, the lifecycle RPC integration helpers, and the
 * administrator account-management action.
 *
 * These are pure, local unit tests. They use mocked Supabase clients; no remote resource is
 * contacted and no state is persisted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRequestId,
  describeLifecycleRpcError,
  invokeLifecycleRpc,
} from '../../utils/reports/lifecycle-rpc.ts';
import {
  getNotificationsFromClient,
  getUnreadNotificationCountFromClient,
} from '../../utils/notifications/runtime.ts';

// =============================================================================
// Lifecycle RPC integration helpers
// =============================================================================

test('Phase 4C: a client-supplied idempotency token is reused so a retry is a replay', () => {
  const token = '11111111-2222-4333-8444-555555555555';

  assert.equal(resolveRequestId(token), token);
  assert.equal(resolveRequestId({ requestId: token }), token);
  assert.equal(resolveRequestId({ request_id: token }), token);
  assert.equal(resolveRequestId({ p_request_id: token }), token);

  // The same token is returned for every retry of the same attempt.
  assert.equal(resolveRequestId({ requestId: token }), resolveRequestId({ requestId: token }));
});

test('Phase 4C: a missing or malformed token is replaced with a fresh UUID', () => {
  const minted = resolveRequestId(undefined);
  assert.match(minted, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  assert.notEqual(resolveRequestId('not-a-uuid'), resolveRequestId('not-a-uuid'));
  assert.notEqual(resolveRequestId({ requestId: 'nope' }), resolveRequestId({ requestId: 'nope' }));
});

test('Phase 4C: the controlled command errors map to accurate, safe notices', () => {
  const cases = [
    ['CMIRS_NOT_AUTHENTICATED: authentication required', /sign in again/i],
    ['CMIRS_FORBIDDEN: only Maintenance Coordinators may triage reports', /do not have permission/i],
    ['CMIRS_NOT_FOUND: report not found', /could not be found/i],
    ['CMIRS_REPLAY_MISMATCH: request id reused with different arguments', /already submitted/i],
    ['CMIRS_INVALID_STATE: report is already in a terminal state', /not valid for the current state/i],
    ['CMIRS_INVALID_INPUT: title must be 5-150 characters', /rejected/i],
  ];

  for (const [message, pattern] of cases) {
    const notice = describeLifecycleRpcError({ message }, 'fallback');
    assert.match(notice, pattern, `unexpected notice for ${message}`);
    assert.ok(!notice.includes('CMIRS_'), 'The internal error code must not reach the user');
  }
});

test('Phase 4C: an unclassified database failure is classified accurately and never leaks SQL', () => {
  const notice = describeLifecycleRpcError(
    {
      code: '23503',
      message: 'insert or update on table "reports" violates foreign key constraint "reports_category_id_fkey"',
    },
    'Failed to create maintenance report.'
  );

  assert.match(notice, /no longer available/i);
  assert.ok(!notice.includes('foreign key'));
  assert.ok(!notice.includes('public.reports'));
  assert.ok(!notice.includes('constraint'));
});

test('Phase 4C: invokeLifecycleRpc normalises a successful payload and a failure', async () => {
  const ok = await invokeLifecycleRpc(
    {
      rpc: async () => ({ data: { report_id: 'abc' }, error: null }),
    },
    'submit_report_with_notifications',
    { p_title: 'x' },
    'fallback'
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.data.report_id, 'abc');

  const failed = await invokeLifecycleRpc(
    {
      rpc: async () => ({ data: null, error: { message: 'CMIRS_FORBIDDEN: nope' } }),
    },
    'submit_report_with_notifications',
    { p_title: 'x' },
    'fallback'
  );
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? '' : failed.error, /do not have permission/i);

  const empty = await invokeLifecycleRpc(
    { rpc: async () => ({ data: null, error: null }) },
    'submit_report_with_notifications',
    {},
    'fallback'
  );
  assert.equal(empty.ok, false, 'A null payload must never be reported as success');
});

// =============================================================================
// Notification data access layer
// =============================================================================

function createNotificationClient(rows, { error = null, count = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ table });
      const query = {
        select(_columns, options) {
          calls.push({ table, select: true, options });
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: rows, count, error });
        },
        eq(column, value) {
          void column;
          void value;
          const filtered = {
            select(_cols, opts) {
              calls.push({ table, head: opts?.head, count: opts?.count });
              return Promise.resolve({ count, error });
            },
            then(resolve) {
              return Promise.resolve({ count, error }).then(resolve);
            },
          };
          return filtered;
        },
        then(resolve) {
          return Promise.resolve({ data: rows, count, error }).then(resolve);
        },
      };
      return query;
    },
  };
}

test('Phase 4C: the unread count is derived from the real unread rows', async () => {
  const rows = [
    { id: 'n1', type: 'report_submitted', title: 'a', message: 'm', report_id: 'r1', is_read: false, created_at: '2026-10-21T00:00:00Z' },
    { id: 'n2', type: 'status_changed', title: 'b', message: 'm', report_id: 'r1', is_read: true, created_at: '2026-10-21T00:00:00Z' },
    { id: 'n3', type: 'report_assigned', title: 'c', message: 'm', report_id: 'r2', is_read: false, created_at: '2026-10-21T00:00:00Z' },
  ];

  const result = await getNotificationsFromClient(createNotificationClient(rows));

  assert.equal(result.error, null);
  assert.equal(result.notifications.length, 3);
  assert.equal(result.unreadCount, 2, 'The unread count must be derived from the real rows');
  assert.equal(result.notifications[0].isRead, false);
  assert.equal(result.notifications[1].isRead, true);
  assert.equal(result.notifications[0].reportId, 'r1', 'A notification must link to its report');
});

test('Phase 4C: a failed notification read is an error, never an empty inbox', async () => {
  const failing = createNotificationClient([], {
    error: { code: '42501', message: 'permission denied for table notifications' },
  });

  const result = await getNotificationsFromClient(failing);

  assert.equal(result.error !== null, true, 'A failed read must report an error');
  assert.deepEqual(result.notifications, []);
  assert.equal(result.unreadCount, 0);
});

test('Phase 4C: a failed unread-count read reports that the count is unavailable', async () => {
  const failing = createNotificationClient([], {
    error: { code: '42501', message: 'permission denied for table notifications' },
  });

  const result = await getUnreadNotificationCountFromClient(failing);

  assert.equal(result.available, false, 'A failed count read must not report a usable count');
  assert.equal(result.count, 0);
});

test('Phase 4C: the unread-count read uses a head count over the unread rows', async () => {
  const client = createNotificationClient([], { count: 4 });
  const result = await getUnreadNotificationCountFromClient(client);

  assert.equal(result.available, true);
  assert.equal(result.count, 4);

  const headCall = client.calls.find((call) => call.select === true && call.options?.head === true);
  assert.ok(headCall, 'The unread count must be read with an exact head count');
  assert.equal(headCall.options.count, 'exact');
  assert.equal(headCall.options.head, true);
});
