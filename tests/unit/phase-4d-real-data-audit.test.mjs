/**
 * CMIRS — Phase 4D Regression Suite: Real Data Audit & Report Submission Repair
 *
 * Coverage:
 * 1. Root cause: `'use server'` modules may only export async functions. Exporting the
 *    `INITIAL_ACTION_STATE` object from `actions/reports.ts` made Next.js throw
 *    `A "use server" file can only export async functions, found object.` while the
 *    server-actions loader for `/reports/new` was evaluated, which made report submission
 *    impossible. These tests lock that invariant in place.
 * 2. No mock technician identities, fabricated SLA figures, or demo fixtures may appear in a
 *    functional (runtime-rendered) module.
 * 3. A failed reference-catalog query must never fall back to demo data.
 * 4. Real query results must be rendered through the canonical data transformations.
 * 5. Report submission must enforce server-side validation, surface database errors safely and
 *    accurately, and only report success after the row is actually persisted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submitReportAction } from '../../actions/reports.ts';
import { INITIAL_ACTION_STATE } from '../../utils/reports/action-state.ts';
import {
  transformDbReportToMaintenanceReport,
  transformDbReportToDetailedReport,
  describeDatabaseError,
  sanitizeErrorMessage,
} from '../../utils/reports/transform.ts';
import {
  getActiveCategoriesFromClient,
  getActiveLocationsFromClient,
  getActiveTechniciansFromClient,
  getCampusFacilityBreakdownFromClient,
} from '../../utils/reports/reference-catalogs.ts';
import { getRoleDashboardConfig } from '../../utils/reports/dashboard-config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');

// =============================================================================
// 0. Test helpers
// =============================================================================

const UUID_CATEGORY = '11111111-1111-1111-1111-111111111111';
const UUID_LOCATION = '22222222-2222-2222-2222-222222222222';
const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_STUDENT = '77777777-7777-7777-7777-777777777777';

const studentUser = {
  id: UUID_STUDENT,
  email: 'student@example.edu',
  profile: {
    id: UUID_STUDENT,
    email: 'student@example.edu',
    full_name: 'Student User',
    role: 'student_personnel',
    is_active: true,
  },
};

/**
 * Chainable in-memory Supabase read client.
 */
function createChainableReadClient(responses = {}) {
  const operations = [];

  return {
    operations,
    from(table) {
      const op = { table, filters: {}, orders: [] };
      operations.push(op);

      const query = {
        select(columns, options) {
          op.select = { columns, options };
          return query;
        },
        eq(column, value) {
          op.filters[column] = value;
          return query;
        },
        in(column, values) {
          op.filters[`${column}_in`] = values;
          return query;
        },
        order(column, options) {
          op.orders.push({ column, options });
          return query;
        },
        range(from, to) {
          op.range = { from, to };
          return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null });
        },
        limit(count) {
          op.limit = count;
          return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null }).then(
            resolve,
            reject
          );
        },
      };

      return query;
    },
  };
}

/**
 * In-memory Supabase write client for the report insert path.
 */
