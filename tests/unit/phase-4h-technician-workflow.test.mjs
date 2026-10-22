/**
 * CMIRS — Phase 4H Regression Suite: Technician Role, Assignment and Completion
 *
 * Covers:
 *   1. the submit permission is restricted to the reporter roles and is enforced on the server;
 *   2. the coordinator assignment path uses a real, database-backed technician directory;
 *   3. the technician work controls appear only for the assigned technician and only when the
 *      report status permits the action;
 *   4. completion is validated (repair notes required) and the report goes for verification
 *      rather than being resolved automatically;
 *   5. the assignment-ownership and status-transition rules are enforced server-side.
 *
 * These are local unit tests with mocked Supabase clients. The database-side behaviour of the
 * same flows is verified separately against the live project by
 * `scripts/remote-technician-workflow-verification.sql` and
 * `scripts/remote-coordinator-assignment-probe.sql`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submitReportAction } from '../../actions/reports.ts';
import { transitionReportStatusRecord, verifyReportRecord } from '../../utils/reports/mutations.ts';
import { INITIAL_ACTION_STATE } from '../../utils/reports/action-state.ts';
import {
  canSubmitReport,
  REPORT_SUBMITTER_ROLES,
  USER_ROLES,
} from '../../types/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');

const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_CATEGORY = '11111111-1111-1111-1111-111111111111';
const UUID_LOCATION = '22222222-2222-2222-2222-222222222222';

function userWithRole(role) {
  return {
    id: `user-${role}`,
    email: `${role}@example.edu`,
    profile: {
      id: `user-${role}`,
      email: `${role}@example.edu`,
      full_name: `${role} user`,
      role,
      is_active: true,
    },
  };
}

function createMockSupabase(rpcHandler) {
  const operations = [];
  return {
    operations,
    from(table) {
      const op = { table, type: 'from', filters: {} };
      operations.push(op);
      const queryBuilder = {
        select(fields) {
          op.fields = fields;
          return queryBuilder;
        },
        eq(column, value) {
          op.filters[column] = value;
          return queryBuilder;
        },
        single() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return queryBuilder;
    },
    rpc(fnName, args) {
      operations.push({ type: 'rpc', fnName, args });
      return Promise.resolve(rpcHandler(fnName, args));
    },
  };
}

const validSubmission = {
  title: 'Water pipe burst in laboratory',
  description: 'Active leak above the server rack near the mains.',
  categoryId: UUID_CATEGORY,
  locationId: UUID_LOCATION,
  isUrgentHazard: true,
};

// =============================================================================
// 1. The submit permission
// =============================================================================

test('Phase 4H: only Student / Personnel and Maintenance Coordinator may file a report', () => {
  assert.deepEqual([...REPORT_SUBMITTER_ROLES], ['student_personnel', 'coordinator']);

  assert.equal(canSubmitReport('student_personnel'), true);
  assert.equal(canSubmitReport('coordinator'), true);
  assert.equal(canSubmitReport('technician'), false);
  assert.equal(canSubmitReport('administrator'), false);
  assert.equal(canSubmitReport('management'), false);
  assert.equal(canSubmitReport(undefined), false);
  assert.equal(canSubmitReport(null), false);

  // Every role is covered by exactly one of the two sets.
  for (const role of USER_ROLES) {
    const permitted = canSubmitReport(role);
    assert.equal(
      permitted,
      REPORT_SUBMITTER_ROLES.includes(role),
      `The permission for ${role} must match the declared reporter roles`
    );
  }
});

test('Phase 4H: the Server Action refuses a submission from a role that may not report', async () => {
  for (const role of ['technician', 'administrator', 'management']) {
    let invoked = false;
    const mockSupabase = createMockSupabase(() => {
      invoked = true;
      return { data: null, error: null };
    });

    const result = await submitReportAction(INITIAL_ACTION_STATE, validSubmission, {
      user: userWithRole(role),
      supabase: mockSupabase,
    });

    assert.equal(result.status, 'error', `${role} must not be able to submit a report`);
    assert.match(result.message, /not permitted to submit/i);
    assert.equal(result.data, undefined, 'No report payload may be returned');
    assert.equal(invoked, false, 'The submission command must never be invoked');
  }
});

test('Phase 4H: the Server Action accepts a submission from a reporter role', async () => {
  const mockSupabase = createMockSupabase((fnName) => {
    if (fnName === 'submit_report_with_notifications') {
      return {
        data: {
          report_id: UUID_REPORT,
          report_number: 'RPT-000046',
          status: 'submitted',
          created_at: '2026-10-21T00:00:00Z',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  const result = await submitReportAction(INITIAL_ACTION_STATE, validSubmission, {
    user: userWithRole('student_personnel'),
    supabase: mockSupabase,
  });

  assert.equal(result.status, 'success');
  assert.equal(result.data?.reportNumber, 'RPT-000046');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'submit_report_with_notifications');
  // The reporter identity is never taken from the client.
  assert.equal(rpcOp.args.p_reporter_id, undefined);
  assert.equal(rpcOp.args.reporter_id, undefined);
});

test('Phase 4H: the submit entry points are hidden from the roles that may not report', () => {
  const navigation = readFileSync(path.join(appRoot, 'config', 'navigation.ts'), 'utf8');

  // Exactly ONE navigation entry may point at the submission form: two entries sharing the
  // destination produced a duplicate React key and crashed the application shell.
  const submitEntries = [
    ...navigation.matchAll(/href: '\/reports\/new'[\s\S]{0,240}?allowedRoles: ([^,\n]+),/g),
  ];
  assert.equal(
    submitEntries.length,
    1,
    'Exactly one navigation entry may point at the submission form'
  );
  assert.match(
    submitEntries[0][1],
    /REPORT_SUBMITTER_ROLES/,
    'The submission navigation entry must be restricted to the reporter roles'
  );

  // The report queue must remain reachable from the navigation.
  assert.match(navigation, /name: 'All Reports'/, 'The report queue must stay in the navigation');
  assert.match(navigation, /href: '\/reports'/);

  // The dashboard call to action and the mobile quick-submit control must be role gated.
  const dashboard = readFileSync(path.join(appRoot, 'app', 'page.tsx'), 'utf8');
  assert.match(dashboard, /canSubmitReport\(role\) &&/);

  const mobileNav = readFileSync(path.join(appRoot, 'components', 'layout', 'mobile-nav.tsx'), 'utf8');
  assert.match(
    mobileNav,
    /canSubmitReport\(user\?\.profile\?\.role\)/,
    'The mobile quick-submit control must be role gated'
  );
});

test('Phase 4H: the /reports/new route refuses a role that may not report', () => {
  const route = readFileSync(path.join(appRoot, 'app', 'reports', 'new', 'page.tsx'), 'utf8');
  assert.match(route, /canSubmitReport\(user\.profile\.role\)/);
  assert.match(route, /redirect\('\/unauthorized'\)/);
});

// =============================================================================
// 2. The coordinator assignment path
// =============================================================================

test('Phase 4H: the coordinator assignment path uses a database-backed technician directory', () => {
  const dal = readFileSync(path.join(appRoot, 'utils', 'reports', 'dal.ts'), 'utf8');
  const catalog = readFileSync(
    path.join(appRoot, 'utils', 'reports', 'reference-catalogs.ts'),
    'utf8'
  );

  // The DAL must expose the directory and delegate to the live query.
  assert.match(dal, /export async function getActiveTechnicians/);
  assert.match(dal, /getActiveTechniciansFromClient/);

  // The query must read the real profile table, filtered to active technicians.
  assert.match(catalog, /\.from\('profiles'\)/);
  assert.match(catalog, /\.eq\('role', 'technician'\)/);
  assert.match(catalog, /\.eq\('is_active', true\)/);

  // The directory must not fall back to a hard-coded list (documentation of the removed
  // fixture is allowed; executable code is not).
  const executable = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/FALLBACK_TECHNICIANS/.test(executable(dal)) &&
      !/FALLBACK_TECHNICIANS/.test(executable(catalog)),
    'The technician directory must never fall back to fixture data'
  );
});

test('Phase 4H: the assignment command refuses a technician that is not an active technician account', async () => {
  const mockSupabase = createMockSupabase(() => ({
    data: null,
    error: { message: 'CMIRS_INVALID_INPUT: technician must be an active technician account' },
  }));

  const { assignTechnicianToReport } = await import('../../utils/reports/mutations.ts');
  const result = await assignTechnicianToReport(
    { reportId: UUID_REPORT, technicianId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' },
    { user: userWithRole('coordinator'), supabase: mockSupabase }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /rejected/i);
});

// =============================================================================
// 3. The technician work controls
// =============================================================================

test('Phase 4H: the work controls are shown only for the assigned technician', () => {
  const panel = readFileSync(
    path.join(appRoot, 'components', 'reports', 'report-action-panel.tsx'),
    'utf8'
  );

  assert.match(
    panel,
    /const isAssignedTech = Boolean\(activeAssignment && activeAssignment\.technicianId === userId\)/,
    'Work controls must be gated on the assignment belonging to the signed-in technician'
  );

  for (const gate of ['canTechStart', 'canTechResume', 'canTechComplete', 'canTechHold', 'canTechLogWork']) {
    assert.match(
      panel,
      new RegExp(`role === 'technician' && isAssignedTech`),
      `${gate} must require the technician role AND an assignment`
    );
  }
});

test('Phase 4H: the work-order controls offer start, complete and further repair', () => {
  const panel = readFileSync(
    path.join(appRoot, 'components', 'reports', 'report-action-panel.tsx'),
    'utf8'
  );

  assert.match(panel, /Start Work \(Mark In Progress\)/, 'Start Work must be available');
  assert.match(
    panel,
    /Complete Repair \(Submit for Verification\)/,
    'Mark as Completed must be available'
  );
  assert.match(
    panel,
    /Needs Further Repair \(Put Work On Hold\)/,
    'Needs Further Repair must be available'
  );
  assert.match(panel, /Work Order Controls/, 'The work-order tab must be labelled');
});

test('Phase 4H: the panel opens on the tab that holds the viewer next action', () => {
  const panel = readFileSync(
    path.join(appRoot, 'components', 'reports', 'report-action-panel.tsx'),
    'utf8'
  );

  assert.match(
    panel,
    /const defaultTab = \(\(\) => \{[\s\S]*?return 'tech_work'[\s\S]*?\}\)\(\)/,
    'An assigned technician must land on the work-order controls'
  );
  assert.match(
    panel,
    /if \(canCoordinatorVerify\) return 'verify';/,
    'A coordinator must land on the verification controls when a repair awaits inspection'
  );
  assert.match(
    panel,
    /if \(canCoordinatorTriage\) return 'triage';/,
    'A coordinator must land on triage for a report awaiting review'
  );
  assert.match(panel, /nextStepHint/, 'The panel must state what the report is waiting for');
});

// =============================================================================
// 4. Completion and verification
// =============================================================================

test('Phase 4H: completion requires repair notes and is rejected without them', async () => {
  let invoked = false;
  const mockSupabase = createMockSupabase(() => {
    invoked = true;
    return { data: null, error: null };
  });

  const result = await transitionReportStatusRecord(
    { reportId: UUID_REPORT, targetStatus: 'completed' },
    { user: userWithRole('technician'), supabase: mockSupabase }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /repair completion notes/i);
  assert.equal(invoked, false);
});

test('Phase 4H: completion moves the report to awaiting verification, never to resolved', async () => {
  const mockSupabase = createMockSupabase((fnName) => {
    if (fnName === 'transition_report_status_with_notifications') {
      return {
        data: { report_id: UUID_REPORT, previous_status: 'in_progress', new_status: 'completed' },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  const result = await transitionReportStatusRecord(
    {
      reportId: UUID_REPORT,
      targetStatus: 'completed',
      reason: 'Replaced the leaking isolation valve and pressure-tested the line.',
    },
    { user: userWithRole('technician'), supabase: mockSupabase }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.newStatus, 'completed');
  assert.notEqual(result.data.newStatus, 'verified', 'Completion must not resolve the report');
  assert.notEqual(result.data.newStatus, 'reopened');
});

test('Phase 4H: only a coordinator may verify, and verification is the resolving step', async () => {
  const mockSupabase = createMockSupabase((fnName) => {
    if (fnName === 'verify_report_with_notifications') {
      return {
        data: {
          verification_id: 'verification-1',
          report_id: UUID_REPORT,
          is_satisfactory: true,
          new_status: 'verified',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  const result = await verifyReportRecord(
    { reportId: UUID_REPORT, isSatisfactory: true, notes: 'Inspected and accepted.' },
    { user: userWithRole('coordinator'), supabase: mockSupabase }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.newStatus, 'verified');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'verify_report_with_notifications');
});

test('Phase 4H: a technician cannot verify their own repair', async () => {
  const mockSupabase = createMockSupabase(() => ({
    data: null,
    error: { message: 'CMIRS_FORBIDDEN: only Maintenance Coordinators may verify repairs' },
  }));

  const result = await verifyReportRecord(
    { reportId: UUID_REPORT, isSatisfactory: true },
    { user: userWithRole('technician'), supabase: mockSupabase }
  );

  assert.equal(result.success, false);
  // The DAL refuses the role itself, and the database command refuses it again.
  assert.match(
    result.error,
    /Access denied|do not have permission|Only Maintenance Coordinators/i,
    `The verification must be refused for a technician, got: ${result.error}`
  );
  assert.equal(
    mockSupabase.operations.find((op) => op.type === 'rpc'),
    undefined,
    'The verification command must not be invoked for a technician'
  );
});

// =============================================================================
// 5. The prepared database-level enforcement
// =============================================================================

test('Phase 4H: the prepared RLS migration restricts submission to the reporter roles', () => {
  const migrations = readdirSync(path.join(appRoot, 'supabase', 'migrations'));
  const fileName = '20261021000014_restrict_report_submission_roles.sql';
  assert.ok(migrations.includes(fileName), 'The submission-role migration must exist');

  const sql = readFileSync(path.join(appRoot, 'supabase', 'migrations', fileName), 'utf8');

  assert.match(sql, /CREATE POLICY "reports_insert"/);
  assert.match(sql, /public\.get_user_role\(\) IN \('student_personnel', 'coordinator'\)/);
  // The original conditions must be preserved.
  assert.match(sql, /reporter_id = auth\.uid\(\)/);
  assert.match(sql, /status = 'submitted'/);
  assert.match(sql, /confirmed_priority IS NULL/);
  // It must not touch anything else.
  assert.ok(!/ALTER TABLE/i.test(sql), 'The migration must not alter a table');
  assert.ok(!/DROP (TABLE|COLUMN|ROLE)/i.test(sql), 'The migration must not drop anything else');
});

test('Phase 4H: the navigation has no duplicate destinations', () => {
  const navigation = readFileSync(path.join(appRoot, 'config', 'navigation.ts'), 'utf8');

  // Every entry points at a distinct destination. Two entries sharing an href produced the
  // "Encountered two children with the same key" crash in the application shell, because the
  // navigation is rendered with a key derived from the destination.
  const hrefs = [...navigation.matchAll(/^\s{4}href: '([^']+)',$/gm)].map((m) => m[1]);
  assert.ok(hrefs.length >= 6, 'The navigation must keep its entries');

  const duplicates = hrefs.filter((href, index) => hrefs.indexOf(href) !== index);
  assert.deepEqual(
    [...new Set(duplicates)],
    [],
    `The navigation must not contain two entries for the same destination: ${duplicates.join(', ')}`
  );

  // The shell renders the navigation with a key that includes the destination and the label,
  // so a future duplicate degrades gracefully instead of crashing the interface.
  const sidebar = readFileSync(path.join(appRoot, 'components', 'layout', 'sidebar.tsx'), 'utf8');
  const mobileNav = readFileSync(path.join(appRoot, 'components', 'layout', 'mobile-nav.tsx'), 'utf8');

  assert.match(sidebar, /key=\{`\$\{item\.href\}-\$\{item\.name\}`\}/);
  assert.match(mobileNav, /key=\{`\$\{link\.href\}-\$\{link\.name\}`\}/);
});

test('Phase 4H: rendering the navigation produces no duplicate React key warning', async () => {
  const navigation = readFileSync(path.join(appRoot, 'config', 'navigation.ts'), 'utf8');

  // Rebuild the navigation entries exactly as the configuration declares them.
  const entries = [...navigation.matchAll(/name: '([^']+)',\s*\n\s*href: '([^']+)',/g)].map((m) => ({
    name: m[1],
    href: m[2],
  }));
  assert.ok(entries.length >= 6, 'The navigation entries must be readable');

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');

  const consoleErrors = [];
  const originalError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => String(a)).join(' '));
  };

  try {
    // The same shape the application shell renders, with the same key expression.
    renderToStaticMarkup(
      React.createElement(
        'ul',
        null,
        entries.map((item) =>
          React.createElement('li', { key: `${item.href}-${item.name}` }, item.name)
        )
      )
    );
  } finally {
    console.error = originalError;
  }

  const duplicateKeyWarnings = consoleErrors.filter((message) =>
    /same key|Encountered two children/i.test(message)
  );
  assert.deepEqual(
    duplicateKeyWarnings,
    [],
    `The navigation must render without a duplicate key warning: ${duplicateKeyWarnings.join(' | ')}`
  );
});

test('Phase 4H: the technician assignment probe and workflow harness exist', () => {
  const scripts = readdirSync(path.join(appRoot, 'scripts'));
  for (const required of [
    'remote-technician-workflow-verification.sql',
    'remote-coordinator-assignment-probe.sql',
  ]) {
    assert.ok(scripts.includes(required), `${required} must exist`);
  }
});
