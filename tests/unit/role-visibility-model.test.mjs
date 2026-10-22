/**
 * CMIRS — Phase 4D.2 Role Visibility Model
 *
 * Purpose
 * -------
 * Two independent guarantees are asserted here:
 *
 * 1. The INTENDED report-visibility rules of `public.can_view_report()` are encoded as a
 *    pure model, and the access matrix is asserted. This is the contract the database
 *    function must implement:
 *
 *      - oversight roles (coordinator / administrator / management) may view every report;
 *      - a reporter may view their own report regardless of their current role;
 *      - a technician may view a report on which they hold a qualifying assignment
 *        (any assignment status EXCEPT 'declined');
 *      - nobody else may view anything.
 *
 * 2. The EFFECTIVE SQL definition of the function (the last definition in migration
 *    filename order) is parsed and checked to prove that it implements exactly that model:
 *      - the technician branch compares `public.assignments.report_id` against the report
 *        id ARGUMENT (not against the column itself, which would degenerate into
 *        `a.report_id = a.report_id` and grant every technician access to every report
 *        that has any assignment);
 *      - the reporter branch compares `public.reports.id` against the same argument;
 *      - the qualification predicate still excludes declined assignments;
 *      - no fourth visibility branch exists.
 *
 * The SQL-level assertions are what stop a future "fix" from widening access.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');
const migrationsDir = path.join(appRoot, 'supabase', 'migrations');

// ---------------------------------------------------------------------------
// The intended visibility model (pure)
// ---------------------------------------------------------------------------

/**
 * Mirrors the approved `public.can_view_report()` authorization rules.
 *
 * @param {object} viewer  { id, role }
 * @param {object} report  { id, reporter_id }
 * @param {object[]} assignments  [{ report_id, technician_id, status }]
 */
export function canViewReport(viewer, report, assignments = []) {
  if (!viewer) return false;
  if (['coordinator', 'administrator', 'management'].includes(viewer.role)) return true;

  if (report.reporter_id === viewer.id) return true;

  if (
    viewer.role === 'technician' &&
    assignments.some(
      (a) =>
        a.report_id === report.id &&
        a.technician_id === viewer.id &&
        a.status !== 'declined'
    )
  ) {
    return true;
  }

  return false;
}

const student = { id: 'student-1', role: 'student_personnel' };
const otherStudent = { id: 'student-2', role: 'student_personnel' };
const technician = { id: 'tech-1', role: 'technician' };
const otherTechnician = { id: 'tech-2', role: 'technician' };
const coordinator = { id: 'coord-1', role: 'coordinator' };
const administrator = { id: 'admin-1', role: 'administrator' };
const management = { id: 'mgmt-1', role: 'management' };

const report = { id: 'report-1', reporter_id: 'student-1' };
const otherReport = { id: 'report-2', reporter_id: 'student-2' };

const assigned = { report_id: 'report-1', technician_id: 'tech-1', status: 'assigned' };
const declined = { report_id: 'report-1', technician_id: 'tech-1', status: 'declined' };
const onHold = { report_id: 'report-1', technician_id: 'tech-1', status: 'on_hold' };
const completed = { report_id: 'report-1', technician_id: 'tech-1', status: 'completed' };
const otherAssignment = { report_id: 'report-2', technician_id: 'tech-1', status: 'assigned' };

// ---------------------------------------------------------------------------
// Tests — the access matrix
// ---------------------------------------------------------------------------

test('Phase 4D.2: the reporter may view their own report and nobody else may', () => {
  assert.equal(canViewReport(student, report, []), true, 'Reporter sees own report');
  assert.equal(canViewReport(otherStudent, report, []), false, 'Another student may not see it');
  assert.equal(canViewReport(technician, report, []), false, 'An unassigned technician may not see it');
  assert.equal(canViewReport(null, report, []), false, 'No viewer means no access');
});

test('Phase 4D.2: a technician may view exactly the reports they are assigned to', () => {
  assert.equal(canViewReport(technician, report, [assigned]), true, 'Assigned technician sees it');
  assert.equal(canViewReport(technician, report, [onHold]), true, 'On-hold assignment still qualifies');
  assert.equal(canViewReport(technician, report, [completed]), true, 'Completed assignment still qualifies');
  assert.equal(
    canViewReport(technician, report, [declined]),
    false,
    'A declined assignment does NOT qualify (APPROVED OD-NEW-4)'
  );
  assert.equal(
    canViewReport(otherTechnician, report, [assigned]),
    false,
    'A different technician may not see it'
  );
  assert.equal(
    canViewReport(technician, otherReport, [otherAssignment]),
    true,
    'A technician sees the report they are assigned to, regardless of who reported it'
  );
  assert.equal(
    canViewReport(technician, otherReport, [assigned]),
    false,
    'An assignment on a DIFFERENT report grants no access to this one'
  );
});

test('Phase 4D.2: oversight roles retain full operational visibility', () => {
  for (const role of [coordinator, administrator, management]) {
    assert.equal(canViewReport(role, report, []), true, `${role.role} sees every report`);
    assert.equal(canViewReport(role, otherReport, []), true, `${role.role} sees every report`);
  }
});