function createInsertMockSupabase(handlers = {}) {
  const operations = [];

  return {
    operations,
    from(table) {
      const op = { table, type: 'from', filters: {} };
      operations.push(op);

      const queryBuilder = {
        insert(payload) {
          op.type = 'insert';
          op.payload = payload;
          return queryBuilder;
        },
        select(fields) {
          op.fields = fields;
          return queryBuilder;
        },
        eq(column, value) {
          op.filters[column] = value;
          return queryBuilder;
        },
        single() {
          if (handlers[table]?.single) {
            return Promise.resolve(handlers[table].single(op));
          }
          return Promise.resolve({ data: { id: 'mock-id', ...op.payload }, error: null });
        },
        then(resolve) {
          if (handlers[table]?.[op.type]) {
            return Promise.resolve(handlers[table][op.type](op)).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };

      return queryBuilder;
    },
    rpc(fnName, args) {
      operations.push({ type: 'rpc', fnName, args });
      if (handlers.rpc) {
        return Promise.resolve(handlers.rpc(fnName, args));
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

function collectRuntimeSourceFiles(dir, accumulator = []) {
  const absolute = path.join(appRoot, dir);
  if (!fs.existsSync(absolute)) return accumulator;

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRuntimeSourceFiles(relative, accumulator);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      accumulator.push(relative);
    }
  }

  return accumulator;
}

// =============================================================================
// 1. Root cause regression: 'use server' modules export only async functions
// =============================================================================

test('Phase 4D: actions/reports.ts exports only async functions (Next.js use-server invariant)', async () => {
  const reportsActions = await import('../../actions/reports.ts');

  const offendingExports = Object.entries(reportsActions).filter(
    ([, value]) => typeof value !== 'function'
  );

  assert.deepEqual(
    offendingExports.map(([name]) => name),
    [],
    `A "use server" file can only export async functions. Offending exports: ${offendingExports
      .map(([name, value]) => `${name} (${typeof value})`)
      .join(', ')}`
  );
});

test('Phase 4D: no file-level "use server" module exports a non-function value', () => {
  const actionsDir = path.join(appRoot, 'actions');
  const actionFiles = fs
    .readdirSync(actionsDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join('actions', name));

  assert.ok(actionFiles.length > 0, 'Expected at least one server action module');

  for (const file of actionFiles) {
    const source = readSource(file);
    const isUseServerModule = /^\s*(['"])use server\1\s*;?/m.test(source);
    if (!isUseServerModule) continue;

    // `export const NAME = <initializer>` — the initializer must be a function expression.
    const exportPattern = /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*([^\n;]*)/g;
    let match;
    while ((match = exportPattern.exec(source)) !== null) {
      const [, name, initializer] = match;
      const isFunctionExpression =
        /^(async\s+)?function\b/.test(initializer.trim()) ||
        /^(async\s*)?\([^)]*\)\s*=>/.test(initializer.trim()) ||
        /^(async\s+)?[A-Za-z0-9_$]+\s*=>/.test(initializer.trim());

      assert.ok(
        isFunctionExpression,
        `${file} exports non-function value "${name}" from a "use server" module. ` +
          'Next.js throws `A "use server" file can only export async functions` at runtime, ' +
          'which breaks every route that imports this module.'
      );
    }
  }
});

test('Phase 4D: INITIAL_ACTION_STATE lives outside the "use server" module and is a real object', async () => {
  const { INITIAL_ACTION_STATE: fromActionStateModule } = await import(
    '../../utils/reports/action-state.ts'
  );

  assert.equal(typeof fromActionStateModule, 'object');
  assert.equal(fromActionStateModule.status, 'idle');

  const actionStateSource = readSource('utils/reports/action-state.ts');
  assert.ok(
    !/^\s*(['"])use server\1/m.test(actionStateSource),
    'utils/reports/action-state.ts must not carry the "use server" directive'
  );

  const reportsActionSource = readSource('actions/reports.ts');
  assert.ok(
    !/export\s+const\s+INITIAL_ACTION_STATE/.test(reportsActionSource),
    'INITIAL_ACTION_STATE must not be exported from the "use server" module'
  );

  // The client components must import it from the plain module, not from the action module.
  for (const component of [
    'components/reports/report-submission-form.tsx',
    'components/reports/report-action-panel.tsx',
  ]) {
    const source = readSource(component);
    assert.ok(
      !/INITIAL_ACTION_STATE[\s\S]{0,200}from\s+'@\/actions\/reports'/.test(source),
      `${component} must not import INITIAL_ACTION_STATE from the "use server" module`
    );
  }
});

// =============================================================================
// 2. No mock technician identities or fabricated SLA metrics in functional modules
// =============================================================================

test('Phase 4D: functional modules contain no mock technician identities or fake SLA metrics', () => {
  const runtimeFiles = [
    ...collectRuntimeSourceFiles('app'),
    ...collectRuntimeSourceFiles('components'),
    ...collectRuntimeSourceFiles('utils'),
  ];

  assert.ok(runtimeFiles.length > 0, 'Expected runtime modules to scan');

  const forbidden = [
    'Alex Morgan',
    'Elena Rostova',
    'Marco Bellini',
    'Jordan Lee',
    '94.2',
    'On-Time',
    'repairs verified and closed this week',
  ];

  for (const file of runtimeFiles) {
    const source = readSource(file);
    for (const needle of forbidden) {
      assert.ok(
        !source.includes(needle),
        `${file} still contains the fabricated value "${needle}". Functional modules must not ` +
          'render mock identities or hardcoded SLA metrics.'
      );
    }
  }
});

test('Phase 4D.1: no functional module asserts an unverified backend connection state', () => {
  const runtimeFiles = [
    ...collectRuntimeSourceFiles('app'),
    ...collectRuntimeSourceFiles('components'),
    ...collectRuntimeSourceFiles('utils'),
  ];

  // The removed banner claimed a verified connection ("Live Backend Connected",
  // "Serving records from Supabase Cloud", "Live RLS Active") that the server component
  // cannot actually prove: a successful query may still return zero rows, and RLS is
  // enforced inside the database rather than reported by the client.
  const forbidden = [
    'Live Backend Connected',
    'Serving records from Supabase Cloud',
    'Live RLS Active',
    'Degraded State',
    'Database Service Notice',
  ];

  for (const file of runtimeFiles) {
    const source = readSource(file);
    // Ignore the explanatory code comments that document the removal.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const needle of forbidden) {
      assert.ok(
        !code.includes(needle),
        `${file} still asserts the unverified connection claim "${needle}".`
      );
    }
  }
});

test('Phase 4D.1: the dashboard and report queue still render their real error notices', () => {
  for (const file of ['app/page.tsx', 'app/reports/page.tsx']) {
    const source = readSource(file);
    assert.ok(
      /Notice:/.test(source),
      `${file} must keep the honest, sanitized per-query error notice.`
    );
    assert.ok(
      /\.error/.test(source),
      `${file} must still surface the DAL error state.`
    );
  }
});

test('Phase 4D: dashboard KPI copy contains no hardcoded building totals or SLA claims', () => {
  const coordinatorConfig = getRoleDashboardConfig('coordinator', 'Test', {
    totalActive: 4,
    pendingReview: 1,
    inProgress: 2,
    resolvedThisWeek: 3,
    urgentHazards: 0,
  });

  for (const card of coordinatorConfig.cards) {
    assert.ok(
      !/across\s+\d+\s+campus/i.test(card.description),
      `Coordinator KPI card description must not hardcode a building count: "${card.description}"`
    );
  }

  const managementConfig = getRoleDashboardConfig('management', 'Test', {
    totalActive: 4,
    pendingReview: 1,
    inProgress: 2,
    resolvedThisWeek: 3,
    urgentHazards: 0,
  });

  assert.ok(
    !/SLA/i.test(managementConfig.welcomeMessage),
    'The management welcome message must not claim SLA monitoring that the backend does not support'
  );
});

// =============================================================================
// 3. Query failures never fall back to demo data
// =============================================================================

test('Phase 4D: failed reference-catalog queries return an honest error, never demo data', async () => {
  const failingClient = createChainableReadClient({
    categories: { data: null, count: 0, error: { code: 'PGRST200', message: 'permission denied' } },
    locations: { data: null, count: 0, error: { code: 'PGRST200', message: 'permission denied' } },
    profiles: { data: null, count: 0, error: { code: 'PGRST200', message: 'permission denied' } },
  });

  const categories = await getActiveCategoriesFromClient(failingClient);
  assert.deepEqual(categories.items, [], 'A failed category query must not return fixture categories');
  assert.ok(categories.error, 'A failed category query must report an error');

  const locations = await getActiveLocationsFromClient(failingClient);
  assert.deepEqual(locations.items, [], 'A failed location query must not return fixture locations');
  assert.ok(locations.error, 'A failed location query must report an error');

  const technicians = await getActiveTechniciansFromClient(failingClient);
  assert.deepEqual(technicians.items, [], 'A failed technician query must not return fixture technicians');
  assert.ok(technicians.error, 'A failed technician query must report an error');

  // No fabricated technician identity may be present in any failure path.
  const serialized = JSON.stringify([categories, locations, technicians]);
  for (const name of ['Alex Morgan', 'Jordan Lee']) {
    assert.ok(!serialized.includes(name), `Failure path leaked the fabricated technician "${name}"`);
  }
});

test('Phase 4D: empty reference-catalog results are not silently replaced with fixtures', async () => {
  const emptyClient = createChainableReadClient({
    categories: { data: [], count: 0, error: null },
    locations: { data: [], count: 0, error: null },
    profiles: { data: [], count: 0, error: null },
  });

  const categories = await getActiveCategoriesFromClient(emptyClient);
  assert.deepEqual(categories.items, []);
  assert.equal(categories.error, null);

  const technicians = await getActiveTechniciansFromClient(emptyClient);
  assert.deepEqual(technicians.items, []);
  assert.equal(technicians.error, null);
});

test('Phase 4D: the DAL contains no reference to the removed fallback fixtures', () => {
  for (const file of ['utils/reports/dal.ts', 'utils/reports/transform.ts']) {
    const source = readSource(file);
    // Strip comments so that documentation of the removed fixtures is allowed, while any
    // executable reference to them fails the test.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    assert.ok(
      !code.includes('FALLBACK_'),
      `${file} still references a FALLBACK_ fixture. Reference catalogs must fail honestly.`
    );
  }
});

// =============================================================================
// 4. Real query results are rendered by the appropriate data transformation
// =============================================================================

test('Phase 4D: real report rows are rendered by the canonical list and detail transformations', () => {
  const rawRow = {
    id: UUID_REPORT,
    report_number: 'RPT-000042',
    title: 'Water pipe burst in laboratory',
    description: 'Active leak above the server rack.',
    status: 'submitted',
    is_urgent_hazard: true,
    confirmed_priority: null,
    created_at: '2026-10-20T08:00:00Z',
    updated_at: '2026-10-20T08:00:00Z',
    category_id: UUID_CATEGORY,
    location_id: UUID_LOCATION,
    reporter_id: UUID_STUDENT,
    categories: { id: UUID_CATEGORY, name: 'Plumbing & Water' },
    locations: { id: UUID_LOCATION, building_name: 'Science Hall', floor: '2', room: '201' },
    reporter: {
      id: UUID_STUDENT,
      full_name: 'Juan Dela Cruz',
      role: 'student_personnel',
      email: 'juan@campus.edu',
    },
    assignments: [],
    report_status_history: [],
    verifications: [],
    report_attachments: [],
  };

  const listRow = transformDbReportToMaintenanceReport(rawRow);
  assert.equal(listRow.id, UUID_REPORT);
  assert.equal(listRow.trackingNumber, 'RPT-000042');
  assert.equal(listRow.category, 'Plumbing & Water');
  assert.equal(listRow.location.building, 'Science Hall');
  assert.equal(listRow.reporterName, 'Juan Dela Cruz');
  assert.equal(listRow.priority, null, 'Priority stays null until a coordinator triages the report');
  assert.equal(listRow.isUrgentHazard, true);

  const detailRow = transformDbReportToDetailedReport(rawRow);
  assert.equal(detailRow.id, listRow.id);
  assert.equal(detailRow.trackingNumber, listRow.trackingNumber);
  assert.deepEqual(detailRow.workLogs, []);
  assert.deepEqual(detailRow.statusHistory, []);
});

test('Phase 4D: the campus facility breakdown aggregates every visible active report', async () => {
  const client = createChainableReadClient({
    reports: {
      data: [
        { id: 'r1', status: 'submitted', locations: { building_name: 'Science Hall' } },
        { id: 'r2', status: 'in_progress', locations: { building_name: 'Science Hall' } },
        { id: 'r3', status: 'verified', locations: { building_name: 'Science Hall' } },
        { id: 'r4', status: 'submitted', locations: { building_name: 'Library' } },
        { id: 'r5', status: 'cancelled', locations: { building_name: 'Library' } },
      ],
      count: 5,
      error: null,
    },
  });

  const result = await getCampusFacilityBreakdownFromClient(client);

  assert.equal(result.error, null);
  assert.equal(result.isTruncated, false);
  assert.deepEqual(result.breakdown, [
    { building: 'Science Hall', count: 2 },
    { building: 'Library', count: 1 },
  ]);
});

test('Phase 4D: a truncated facility dataset is reported as unavailable rather than published', async () => {
  const client = createChainableReadClient({
    reports: {
      data: [{ id: 'r1', status: 'submitted', locations: { building_name: 'Science Hall' } }],
      count: 5000,
      error: null,
    },
  });

  const result = await getCampusFacilityBreakdownFromClient(client);

  assert.equal(result.isTruncated, true);
  assert.deepEqual(result.breakdown, []);
  assert.ok(result.error, 'A truncated dataset must report an error instead of a partial count');
});

// =============================================================================
// 5. Database errors are surfaced safely and accurately
// =============================================================================

test('Phase 4D: database errors map to accurate, non-revealing user-facing notices', () => {
  assert.match(
    describeDatabaseError({ code: '23503', message: 'violates foreign key constraint "reports_category_id_fkey"' }),
    /no longer available/i
  );
  assert.match(
    describeDatabaseError({ code: '42501', message: 'new row violates row-level security policy' }),
    /do not have permission/i
  );
  assert.match(
    describeDatabaseError({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }),
    /could not be found/i
  );
  assert.match(
    describeDatabaseError({ code: '23505', message: 'duplicate key value violates unique constraint' }),
    /already exists/i
  );

  // Unclassified errors must never leak raw SQL internals.
  const unknown = sanitizeErrorMessage(
    { code: 'XX000', message: 'relation "public.reports" does not exist at public.exec' },
    'Failed to create maintenance report.'
  );
  assert.equal(unknown, 'Failed to create maintenance report.');
  assert.ok(!unknown.includes('public.reports'));
  assert.ok(!unknown.includes('relation'));
});

test('Phase 4D.1: a failing RLS policy helper is reported as a database evaluation failure, not a permission denial', () => {
  // Live remote evidence (captured in .next/dev/logs/next-development.log):
  //   [DAL] getReportsQueue query error: "column reference \"report_id\" is ambiguous"
  //   | code= "42702" | status= "unknown"
  // PostgreSQL 42702 is `ambiguous_column`. It is raised by the PL/pgSQL helper
  // public.can_view_report(report_id UUID) because its parameter name collides with the
  // `report_id` column of public.assignments in the query inside the function body.
  const ambiguous = {
    code: '42702',
    message: 'column reference "report_id" is ambiguous',
  };

  const notice = describeDatabaseError(ambiguous);
  assert.ok(notice, 'A policy-helper failure must produce a user-facing notice');
  assert.match(notice, /visibility rule/i);
  assert.ok(
    !/permission/i.test(notice),
    'A database function evaluation failure must not be reported as a permission denial'
  );
  assert.ok(!/report_id/.test(notice), 'The notice must not leak the internal column name');
  assert.ok(!/42702/.test(notice), 'The notice must not leak the raw database error code');

  // The same error must also be classified correctly when it only carries the message.
  assert.match(
    describeDatabaseError({ code: 'PGRST000', message: 'column reference "report_id" is ambiguous' }),
    /visibility rule/i
  );

  // A genuine permission denial must still read as a permission denial.
  assert.match(
    describeDatabaseError({ code: '42501', message: 'new row violates row-level security policy' }),
    /do not have permission/i
  );
});

// =============================================================================
// 6. Report submission: validation, failure handling, and success semantics
// =============================================================================

test('Phase 4D: report submission rejects invalid payloads before touching the database', async () => {
  const mockSupabase = createInsertMockSupabase();

  const result = await submitReportAction(
    INITIAL_ACTION_STATE,
    { title: 'ab', description: 'too short', categoryId: 'not-a-uuid', locationId: '' },
    { user: studentUser, supabase: mockSupabase }
  );

  assert.equal(result.status, 'error');
  assert.ok(result.fieldErrors?.title);
  assert.ok(result.fieldErrors?.description);
  assert.ok(result.fieldErrors?.categoryId);
  assert.ok(result.fieldErrors?.locationId);
  assert.equal(
    mockSupabase.operations.length,
    0,
    'An invalid payload must never reach the database'
  );
});

test('Phase 4D: report submission rejects client-supplied authority fields', async () => {
  const mockSupabase = createInsertMockSupabase();

  const result = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Legitimate looking title',
      description: 'A description that is long enough to pass validation.',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
      isUrgentHazard: false,
      reporter_id: '99999999-9999-9999-9999-999999999999',
      status: 'verified',
      confirmed_priority: 'critical',
    },
    { user: studentUser, supabase: mockSupabase }
  );

  assert.equal(result.status, 'error');
  assert.ok(result.fieldErrors?.reporter_id);
  assert.ok(result.fieldErrors?.status);
  assert.ok(result.fieldErrors?.confirmed_priority);
  assert.equal(mockSupabase.operations.length, 0);
});

test('Phase 4D: a failed insert is reported as an error and never as a success', async () => {
  const mockSupabase = createInsertMockSupabase({
    reports: {
      single: () => ({
        data: null,
        error: {
          code: '23503',
          message: 'insert or update on table "reports" violates foreign key constraint "reports_category_id_fkey"',
        },
      }),
    },
    rpc: () => ({
      data: null,
      error: {
        code: '23503',
        message: 'insert or update on table "reports" violates foreign key constraint "reports_category_id_fkey"',
      },
    }),
  });

  const result = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Water pipe burst in laboratory',
      description: 'Active leak above the server rack near the mains.',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
      isUrgentHazard: true,
    },
    { user: studentUser, supabase: mockSupabase }
  );

  assert.equal(result.status, 'error');
  assert.equal(result.data, undefined, 'A failed insert must not return a created report payload');
  assert.ok(result.message);
  assert.ok(
    !/foreign key|public\.reports|constraint/i.test(result.message),
    `The raw database error must not leak to the user: ${result.message}`
  );
  assert.match(result.message, /no longer available|temporarily unavailable|try again/i);
});

test('Phase 4D: a successful submission returns the persisted report identity only after the write', async () => {
  const mockSupabase = createInsertMockSupabase({
    reports: {
      single: () => ({
        data: {
          id: UUID_REPORT,
          report_number: 'RPT-000042',
          status: 'submitted',
          created_at: '2026-10-20T08:00:00Z',
        },
        error: null,
      }),
    },
    rpc: () => ({
      data: {
        report_id: UUID_REPORT,
        report_number: 'RPT-000042',
        status: 'submitted',
        created_at: '2026-10-20T08:00:00Z',
      },
      error: null,
    }),
  });

  const result = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Water pipe burst in laboratory',
      description: 'Active leak above the server rack near the mains.',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
      isUrgentHazard: true,
    },
    { user: studentUser, supabase: mockSupabase }
  );

  assert.equal(result.status, 'success');
  assert.equal(result.data?.id, UUID_REPORT);
  assert.equal(result.data?.reportNumber, 'RPT-000042');
  assert.equal(result.data?.status, 'submitted');
  assert.match(result.message, /RPT-000042/);

  // The command must carry only server-derived authority fields and an idempotency token.
  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp, 'Expected the notification-bearing submission command to be invoked');
  assert.equal(rpcOp.fnName, 'submit_report_with_notifications');
  assert.equal(rpcOp.args.p_title, 'Water pipe burst in laboratory');
  assert.equal(rpcOp.args.p_category_id, UUID_CATEGORY);
  assert.equal(rpcOp.args.p_location_id, UUID_LOCATION);
  assert.equal(rpcOp.args.p_is_urgent_hazard, true);
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
  // The client must never be able to supply the reporter identity or the initial status.
  assert.equal(rpcOp.args.p_reporter_id, undefined);
  assert.equal(rpcOp.args.reporter_id, undefined);
  assert.equal(rpcOp.args.p_status, undefined);
  assert.equal(rpcOp.args.status, undefined);
});

