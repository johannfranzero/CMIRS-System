import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createReportRecord,
  triageReportRecord,
  assignTechnicianToReport,
  declineAssignmentViaRpc,
  transitionReportStatusRecord,
  createWorkLogRecord,
  verifyReportRecord,
} from '../../utils/reports/mutations.ts';

// Valid UUID fixtures
const UUID_CATEGORY = '11111111-1111-1111-1111-111111111111';
const UUID_LOCATION = '22222222-2222-2222-2222-222222222222';
const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_ASSIGNMENT = '44444444-4444-4444-4444-444444444444';
const UUID_TECHNICIAN = '55555555-5555-5555-5555-555555555555';
const UUID_COORDINATOR = '66666666-6666-6666-6666-666666666666';
const UUID_STUDENT = '77777777-7777-7777-7777-777777777777';

// Test User Fixtures
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

const inactiveUser = {
  id: 'inactive-user-id',
  email: 'inactive@example.edu',
  profile: {
    id: 'inactive-user-id',
    email: 'inactive@example.edu',
    full_name: 'Inactive User',
    role: 'student_personnel',
    is_active: false,
  },
};

const coordinatorUser = {
  id: UUID_COORDINATOR,
  email: 'coordinator@example.edu',
  profile: {
    id: UUID_COORDINATOR,
    email: 'coordinator@example.edu',
    full_name: 'Coordinator User',
    role: 'coordinator',
    is_active: true,
  },
};

const technicianUser = {
  id: UUID_TECHNICIAN,
  email: 'technician@example.edu',
  profile: {
    id: UUID_TECHNICIAN,
    email: 'technician@example.edu',
    full_name: 'Technician User',
    role: 'technician',
    is_active: true,
  },
};

/**
 * Creates a controllable, in-memory mock Supabase client for unit testing DAL mutations.
 */
function createMockSupabase(handlers = {}) {
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
        update(payload) {
          op.type = 'update';
          op.payload = payload;
          return queryBuilder;
        },
        select(fields) {
          op.fields = fields;
          return queryBuilder;
        },
        eq(col, val) {
          op.filters[col] = val;
          return queryBuilder;
        },
        in(col, vals) {
          op.filters[`${col}_in`] = vals;
          return queryBuilder;
        },
        single() {
          if (handlers[table]?.single) {
            return Promise.resolve(handlers[table].single(op));
          }
          return Promise.resolve({ data: { id: 'mock-id', ...op.payload }, error: null });
        },
        maybeSingle() {
          if (handlers[table]?.maybeSingle) {
            return Promise.resolve(handlers[table].maybeSingle(op));
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve) {
          if (handlers[table]?.exec) {
            return Promise.resolve(handlers[table].exec(op)).then(resolve);
          }
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

// =============================================================================
// TEST SUITE: Mutation Data Access Layer (Milestone 2)
// =============================================================================

test('Auth Guard: Rejects unauthenticated callers and inactive profiles', async () => {
  const payload = {
    title: 'Water Leak in Science Hall',
    description: 'Pipe leaking under the sink in chemistry lab 204.',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    isUrgentHazard: false,
  };

  const mockSupabase = createMockSupabase();

  // 1. Unauthenticated (null user)
  const unauthRes = await createReportRecord(payload, { user: null, supabase: mockSupabase });
  assert.equal(unauthRes.success, false);
  assert.match(unauthRes.error, /Authentication required/);

  // 2. Inactive account
  const inactiveRes = await createReportRecord(payload, { user: inactiveUser, supabase: mockSupabase });
  assert.equal(inactiveRes.success, false);
  assert.match(inactiveRes.error, /active account/);
});

test('Validation & Spoofing Guard: Rejects invalid payloads and client-supplied identity claims', async () => {
  const mockSupabase = createMockSupabase();

  // 1. Invalid payload (missing required title)
  const badRes = await createReportRecord(
    { description: 'Valid description with sufficient length', categoryId: UUID_CATEGORY, locationId: UUID_LOCATION },
    { user: studentUser, supabase: mockSupabase }
  );
  assert.equal(badRes.success, false);
  assert.ok(badRes.fieldErrors?.title);

  // 2. Malicious payload attempting to spoof reporter_id and initial status
  const spoofedRes = await createReportRecord(
    {
      title: 'Valid Report Title',
      description: 'Valid description with sufficient length',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
      reporter_id: 'spoofed-id',
      status: 'verified',
    },
    { user: studentUser, supabase: mockSupabase }
  );
  assert.equal(spoofedRes.success, false);
  assert.ok(spoofedRes.fieldErrors?.reporter_id);
  assert.equal(mockSupabase.operations.length, 0, 'No database query executed on invalid/spoofed payload');
});

test('Report Creation: Executes the notification-bearing command RPC and returns generated fields', async () => {
  // Phase 4C: the report insert and the coordinator notifications are performed by the
  // `submit_report_with_notifications` command RPC in one database transaction.
  const mockSupabase = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'submit_report_with_notifications') {
        return {
          data: {
            report_id: UUID_REPORT,
            report_number: 'RPT-000042',
            status: 'submitted',
            created_at: '2026-10-20T10:00:00Z',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const payload = {
    title: 'Broken Classroom Projector',
    description: 'The projector bulb in Room 302 flickers and turns off repeatedly.',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    isUrgentHazard: true,
  };

  const res = await createReportRecord(payload, { user: studentUser, supabase: mockSupabase });
  assert.equal(res.success, true);
  assert.equal(res.data.id, UUID_REPORT);
  assert.equal(res.data.reportNumber, 'RPT-000042');
  assert.equal(res.data.status, 'submitted');

  // Verify the command invocation
  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp, 'The command RPC must be invoked');
  assert.equal(rpcOp.fnName, 'submit_report_with_notifications');
  assert.equal(rpcOp.args.p_title, payload.title);
  assert.equal(rpcOp.args.p_category_id, UUID_CATEGORY);
  assert.equal(rpcOp.args.p_location_id, UUID_LOCATION);
  assert.equal(rpcOp.args.p_is_urgent_hazard, true);
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');

  // The client must never be able to supply the reporter identity.
  assert.equal(rpcOp.args.p_reporter_id, undefined);
  assert.equal(rpcOp.args.reporter_id, undefined);
});

test('Report Creation: Sanitizes database errors and does not leak internal SQL', async () => {
  const mockSupabase = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint "reports_category_id_fkey" on "reports"' },
    }),
  });

  const payload = {
    title: 'Broken Light Switch',
    description: 'Light switch sparks when flipped in hallway.',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    isUrgentHazard: false,
  };

  const res = await createReportRecord(payload, { user: studentUser, supabase: mockSupabase });
  assert.equal(res.success, false);
  assert.ok(res.error);
  assert.equal(res.error.includes('foreign key constraint'), false, 'Must not leak foreign key internals');
});

