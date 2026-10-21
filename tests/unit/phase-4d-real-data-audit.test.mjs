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

  // The insert must carry only server-derived authority fields.
  const insertOp = mockSupabase.operations.find((op) => op.type === 'insert');
  assert.ok(insertOp, 'Expected a reports insert operation');
  assert.equal(insertOp.table, 'reports');
  assert.equal(insertOp.payload.reporter_id, UUID_STUDENT);
  assert.equal(insertOp.payload.status, 'submitted');
  assert.equal(insertOp.payload.confirmed_priority, null);
  assert.equal(insertOp.payload.is_urgent_hazard, true);
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
  });

  const formData = new FormData();
  formData.set('title', 'Broken ceiling light in lecture hall');
  formData.set('description', 'Two ceiling panels have fallen near the front row.');
  formData.set('categoryId', UUID_CATEGORY);
  formData.set('locationId', UUID_LOCATION);
  formData.set('isUrgentHazard', 'on');

  const result = await submitReportAction(INITIAL_ACTION_STATE, formData, {
    user: studentUser,
    supabase: mockSupabase,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.data?.reportNumber, 'RPT-000043');

  const insertOp = mockSupabase.operations.find((op) => op.type === 'insert');
  assert.equal(insertOp.payload.is_urgent_hazard, true);
  assert.equal(insertOp.payload.title, 'Broken ceiling light in lecture hall');
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
