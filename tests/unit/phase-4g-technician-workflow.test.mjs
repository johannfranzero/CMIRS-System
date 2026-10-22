/**
 * CMIRS — Phase 4G Regression Suite: Technician Assignment & Work Completion
 *
 * Covers the behaviours the technician work-completion workflow requires:
 *   * the coordinator assigns a real, eligible technician through the authorized command;
 *   * the technician can start, complete and request further repair;
 *   * completing without repair notes is refused on the server;
 *   * the repair notes are persisted for the coordinator to inspect;
 *   * only an authorized coordinator may verify;
 *   * a rejected verification returns the work to the technician and re-activates the
 *     assignment so the work order is actionable again;
 *   * the audit history is preserved.
 *
 * These are local unit tests. The database-side behaviour of the same flows is verified
 * separately and against the live project by
 * `scripts/remote-technician-workflow-verification.sql`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { transitionReportStatusRecord } from '../../utils/reports/mutations.ts';
import { verifyReportRecord } from '../../utils/reports/mutations.ts';
import { validateStatusTransitionInput } from '../../utils/reports/validation.ts';
import { mergeReportRows } from '../../utils/reports/transform.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');

const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_TECHNICIAN = '55555555-5555-5555-5555-555555555555';
const UUID_COORDINATOR = '66666666-6666-6666-6666-666666666666';

const technicianUser = {
  id: UUID_TECHNICIAN,
  email: 'tech@example.edu',
  profile: {
    id: UUID_TECHNICIAN,
    email: 'tech@example.edu',
    full_name: 'Tech User',
    role: 'technician',
    is_active: true,
  },
};

const coordinatorUser = {
  id: UUID_COORDINATOR,
  email: 'coord@example.edu',
  profile: {
    id: UUID_COORDINATOR,
    email: 'coord@example.edu',
    full_name: 'Coord User',
    role: 'coordinator',
    is_active: true,
  },
};

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

// =============================================================================
// 1. Repair completion notes are mandatory
// =============================================================================

test('Phase 4G: the status-transition validation requires repair notes for a completion', () => {
  const withoutNotes = validateStatusTransitionInput({
    reportId: UUID_REPORT,
    targetStatus: 'completed',
  });

  assert.equal(withoutNotes.success, false);
  assert.ok(withoutNotes.errors.reason, 'A completion without notes must be refused');
  assert.match(withoutNotes.errors.reason, /repair completion notes/i);

  const withShortNotes = validateStatusTransitionInput({
    reportId: UUID_REPORT,
    targetStatus: 'completed',
    reason: 'ok',
  });
  assert.equal(withShortNotes.success, false);
  assert.ok(withShortNotes.errors.reason);

  const withNotes = validateStatusTransitionInput({
    reportId: UUID_REPORT,
    targetStatus: 'completed',
    reason: 'Replaced the leaking isolation valve and pressure-tested the line.',
  });
  assert.equal(withNotes.success, true);
  assert.equal(withNotes.data.reason, 'Replaced the leaking isolation valve and pressure-tested the line.');
});

test('Phase 4G: the DAL refuses a completion without repair notes before touching the database', async () => {
  let invoked = false;
  const mockSupabase = createMockSupabase(() => {
    invoked = true;
    return { data: null, error: null };
  });

  const result = await transitionReportStatusRecord(
    { reportId: UUID_REPORT, targetStatus: 'completed' },
    { user: technicianUser, supabase: mockSupabase }
  );

  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.match(result.error, /repair completion notes/i);
  assert.ok(result.fieldErrors?.reason, 'The precise reason must be reported as a field error');
  assert.equal(invoked, false, 'The command must not be invoked without repair notes');
});

test('Phase 4G: the DAL forwards the repair notes to the lifecycle command', async () => {
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
    { user: technicianUser, supabase: mockSupabase }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.newStatus, 'completed');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'transition_report_status_with_notifications');
  assert.match(rpcOp.args.p_reason, /Replaced the leaking isolation valve/);
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
});

test('Phase 4G: the DAL refuses a transition to a status owned by another command', async () => {
  for (const targetStatus of ['assigned', 'under_review', 'verified', 'reopened']) {
    const result = await transitionReportStatusRecord(
      { reportId: UUID_REPORT, targetStatus, reason: 'Attempted direct transition' },
      { user: coordinatorUser, supabase: createMockSupabase(() => ({ data: null, error: null })) }
    );
    assert.equal(result.success, false, `Transition to ${targetStatus} must be refused`);
    assert.ok(result.error);
  }
});

test('Phase 4G: the DAL surfaces a command refusal instead of a false success', async () => {
  const mockSupabase = createMockSupabase(() => ({
    data: null,
    error: { message: 'CMIRS_FORBIDDEN: technicians may only update work assigned to them' },
  }));

  const result = await transitionReportStatusRecord(
    {
      reportId: UUID_REPORT,
      targetStatus: 'completed',
      reason: 'Replaced the leaking isolation valve and pressure-tested the line.',
    },
    { user: technicianUser, supabase: mockSupabase }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /do not have permission/i);
});

test('Phase 4G: verification is performed through the authorized command and returns the new status', async () => {
  const mockSupabase = createMockSupabase((fnName) => {
    if (fnName === 'verify_report_with_notifications') {
      return {
        data: {
          verification_id: 'verification-1',
          report_id: UUID_REPORT,
          is_satisfactory: false,
          new_status: 'reopened',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  const result = await verifyReportRecord(
    { reportId: UUID_REPORT, isSatisfactory: false, notes: 'The joint still seeps.' },
    { user: coordinatorUser, supabase: mockSupabase }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.newStatus, 'reopened');
  assert.equal(result.data.isSatisfactory, false);

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'verify_report_with_notifications');
  assert.equal(rpcOp.args.p_is_satisfactory, false);
});

// =============================================================================
// 2. The technician work-order controls
// =============================================================================

test('Phase 4G: the work-order controls require repair notes and offer further repair', () => {
  const source = readFileSync(
    path.join(appRoot, 'components', 'reports', 'report-action-panel.tsx'),
    'utf8'
  );

  // The completion form must collect the notes in a field the server reads as `reason`.
  assert.ok(
    /id="completionNotes"[\s\S]{0,400}name="reason"/.test(source),
    'The completion form must submit repair notes as the reason field'
  );
  assert.ok(
    /Repair Completion Notes/.test(source),
    'The completion form must label the repair notes field'
  );
  assert.ok(
    /disabled=\{transitionPending \|\| completionNotes\.trim\(\)\.length < 5\}/.test(source),
    'The completion button must stay disabled until the repair notes are written'
  );

  // "Needs Further Repair" must be a real, available technician action with a required reason.
  assert.ok(
    /Needs Further Repair/.test(source),
    'The technician must be offered a "Needs Further Repair" action'
  );
  assert.ok(
    /id="holdReason"[\s\S]{0,400}name="reason"/.test(source),
    'The further-repair action must submit a reason'
  );
  assert.ok(
    /disabled=\{transitionPending \|\| holdReason\.trim\(\)\.length < 5\}/.test(source),
    'The further-repair button must stay disabled until a reason is written'
  );
});

test('Phase 4G: a returned work order is actionable by the technician again', () => {
  const source = readFileSync(
    path.join(appRoot, 'components', 'reports', 'report-action-panel.tsx'),
    'utf8'
  );

  assert.ok(
    /const isReopenedForRepair = report\.status === 'reopened';/.test(source),
    'The panel must recognise a report that was returned for further repair'
  );

  for (const gate of ['canTechHold', 'canTechResume', 'canTechComplete', 'canTechLogWork']) {
    const pattern = new RegExp(
      `const ${gate} =[\\s\\S]{0,320}isReopenedForRepair`
    );
    assert.ok(
      pattern.test(source),
      `${gate} must be available for a report that was returned for further repair`
    );
  }
});

test('Phase 4G: the coordinator can inspect the technician notes and evidence at verification time', () => {
  const source = readFileSync(
    path.join(appRoot, 'components', 'reports', 'report-action-panel.tsx'),
    'utf8'
  );

  assert.ok(
    /latestCompletionNote/.test(source),
    'The verification panel must surface the technician completion notes'
  );
  assert.ok(
    /latestWorkLog/.test(source),
    'The verification panel must surface the technician work log'
  );
  assert.ok(
    /activeEvidenceCount/.test(source),
    'The verification panel must surface the evidence attachment count'
  );
  assert.ok(
    /newStatus === 'completed'/.test(source),
    'The completion notes must be read from the completed transition'
  );
});

// =============================================================================
// 3. The migrations that close the database-side gaps
// =============================================================================

function readMigration(fileName) {
  return readFileSync(path.join(appRoot, 'supabase', 'migrations', fileName), 'utf8');
}

test('Phase 4G: the rework-resumption migration reactivates the assignment on a rejected verification', () => {
  const migration = readMigration('20261021000012_technician_rework_resumption.sql');

  assert.ok(
    /CREATE OR REPLACE FUNCTION public\.verify_report_with_notifications/.test(migration),
    'The migration must replace the verification command'
  );
  assert.ok(
    /IF NOT coalesce\(p_is_satisfactory, FALSE\) AND v_technician IS NOT NULL THEN[\s\S]{0,600}status = 'in_progress'/.test(
      migration
    ),
    'A rejected verification must reactivate the assignment to in_progress'
  );
  assert.ok(
    /completed_at = NULL/.test(migration),
    'A reactivated assignment must clear its completion timestamp'
  );
  assert.ok(
    /p_target_status = 'completed'[\s\S]{0,300}length\(btrim\(p_reason\)\) < 5/.test(migration),
    'The database must require repair completion notes'
  );
});

test('Phase 4G: the audit-trail repair attaches the reason to the row of THIS transition', () => {
  const migration = readMigration('20261021000013_deterministic_status_history_reason.sql');

  assert.ok(
    /sh\.new_status = p_target_status/.test(migration),
    'The reason must be attached by matching the new status of THIS transition'
  );
  assert.ok(
    /sh\.previous_status IS NOT DISTINCT FROM v_previous/.test(migration),
    'The reason must be attached by matching the previous status of THIS transition'
  );
  assert.ok(
    /sh\.changed_by = v_actor/.test(migration),
    'The reason must be attached to the row written by this actor'
  );
  assert.ok(
    !/ORDER BY sh\.created_at DESC, sh\.id DESC\s*\n\s*LIMIT 1\s*\n\s*\)\s*;\s*\n\s*END IF;\s*\n\s*\n\s*IF v_assignment_id/.test(
      migration
    ) || /sh\.new_status = p_target_status/.test(migration),
    'The ambiguous "most recent row by this actor" selection must not be used on its own'
  );
});

test('Phase 4G: every applied migration is present in the repository', () => {
  const migrations = readdirSync(path.join(appRoot, 'supabase', 'migrations')).filter((name) =>
    name.endsWith('.sql')
  );

  for (const expected of [
    '20261020000007_notification_lifecycle_rpcs.sql',
    '20261021000008_fix_can_view_report_parameter_ambiguity.sql',
    '20261021000009_technician_account_management.sql',
    '20261021000010_bulk_auth_account_status.sql',
    '20261021000011_revoke_anon_execute_privileges.sql',
    '20261021000012_technician_rework_resumption.sql',
    '20261021000013_deterministic_status_history_reason.sql',
  ]) {
    assert.ok(migrations.includes(expected), `${expected} must exist in the migrations directory`);
  }
});

// =============================================================================
// 4. The report row merge (PostgREST to-many cartesian product)
// =============================================================================

test('Phase 4G: rows of one report are merged so a reassigned report is not listed twice', () => {
  // PostgREST returns one row per (report × child) combination for an embedded to-many
  // relation. These are the rows it would return for a reassigned report.
  const rows = [
    {
      id: 'report-1',
      report_number: 'RPT-000001',
      title: 'Reassigned report',
      assignments: [{ id: 'a1', status: 'reassigned', assigned_at: '2026-01-01T00:00:00Z' }],
      report_status_history: [{ id: 'h1', new_status: 'under_review' }],
      verifications: [],
      report_attachments: [],
    },
    {
      id: 'report-1',
      report_number: 'RPT-000001',
      title: 'Reassigned report',
      assignments: [{ id: 'a2', status: 'assigned', assigned_at: '2026-02-01T00:00:00Z' }],
      report_status_history: [{ id: 'h2', new_status: 'assigned' }],
      verifications: [],
      report_attachments: [],
    },
  ];

  const merged = mergeReportRows(rows);

  assert.equal(merged.length, 1, 'The report must be merged into a single row');
  assert.equal(merged[0].assignments.length, 2, 'Both assignment rows must be preserved');
  assert.equal(merged[0].report_status_history.length, 2, 'Both history rows must be preserved');
});

test('Phase 4G: the merge keeps distinct reports apart and de-duplicates repeated children', () => {
  const merged = mergeReportRows([
    { id: 'report-1', assignments: [{ id: 'a1' }] },
    { id: 'report-2', assignments: [{ id: 'a2' }] },
    { id: 'report-1', assignments: [{ id: 'a1' }] },
  ]);

  assert.equal(merged.length, 2, 'Two distinct reports must stay two rows');
  const first = merged.find((row) => row.id === 'report-1');
  assert.equal(first.assignments.length, 1, 'The same child must not be added twice');
});

test('Phase 4G: the merge preserves the nested work logs of an assignment', () => {
  const merged = mergeReportRows([
    {
      id: 'report-1',
      assignments: [{ id: 'a1', status: 'assigned', work_logs: [{ id: 'w1', description: 'first' }] }],
    },
    {
      id: 'report-1',
      assignments: [{ id: 'a1', status: 'assigned', work_logs: [{ id: 'w2', description: 'second' }] }],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].assignments.length, 1);
  assert.equal(merged[0].assignments[0].work_logs.length, 2, 'Both work logs must be preserved');
});

test('Phase 4G: the report queue and the report detail both merge their rows', () => {
  const dalSource = readFileSync(path.join(appRoot, 'utils', 'reports', 'dal.ts'), 'utf8');

  assert.ok(
    /mergeReportRows\(\(data \|\| \[\]\) as unknown as RawDbReportRow\[\]\)/.test(dalSource),
    'The report queue must merge the rows PostgREST returns'
  );
  assert.ok(
    /mergeReportRows\(\(data \|\| \[\]\) as unknown as RawDbReportDetailRow\[\]\)/.test(dalSource),
    'The report detail must merge the rows PostgREST returns'
  );
  assert.ok(
    !/query\.maybeSingle\(\)/.test(dalSource),
    'The report detail must not use maybeSingle(), which fails when a report has several child rows'
  );
});