test('Report Triage: Restricts triage to coordinator role and updates confirmed priority', async () => {
  const triagePayload = {
    reportId: UUID_REPORT,
    confirmedPriority: 'high',
    // Phase 4D: triage advances the report to 'under_review' only. Technician assignment is a
    // separate dedicated command.
    status: 'under_review',
  };

  // 1. Student attempted triage -> rejected
  const studentRes = await triageReportRecord(triagePayload, { user: studentUser, supabase: createMockSupabase() });
  assert.equal(studentRes.success, false);
  assert.match(studentRes.error, /Only Maintenance Coordinators/);

  // 2. Triage rejects any status other than 'under_review'
  const invalidStatusRes = await triageReportRecord(
    { ...triagePayload, status: 'assigned' },
    { user: coordinatorUser, supabase: createMockSupabase() }
  );
  assert.equal(invalidStatusRes.success, false);
  assert.match(invalidStatusRes.error, /Invalid triage payload/);
  assert.ok(invalidStatusRes.fieldErrors.status);

  // 3. Coordinator triage -> success
  const mockSupabase = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'triage_report_with_notifications') {
        return {
          data: { report_id: UUID_REPORT, status: 'under_review', confirmed_priority: 'high' },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const coordRes = await triageReportRecord(triagePayload, { user: coordinatorUser, supabase: mockSupabase });
  assert.equal(coordRes.success, true);
  assert.equal(coordRes.data.status, 'under_review');
  assert.equal(coordRes.data.confirmedPriority, 'high');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'triage_report_with_notifications');
  assert.equal(rpcOp.args.p_report_id, UUID_REPORT);
  assert.equal(rpcOp.args.p_confirmed_priority, 'high');
  assert.equal(rpcOp.args.p_target_status, 'under_review');
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
});