test('Phase 4D.2: a reporter who is also a technician keeps reporter access', () => {
  const hybrid = { id: 'student-1', role: 'technician' };
  assert.equal(
    canViewReport(hybrid, report, []),
    true,
    'The reporter rule applies regardless of the current role'
  );
});

// ---------------------------------------------------------------------------
// Tests — the effective SQL definition implements that model
// ---------------------------------------------------------------------------

function readEffectiveFunctionBody() {
  const PARAM_TYPES = 'UUID|TEXT|BOOLEAN|INTEGER|user_role|assignment_status|report_status|priority_level';
  let effective = null;

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    const pattern = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?can_view_report\\s*\\(([\\s\\S]*?)\\)\\s*` +
        `RETURNS[\\s\\S]*?AS\\s+\\$([A-Za-z_]*)\\$([\\s\\S]*?)\\$\\2\\$`,
      'gi'
    );
    let match;
    while ((match = pattern.exec(sql)) !== null) {
      effective = {
        file,
        params: match[1].trim(),
        body: match[3],
        paramNames: [...match[1].matchAll(new RegExp(`(\\w+)\\s+(?:${PARAM_TYPES})`, 'gi'))].map(
          (m) => m[1]
        ),
      };
    }
  }

  return effective;
}

test('Phase 4D.2: the effective SQL compares assignments against the report id ARGUMENT', () => {
  const effective = readEffectiveFunctionBody();
  assert.ok(effective, 'public.can_view_report must be defined in the migration set');
  const body = effective.body;

  // The technician branch must compare the assignment's report_id with something that is
  // derived from the function argument — never with the column itself.
  const technicianBranch = /IF\s+caller_role\s*=\s*'technician'[\s\S]*?END\s+IF\s*;/i.exec(body);
  assert.ok(technicianBranch, 'The technician branch must exist');

  const branch = technicianBranch[0];

  assert.ok(
    !/a\.report_id\s*=\s*a\.report_id/i.test(branch),
    'The technician branch must NOT compare assignments.report_id with itself — that would ' +
      'grant every technician access to every report that has any assignment'
  );

  assert.match(
    branch,
    /a\.report_id\s*=\s*[A-Za-z_][A-Za-z0-9_]*/i,
    'The technician branch must compare assignments.report_id with a report id identifier'
  );

  // That identifier must be the local that is assigned from the function argument.
  const localName = /a\.report_id\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(branch)?.[1];
  assert.ok(localName, 'The comparison identifier must be captured');
  assert.notEqual(
    localName.toLowerCase(),
    'report_id',
    'The comparison identifier must not be the bare parameter name, which would be ambiguous ' +
      'with assignments.report_id'
  );
  assert.match(
    body,
    new RegExp(`${localName}\\s*:=\\s*${effective.paramNames[0]}\\s*;`, 'i'),
    `The local ${localName} must be assigned from the function argument ${effective.paramNames[0]}`
  );

  // The reporter branch must use the same identifier.
  const reporterBranch = /IF\s+EXISTS\s*\([\s\S]*?END\s+IF\s*;/i.exec(body);
  assert.ok(reporterBranch, 'The reporter branch must exist');
  assert.match(
    reporterBranch[0],
    new RegExp(`r\\.id\\s*=\\s*${localName}\\b`, 'i'),
    'The reporter branch must compare reports.id with the same report id identifier'
  );
});

test('Phase 4D.2: the effective SQL preserves the qualification predicate and the branch count', () => {
  const effective = readEffectiveFunctionBody();
  const body = effective.body;

  assert.match(
    body,
    /a\.status\s*!=\s*'declined'/i,
    'Declined assignments must still be excluded'
  );
  assert.match(
    body,
    /a\.technician_id\s*=\s*auth\.uid\(\)/i,
    'The technician must be the assigned technician'
  );
  assert.match(
    body,
    /r\.reporter_id\s*=\s*auth\.uid\(\)/i,
    'The reporter must be the report owner'
  );
  assert.match(
    body,
    /caller_role\s+IN\s*\(\s*'coordinator'\s*,\s*'administrator'\s*,\s*'management'\s*\)/i,
    'Oversight roles must still see all reports'
  );

  assert.equal(
    (body.match(/\bEND\s+IF\s*;/gi) ?? []).length,
    3,
    'Exactly three visibility branches may exist — no branch may be added'
  );
  assert.equal((body.match(/RETURN TRUE/gi) ?? []).length, 3);
  assert.equal((body.match(/RETURN FALSE/gi) ?? []).length, 1);
});

test('Phase 4D.2: displayed queue counts come from the complete authorized dataset', () => {
  const listSource = readFileSync(
    path.join(appRoot, 'components', 'dashboard', 'report-list.tsx'),
    'utf8'
  );

  // The "All" tab must use the server-side total, not the number of rows on the page.
  assert.match(
    listSource,
    /All Active \(\{totalCount \?\? reports\.length\}\)/,
    'The "All" tab count must use the authoritative server total when it is available'
  );

  // The dashboard must pass the server total and disclose a truncated page.
  const dashboardSource = readFileSync(path.join(appRoot, 'app', 'page.tsx'), 'utf8');
  assert.match(
    dashboardSource,
    /totalCount=\{queueResult\.totalCount\}/,
    'The dashboard must pass the authoritative total to the report list'
  );
  assert.match(
    dashboardSource,
    /queueResult\.totalCount\s*>\s*liveReports\.length/,
    'The dashboard must disclose that only part of the authorized dataset is displayed'
  );

  // The report queue page must pass the authoritative total as well.
  const queueSource = readFileSync(path.join(appRoot, 'app', 'reports', 'page.tsx'), 'utf8');
  assert.match(
    queueSource,
    /totalCount=\{queueResult\.totalCount\}/,
    'The report queue page must pass the authoritative total to the report list'
  );
});

test('Phase 4D.2: KPI mapping stays aligned with the report list filters', () => {
  const transformSource = readFileSync(path.join(appRoot, 'utils', 'reports', 'transform.ts'), 'utf8');
  const listSource = readFileSync(
    path.join(appRoot, 'components', 'dashboard', 'report-list.tsx'),
    'utf8'
  );

  // Urgent & Critical: KPI counts an urgent hazard flag OR a confirmed critical priority.
  assert.match(
    transformSource,
    /report\.is_urgent_hazard\s*\|\|\s*report\.confirmed_priority\s*===\s*'critical'/,
    'The urgent-hazard KPI must count flagged hazards and confirmed critical priority'
  );
  assert.match(
    listSource,
    /report\.isUrgentHazard\s*\|\|\s*report\.priority\s*===\s*'critical'/,
    'The "Urgent & Critical" filter must match the KPI definition'
  );

  // Pending Review and In Progress must use the same status sets in both places.
  assert.match(
    transformSource,
    /report\.status\s*===\s*'submitted'\s*\|\|\s*report\.status\s*===\s*'under_review'/,
    'The pending-review KPI must use the submitted/under_review status set'
  );
  assert.match(
    listSource,
    /report\.status\s*===\s*'submitted'\s*\|\|\s*report\.status\s*===\s*'under_review'/,
    'The "Pending Review" filter must use the same status set'
  );
  assert.match(
    transformSource,
    /report\.status\s*===\s*'assigned'\s*\|\|\s*report\.status\s*===\s*'in_progress'\s*\|\|\s*report\.status\s*===\s*'on_hold'/,
    'The in-progress KPI must use the assigned/in_progress/on_hold status set'
  );
  assert.match(
    listSource,
    /report\.status\s*===\s*'assigned'\s*\|\|\s*report\.status\s*===\s*'in_progress'\s*\|\|\s*report\.status\s*===\s*'on_hold'/,
    'The "In Progress" filter must use the same status set'
  );
});

test('Phase 4D.2: the application never converts a failed query into a successful empty result', () => {
  // The DAL must return an `error` alongside the empty data set on failure.
  const dalSource = readFileSync(path.join(appRoot, 'utils', 'reports', 'dal.ts'), 'utf8');
  const failureReturns = [...dalSource.matchAll(/isLiveData:\s*true,\s*\n\s*error:/g)];
  assert.ok(
    failureReturns.length >= 3,
    'Each DAL read failure path must set an error together with the empty data set'
  );

  // The report list must render a failure state instead of the empty state.
  const listSource = readFileSync(
    path.join(appRoot, 'components', 'dashboard', 'report-list.tsx'),
    'utf8'
  );
  const errorBlockIndex = listSource.indexOf('if (error) {');
  const emptyBlockIndex = listSource.indexOf('if (reports.length === 0) {');
  assert.ok(errorBlockIndex >= 0, 'The report list must handle an error state');
  assert.ok(emptyBlockIndex >= 0, 'The report list must still handle a genuinely empty result');
  assert.ok(
    errorBlockIndex < emptyBlockIndex,
    'The error state must be evaluated before the empty state'
  );
  assert.match(
    listSource,
    /Report data could not be loaded/,
    'The failure state must be explicit, not a friendly empty state'
  );

  // The dashboard must forward the DAL error into the list and the KPI cards.
  const dashboardSource = readFileSync(path.join(appRoot, 'app', 'page.tsx'), 'utf8');
  assert.match(
    dashboardSource,
    /error=\{queueResult\.error\}/,
    'The dashboard must forward the queue error to the report list'
  );
  assert.match(
    dashboardSource,
    /unavailable=\{Boolean\(kpiResult\.error\)\}/,
    'The dashboard must mark the KPI cards unavailable when the KPI query failed'
  );

  // The report queue page must forward the error as well.
  const queueSource = readFileSync(path.join(appRoot, 'app', 'reports', 'page.tsx'), 'utf8');
  assert.match(
    queueSource,
    /error=\{queueResult\.error\}/,
    'The report queue page must forward the query error to the report list'
  );
});