test('Phase 4D: the FormData submission path produces the same persisted report', async () => {
  const mockSupabase = createInsertMockSupabase({
    reports: {
      single: () => ({
        data: {
          id: UUID_REPORT,
          report_number: 'RPT-000043',
          status: 'submitted',
          created_at: '2026-10-20T08:05:00Z',
        },
        error: null,
      }),
    },
    rpc: () => ({
      data: {
        report_id: UUID_REPORT,
        report_number: 'RPT-000043',
        status: 'submitted',
        created_at: '2026-10-20T08:05:00Z',
      },
      error: null,
    }),
  });

  const formData = new FormData();
  formData.set('title', 'Broken ceiling light in lecture hall');
  formData.set('description', 'Two ceiling panels have fallen near the front row.');
  formData.set('categoryId', UUID_CATEGORY);
  formData.set('locationId', UUID_LOCATION);
  formData.set('isUrgentHazard', 'on');
  formData.set('requestId', '11111111-2222-4333-8444-555555555555');

  const result = await submitReportAction(INITIAL_ACTION_STATE, formData, {
    user: studentUser,
    supabase: mockSupabase,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.data?.reportNumber, 'RPT-000043');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.args.p_is_urgent_hazard, true);
  assert.equal(rpcOp.args.p_title, 'Broken ceiling light in lecture hall');
  // The client-supplied idempotency token must be forwarded unchanged.
  assert.equal(rpcOp.args.p_request_id, '11111111-2222-4333-8444-555555555555');
});