test('Technician Assignment: Enforces active technician role and non-terminal report state', async () => {
  const assignPayload = {
    reportId: UUID_REPORT,
    technicianId: UUID_TECHNICIAN,
    notes: 'Please bring ladder',
  };

  // 1. Target user is not a technician (e.g. is student) — enforced by the command RPC
  const nonTechMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_INVALID_INPUT: technician must be an active technician account' },
    }),
  });
  const badTargetRes = await assignTechnicianToReport(assignPayload, { user: coordinatorUser, supabase: nonTechMock });
  assert.equal(badTargetRes.success, false);
  assert.match(badTargetRes.error, /rejected/i);

  // 2. Target report is closed / verified
  const closedReportMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_INVALID_STATE: report is already in a terminal state' },
    }),
  });
  const closedRes = await assignTechnicianToReport(assignPayload, { user: coordinatorUser, supabase: closedReportMock });
  assert.equal(closedRes.success, false);
  assert.match(closedRes.error, /not valid for the current state/i);
});

test('Technician Assignment: Reassignment reverts in_progress report to assigned (Approved Decision 1)', async () => {
  const mockSupabase = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'assign_or_reassign_report_with_notifications') {
        return {
          data: {
            assignment_id: UUID_ASSIGNMENT,
            report_id: UUID_REPORT,
            technician_id: UUID_TECHNICIAN,
            status: 'assigned',
            was_reassignment: true,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const res = await assignTechnicianToReport(
    { reportId: UUID_REPORT, technicianId: UUID_TECHNICIAN, notes: 'Reassigned to specialist' },
    { user: coordinatorUser, supabase: mockSupabase }
  );

  assert.equal(res.success, true);
  assert.equal(res.data.status, 'assigned');
  assert.equal(res.data.assignmentId, UUID_ASSIGNMENT);

  // The command reports the reassignment and the assignment notes are forwarded.
  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'assign_or_reassign_report_with_notifications');
  assert.equal(rpcOp.args.p_report_id, UUID_REPORT);
  assert.equal(rpcOp.args.p_technician_id, UUID_TECHNICIAN);
  assert.equal(rpcOp.args.p_notes, 'Reassigned to specialist');
});

test('Technician Assignment: Surfaces a command failure instead of a partial success', async () => {
  const mockSupabase = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_INVALID_STATE: the technician is already assigned to this report' },
    }),
  });

  const res = await assignTechnicianToReport(
    { reportId: UUID_REPORT, technicianId: UUID_TECHNICIAN },
    { user: coordinatorUser, supabase: mockSupabase }
  );

  // A command failure must never be reported as success.
  assert.equal(res.success, false);
  assert.match(res.error, /not valid for the current state/i);
});

test('Decline Assignment RPC: Enforces technician role and invokes decline_assignment RPC', async () => {
  const declinePayload = {
    assignmentId: UUID_ASSIGNMENT,
    reason: 'Conflict with emergency hospital generator service',
  };

  // 1. Non-technician cannot decline
  const coordRes = await declineAssignmentViaRpc(declinePayload, { user: coordinatorUser, supabase: createMockSupabase() });
  assert.equal(coordRes.success, false);
  assert.match(coordRes.error, /Only Maintenance Technicians/);

  // 2. Successful RPC call by assigned technician
  const mockSupabase = createMockSupabase();
  const res = await declineAssignmentViaRpc(declinePayload, { user: technicianUser, supabase: mockSupabase });
  assert.equal(res.success, true);
  assert.equal(res.data.status, 'declined');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp, 'Must invoke RPC');
  assert.equal(rpcOp.fnName, 'decline_assignment');
  assert.equal(rpcOp.args.target_assignment_id, UUID_ASSIGNMENT);
  assert.equal(rpcOp.args.reason, declinePayload.reason);
});

test('Status Transitions: Enforces reporter cancellation eligibility and active work state machine', async () => {
  // 1. Reporter cannot cancel a report once work is in_progress (enforced by the command RPC)
  const inProgressReportMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_FORBIDDEN: reporters may only change their own reports' },
    }),
  });

  const reporterCancelBad = await transitionReportStatusRecord(
    { reportId: UUID_REPORT, targetStatus: 'cancelled', reason: 'No longer needed' },
    { user: studentUser, supabase: inProgressReportMock }
  );
  assert.equal(reporterCancelBad.success, false);
  assert.match(reporterCancelBad.error, /do not have permission/i);

  // 2. Reporter can cancel own submitted report
  const submittedReportMock = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'transition_report_status_with_notifications') {
        return {
          data: { report_id: UUID_REPORT, previous_status: 'submitted', new_status: 'cancelled' },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const reporterCancelGood = await transitionReportStatusRecord(
    { reportId: UUID_REPORT, targetStatus: 'cancelled', reason: 'Issue resolved itself' },
    { user: studentUser, supabase: submittedReportMock }
  );
  assert.equal(reporterCancelGood.success, true);
  assert.equal(reporterCancelGood.data.newStatus, 'cancelled');

  // 3. Coordinator cancellation is performed atomically by the command RPC
  const coordCancelMock = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'transition_report_status_with_notifications') {
        return {
          data: { report_id: UUID_REPORT, previous_status: 'in_progress', new_status: 'cancelled' },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const coordCancelRes = await transitionReportStatusRecord(
    { reportId: UUID_REPORT, targetStatus: 'cancelled', reason: 'Duplicate ticket' },
    { user: coordinatorUser, supabase: coordCancelMock }
  );
  assert.equal(coordCancelRes.success, true);

  const rpcOp = coordCancelMock.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'transition_report_status_with_notifications');
  assert.equal(rpcOp.args.p_target_status, 'cancelled');
  assert.equal(rpcOp.args.p_reason, 'Duplicate ticket');
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
});