test('Phase 4D: unauthenticated and inactive callers cannot create a report', async () => {
  const mockSupabase = createInsertMockSupabase();

  const anonymous = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Water pipe burst in laboratory',
      description: 'Active leak above the server rack near the mains.',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
    },
    { user: null, supabase: mockSupabase }
  );
  assert.equal(anonymous.status, 'error');
  assert.match(anonymous.message, /Authentication required/i);

  const inactive = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Water pipe burst in laboratory',
      description: 'Active leak above the server rack near the mains.',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
    },
    {
      user: {
        id: UUID_STUDENT,
        email: 'inactive@example.edu',
        profile: {
          id: UUID_STUDENT,
          email: 'inactive@example.edu',
          full_name: 'Inactive User',
          role: 'student_personnel',
          is_active: false,
        },
      },
      supabase: mockSupabase,
    }
  );
  assert.equal(inactive.status, 'error');
  assert.match(inactive.message, /Authentication required/i);
  assert.equal(mockSupabase.operations.length, 0);
});

// =============================================================================
// 7. Double submission and attachment-failure safety
// =============================================================================

test('Phase 4D: the submission form guards against duplicate dispatches and duplicate reports', () => {
  const source = readSource('components/reports/report-submission-form.tsx');

  assert.ok(
    /submissionLockedRef/.test(source),
    'The form must keep a single-flight lock so a double click cannot create two reports'
  );
  assert.ok(
    /if\s*\(submissionLockedRef\.current\)\s*\{[\s\S]{0,200}e\.preventDefault\(\)/.test(source),
    'The single-flight lock must cancel the second submission attempt'
  );
  assert.ok(
    /disabled=\{isPending\s*\|\|\s*isUploadingAttachments\s*\|\|\s*referenceDataUnavailable\}/.test(source),
    'The submit button must be disabled while a submission is in flight or the catalogs are unavailable'
  );
  assert.ok(
    /No duplicate report is created/.test(source),
    'The attachment failure notice must state that the report already exists and no duplicate is created'
  );
  assert.ok(
    /dismissedReportId/.test(source),
    'The success screen must be dismissible so "Submit Another Report" returns to a blank form'
  );
});

test('Phase 4D: the report submission form disables submission when reference data is unavailable', () => {
  const source = readSource('components/reports/report-submission-form.tsx');
  assert.ok(
    /referenceDataUnavailable/.test(source),
    'The form must track the reference-data availability state'
  );
  assert.ok(
    /Submission Unavailable/.test(source),
    'The form must render an explicit unavailable state instead of an empty category list'
  );
});

test('Phase 4D.2: the photo picker is NOT part of the report submission form', () => {
  const source = readSource('components/reports/report-submission-form.tsx');

  const formOpen = source.indexOf('<form action={formAction}');
  const formClose = source.indexOf('</form>');
  assert.ok(formOpen > 0 && formClose > formOpen, 'The report form must be locatable');

  const insideForm = source.slice(formOpen, formClose);
  const fileInputIndex = source.indexOf('id="report-photo-input"');
  assert.ok(fileInputIndex > 0, 'The photo picker must exist');

  assert.ok(
    fileInputIndex > formClose,
    'The photo picker must be rendered AFTER the </form> element. A file control inside a form ' +
      'is submitted with it, which posts the photo bytes to the report-submission Server Action ' +
      'and exceeds the Server Action body-size limit.'
  );
  assert.ok(
    !/type="file"/.test(insideForm),
    'No file control may live inside the report submission form'
  );

  // The label must point at the relocated control.
  assert.ok(
    /htmlFor="report-photo-input"/.test(source),
    'The visible "Choose Image Files" control must reference the relocated input'
  );
});

test('Phase 4D.2: the Server Action body limit accommodates one maximum-size attachment', () => {
  const config = readSource('next.config.ts');

  assert.ok(
    /serverActions\s*:\s*\{[\s\S]*?bodySizeLimit/.test(config),
    'next.config.ts must configure experimental.serverActions.bodySizeLimit'
  );

  const limitMatch = /bodySizeLimit\s*:\s*['"]?(\d+)\s*(kb|mb|gb)?['"]?/i.exec(config);
  assert.ok(limitMatch, 'The configured body size limit must be readable');

  const amount = Number(limitMatch[1]);
  const unit = (limitMatch[2] ?? 'b').toLowerCase();
  const limitBytes = amount * { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[unit];

  // The server-side validator caps a single attachment at 10 MB.
  const validationSource = readSource('utils/reports/validation.ts');
  const capMatch = /MAX_ATTACHMENT_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(validationSource);
  assert.ok(capMatch, 'The per-attachment byte cap must be readable');
  const capBytes = Number(capMatch[1]) * Number(capMatch[2]) * Number(capMatch[3]);

  assert.ok(
    limitBytes > capBytes,
    `The Server Action body limit (${limitBytes} bytes) must exceed the maximum single ` +
      `attachment size (${capBytes} bytes) so an allowed upload is never rejected by the framework`
  );
});

test('Phase 4D.2: the proxy body buffer limit is at least as large as the Server Action limit', () => {
  const config = readSource('next.config.ts');

  // Next.js buffers the request body in memory whenever a proxy is configured and TRUNCATES
  // anything above the limit, which corrupts a multipart upload ("Unexpected end of form").
  // The default is 10 MB — smaller than the 10 MB per-attachment cap — so it must be raised.
  assert.ok(
    /proxyClientMaxBodySize\s*:/.test(config),
    'next.config.ts must configure experimental.proxyClientMaxBodySize'
  );

  const parseLimit = (expression) => {
    const match = /['"]?(\d+)\s*(b|kb|mb|gb)?['"]?/i.exec(expression);
    if (!match) return null;
    const unit = (match[2] ?? 'b').toLowerCase();
    return (
      Number(match[1]) * { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[unit]
    );
  };

  const actionLimit = parseLimit(
    /bodySizeLimit\s*:\s*([^,\n}]+)/.exec(config)?.[1] ?? ''
  );
  const proxyLimit = parseLimit(
    /proxyClientMaxBodySize\s*:\s*([^,\n}]+)/.exec(config)?.[1] ?? ''
  );

  assert.ok(actionLimit, 'The Server Action body limit must be readable');
  assert.ok(proxyLimit, 'The proxy body buffer limit must be readable');

  assert.ok(
    proxyLimit >= actionLimit,
    `The proxy buffer limit (${proxyLimit} bytes) must be at least the Server Action limit ` +
      `(${actionLimit} bytes); otherwise the body is truncated before the action sees it`
  );

  const validationSource = readSource('utils/reports/validation.ts');
  const capMatch = /MAX_ATTACHMENT_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/.exec(validationSource);
  const capBytes = Number(capMatch[1]) * Number(capMatch[2]) * Number(capMatch[3]);

  assert.ok(
    proxyLimit > capBytes,
    `The proxy buffer limit (${proxyLimit} bytes) must exceed the maximum single attachment ` +
      `size (${capBytes} bytes)`
  );
});