test('Status Transitions: Rejects a transition that belongs to another command', async () => {
  // 'assigned' is owned by the assignment command and 'verified' by the verification command.
  for (const targetStatus of ['assigned', 'under_review', 'verified', 'reopened']) {
    const res = await transitionReportStatusRecord(
      { reportId: UUID_REPORT, targetStatus, reason: 'Attempted direct transition' },
      { user: coordinatorUser, supabase: createMockSupabase() }
    );
    assert.equal(res.success, false, `Transition to ${targetStatus} must be refused`);
    assert.ok(res.error);
  }
});

test('Work Logs: Records technician work session with valid hours and assignment link', async () => {
  const mockSupabase = createMockSupabase({
    work_logs: {
      single: () => ({
        data: {
          id: 'work-log-uuid-1',
          assignment_id: UUID_ASSIGNMENT,
          hours_spent: 3.5,
          created_at: '2026-10-20T12:00:00Z',
        },
        error: null,
      }),
    },
  });

  const res = await createWorkLogRecord(
    { assignmentId: UUID_ASSIGNMENT, description: 'Replaced broken valve and tested water pressure', hoursSpent: 3.5 },
    { user: technicianUser, supabase: mockSupabase }
  );

  assert.equal(res.success, true);
  assert.equal(res.data.hoursSpent, 3.5);
  assert.equal(res.data.assignmentId, UUID_ASSIGNMENT);

  const insertOp = mockSupabase.operations.find((op) => op.table === 'work_logs');
  assert.ok(insertOp);
  assert.equal(insertOp.payload.technician_id, technicianUser.id);
  assert.equal(insertOp.payload.hours_spent, 3.5);
});

test('Coordinator Verification: Enforces separation of duties (PD-R4 and D2)', async () => {
  // 1. Coordinator cannot verify report they submitted (PD-R4, enforced by the command RPC)
  const selfSubmitMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_FORBIDDEN: a reporter may not verify their own report' },
    }),
  });

  const selfSubmitRes = await verifyReportRecord(
    { reportId: UUID_REPORT, isSatisfactory: true },
    { user: coordinatorUser, supabase: selfSubmitMock }
  );
  assert.equal(selfSubmitRes.success, false);
  assert.match(selfSubmitRes.error, /do not have permission/i);

  // 2. Coordinator cannot verify report where they served as technician (D2)
  const selfTechMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_FORBIDDEN: the assigned technician may not verify their own repair' },
    }),
  });

  const selfTechRes = await verifyReportRecord(
    { reportId: UUID_REPORT, isSatisfactory: true },
    { user: coordinatorUser, supabase: selfTechMock }
  );
  assert.equal(selfTechRes.success, false);
  assert.match(selfTechRes.error, /do not have permission/i);
});

test('Coordinator Verification: Rejection records notes and reopens report (Approved Decision 2)', async () => {
  const mockSupabase = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'verify_report_with_notifications') {
        return {
          data: {
            verification_id: 'verification-uuid-1',
            report_id: UUID_REPORT,
            is_satisfactory: false,
            new_status: 'reopened',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const rejectPayload = {
    reportId: UUID_REPORT,
    isSatisfactory: false,
    notes: 'Door still sticks when closing; requires planing the edge',
  };

  const res = await verifyReportRecord(rejectPayload, { user: coordinatorUser, supabase: mockSupabase });
  assert.equal(res.success, true);
  assert.equal(res.data.isSatisfactory, false);
  assert.equal(res.data.newStatus, 'reopened');

  // The verification record and the status change are performed by one command.
  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'verify_report_with_notifications');
  assert.equal(rpcOp.args.p_is_satisfactory, false);
  assert.equal(rpcOp.args.p_notes, rejectPayload.notes);
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
});
