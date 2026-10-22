import test from 'node:test';
import assert from 'node:assert/strict';

import {
  submitReportAction,
  triageReportAction,
  assignTechnicianAction,
  declineAssignmentAction,
  transitionReportStatusAction,
  createWorkLogAction,
  verifyReportAction,
} from '../../actions/reports.ts';
import { INITIAL_ACTION_STATE } from '../../utils/reports/action-state.ts';

// Valid UUID fixtures
const UUID_CATEGORY = '11111111-1111-1111-1111-111111111111';
const UUID_LOCATION = '22222222-2222-2222-2222-222222222222';
const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_ASSIGNMENT = '44444444-4444-4444-4444-444444444444';
const UUID_TECHNICIAN = '55555555-5555-5555-5555-555555555555';
const UUID_COORDINATOR = '66666666-6666-6666-6666-666666666666';
const UUID_STUDENT = '77777777-7777-7777-7777-777777777777';

// Mock Users
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
 * Creates an in-memory mock Supabase client.
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
// TEST SUITE: Server Actions & Cache Invalidation (Milestone 3)
// =============================================================================

test('submitReportAction: Rejects unauthenticated callers and inactive profiles', async () => {
  const payload = {
    title: 'Broken Radiator',
    description: 'Radiator valve leaking water on 2nd floor.',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    isUrgentHazard: false,
  };

  const mockSupabase = createMockSupabase();

  // 1. Unauthenticated
  const unauthRes = await submitReportAction(INITIAL_ACTION_STATE, payload, { user: null, supabase: mockSupabase });
  assert.equal(unauthRes.status, 'error');
  assert.match(unauthRes.message, /Authentication required/);

  // 2. Inactive account
  const inactiveRes = await submitReportAction(INITIAL_ACTION_STATE, payload, { user: inactiveUser, supabase: mockSupabase });
  assert.equal(inactiveRes.status, 'error');
  assert.match(inactiveRes.message, /active account/);
});

test('submitReportAction: Rejects invalid payloads and client-supplied identity claims', async () => {
  const mockSupabase = createMockSupabase();

  // 1. Missing required fields
  const missingTitle = await submitReportAction(
    INITIAL_ACTION_STATE,
    { description: 'Valid description with length', categoryId: UUID_CATEGORY, locationId: UUID_LOCATION },
    { user: studentUser, supabase: mockSupabase }
  );
  assert.equal(missingTitle.status, 'error');
  assert.ok(missingTitle.fieldErrors?.title);

  // 2. Spoofed reporter_id and initial status
  const spoofed = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Valid Report Title',
      description: 'Valid description with length',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
      reporter_id: 'spoofed-id',
      status: 'verified',
    },
    { user: studentUser, supabase: mockSupabase }
  );
  assert.equal(spoofed.status, 'error');
  assert.ok(spoofed.fieldErrors?.reporter_id);
  assert.equal(mockSupabase.operations.length, 0, 'No query executed on spoofed payload');
});

test('submitReportAction: Successfully processes typed payload and FormData', async () => {
  // Phase 4C: submission now executes through the notification-bearing command RPC
  // `submit_report_with_notifications`, which returns a single jsonb document.
  const mockSupabase = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'submit_report_with_notifications') {
        return {
          data: {
            report_id: UUID_REPORT,
            report_number: 'RPT-000100',
            status: 'submitted',
            created_at: '2026-10-20T10:00:00Z',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  // 1. Typed payload
  const typedRes = await submitReportAction(
    INITIAL_ACTION_STATE,
    {
      title: 'Broken Handrail on Stairs',
      description: 'The metal handrail on the west stairwell has come loose from the wall.',
      categoryId: UUID_CATEGORY,
      locationId: UUID_LOCATION,
      isUrgentHazard: true,
    },
    { user: studentUser, supabase: mockSupabase }
  );

  assert.equal(typedRes.status, 'success');
  assert.equal(typedRes.data?.id, UUID_REPORT);
  assert.equal(typedRes.data?.reportNumber, 'RPT-000100');
  assert.match(typedRes.message, /RPT-000100 submitted successfully/);

  // 2. FormData payload
  const formData = new FormData();
  formData.set('title', 'Water Fountain Leaking');
  formData.set('description', 'Drinking fountain outside room 104 is overflowing onto the floor.');
  formData.set('categoryId', UUID_CATEGORY);
  formData.set('locationId', UUID_LOCATION);
  formData.set('isUrgentHazard', 'true');

  const formRes = await submitReportAction(INITIAL_ACTION_STATE, formData, {
    user: studentUser,
    supabase: mockSupabase,
  });

  assert.equal(formRes.status, 'success');
  assert.equal(formRes.data?.id, UUID_REPORT);
});

test('triageReportAction: Enforces coordinator role and updates confirmed priority', async () => {
  const triagePayload = {
    reportId: UUID_REPORT,
    confirmedPriority: 'critical',
    // Phase 4D: triage advances the report to 'under_review' only. Technician assignment is a
    // separate dedicated command (`assignTechnicianAction`).
    status: 'under_review',
  };

  // 1. Student cannot triage
  const studentRes = await triageReportAction(INITIAL_ACTION_STATE, triagePayload, {
    user: studentUser,
    supabase: createMockSupabase(),
  });
  assert.equal(studentRes.status, 'error');
  assert.match(studentRes.message, /Only Maintenance Coordinators/);

  // 2. Triage rejects a client-supplied status other than 'under_review'
  const invalidStatusRes = await triageReportAction(
    INITIAL_ACTION_STATE,
    { ...triagePayload, status: 'assigned' },
    {
      user: coordinatorUser,
      supabase: createMockSupabase(),
    }
  );
  assert.equal(invalidStatusRes.status, 'error');
  assert.match(invalidStatusRes.message, /Invalid triage parameters/);
  assert.ok(invalidStatusRes.fieldErrors?.status);

  // 3. Coordinator triage succeeds
  const mockSupabase = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'triage_report_with_notifications') {
        return {
          data: { report_id: UUID_REPORT, status: 'under_review', confirmed_priority: 'critical' },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });

  const coordRes = await triageReportAction(INITIAL_ACTION_STATE, triagePayload, {
    user: coordinatorUser,
    supabase: mockSupabase,
  });
  assert.equal(coordRes.status, 'success');
  assert.equal(coordRes.data?.status, 'under_review');
  assert.equal(coordRes.data?.confirmedPriority, 'critical');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'triage_report_with_notifications');
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
});

test('assignTechnicianAction: Enforces coordinator role, active technician target, and handles partial failure', async () => {
  const assignPayload = {
    reportId: UUID_REPORT,
    technicianId: UUID_TECHNICIAN,
    notes: 'Urgent HVAC repair',
  };

  // 1. Technician cannot assign technicians
  const techRes = await assignTechnicianAction(INITIAL_ACTION_STATE, assignPayload, {
    user: technicianUser,
    supabase: createMockSupabase(),
  });
  assert.equal(techRes.status, 'error');
  assert.match(techRes.message, /Only Maintenance Coordinators/);

  // 2. Target user is not an active technician (enforced by the command RPC)
  const nonTechMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_INVALID_INPUT: technician must be an active technician account' },
    }),
  });
  const badTargetRes = await assignTechnicianAction(INITIAL_ACTION_STATE, assignPayload, {
    user: coordinatorUser,
    supabase: nonTechMock,
  });
  assert.equal(badTargetRes.status, 'error');
  assert.match(badTargetRes.message, /rejected/i);

  // 3. Command failure is surfaced as an error, never as a false success
  const partialFailMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_INVALID_STATE: report is already in a terminal state' },
    }),
  });
  const partialRes = await assignTechnicianAction(INITIAL_ACTION_STATE, assignPayload, {
    user: coordinatorUser,
    supabase: partialFailMock,
  });
  assert.equal(partialRes.status, 'error', 'Must report error on command failure, never false success');
  assert.match(partialRes.message, /not valid for the current state/i);

  // 4. Successful assignment
  const successMock = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'assign_or_reassign_report_with_notifications') {
        return {
          data: {
            assignment_id: UUID_ASSIGNMENT,
            report_id: UUID_REPORT,
            technician_id: UUID_TECHNICIAN,
            status: 'assigned',
            was_reassignment: false,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });
  const successRes = await assignTechnicianAction(INITIAL_ACTION_STATE, assignPayload, {
    user: coordinatorUser,
    supabase: successMock,
  });
  assert.equal(successRes.status, 'success');
  assert.equal(successRes.data?.technicianId, UUID_TECHNICIAN);

  const rpcOp = successMock.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'assign_or_reassign_report_with_notifications');
  assert.equal(rpcOp.args.p_technician_id, UUID_TECHNICIAN);
  assert.ok(rpcOp.args.p_request_id, 'The command must carry an idempotency token');
});

test('declineAssignmentAction: Restricts decline to assigned technician and executes decline RPC', async () => {
  const declinePayload = {
    assignmentId: UUID_ASSIGNMENT,
    reason: 'Technician on leave for medical appointment',
  };

  // 1. Coordinator cannot decline technician assignments
  const coordRes = await declineAssignmentAction(INITIAL_ACTION_STATE, declinePayload, {
    user: coordinatorUser,
    supabase: createMockSupabase(),
  });
  assert.equal(coordRes.status, 'error');
  assert.match(coordRes.message, /Only Maintenance Technicians/);

  // 2. Reason too short (< 5 chars) rejected before database call
  const shortReasonRes = await declineAssignmentAction(
    INITIAL_ACTION_STATE,
    { assignmentId: UUID_ASSIGNMENT, reason: 'sick' },
    { user: technicianUser, supabase: createMockSupabase() }
  );
  assert.equal(shortReasonRes.status, 'error');
  assert.ok(shortReasonRes.fieldErrors?.reason);

  // 3. Technician decline succeeds
  const mockSupabase = createMockSupabase();
  const successRes = await declineAssignmentAction(INITIAL_ACTION_STATE, declinePayload, {
    user: technicianUser,
    supabase: mockSupabase,
  });
  assert.equal(successRes.status, 'success');
  assert.equal(successRes.data?.status, 'declined');

  const rpcOp = mockSupabase.operations.find((op) => op.type === 'rpc');
  assert.ok(rpcOp);
  assert.equal(rpcOp.fnName, 'decline_assignment');
});

test('transitionReportStatusAction: Validates state transitions across reporter, tech, and coordinator roles', async () => {
  // 1. Reporter cannot cancel an in_progress report (enforced by the command RPC)
  const inProgMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_FORBIDDEN: reporters may only change their own reports' },
    }),
  });
  const badCancel = await transitionReportStatusAction(
    INITIAL_ACTION_STATE,
    { reportId: UUID_REPORT, targetStatus: 'cancelled', reason: 'Change of mind' },
    { user: studentUser, supabase: inProgMock }
  );
  assert.equal(badCancel.status, 'error');
  assert.match(badCancel.message, /do not have permission/i);

  // 2. Reporter cancels submitted report -> succeeds
  const submittedMock = createMockSupabase({
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
  const goodCancel = await transitionReportStatusAction(
    INITIAL_ACTION_STATE,
    { reportId: UUID_REPORT, targetStatus: 'cancelled', reason: 'Fixed by room occupant' },
    { user: studentUser, supabase: submittedMock }
  );
  assert.equal(goodCancel.status, 'success');
  assert.equal(goodCancel.data?.newStatus, 'cancelled');

  // 3. Technician starting work updates assignment and report status
  const startWorkMock = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'transition_report_status_with_notifications') {
        return {
          data: { report_id: UUID_REPORT, previous_status: 'assigned', new_status: 'in_progress' },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });
  const startRes = await transitionReportStatusAction(
    INITIAL_ACTION_STATE,
    { reportId: UUID_REPORT, targetStatus: 'in_progress' },
    { user: technicianUser, supabase: startWorkMock }
  );
  assert.equal(startRes.status, 'success');
  assert.equal(startRes.data?.newStatus, 'in_progress');
});

test('createWorkLogAction: Enforces technician role, hour boundaries, and decimal precision', async () => {
  // 1. Coordinator cannot log technician work
  const coordRes = await createWorkLogAction(
    INITIAL_ACTION_STATE,
    { assignmentId: UUID_ASSIGNMENT, description: 'Inspection notes', hoursSpent: 2.0 },
    { user: coordinatorUser, supabase: createMockSupabase() }
  );
  assert.equal(coordRes.status, 'error');
  assert.match(coordRes.message, /Only Maintenance Technicians/);

  // 2. Invalid hours (> 24) rejected before database call
  const badHoursRes = await createWorkLogAction(
    INITIAL_ACTION_STATE,
    { assignmentId: UUID_ASSIGNMENT, description: 'Long shift repair', hoursSpent: 25.0 },
    { user: technicianUser, supabase: createMockSupabase() }
  );
  assert.equal(badHoursRes.status, 'error');
  assert.ok(badHoursRes.fieldErrors?.hoursSpent);

  // 3. Technician logs valid work session
  const mockSupabase = createMockSupabase({
    work_logs: {
      single: () => ({
        data: {
          id: 'work-log-1',
          assignment_id: UUID_ASSIGNMENT,
          hours_spent: 4.25,
          created_at: '2026-10-20T14:00:00Z',
        },
        error: null,
      }),
    },
  });
  const goodRes = await createWorkLogAction(
    INITIAL_ACTION_STATE,
    { assignmentId: UUID_ASSIGNMENT, description: 'Rewired lighting fixture and replaced ballast', hoursSpent: 4.25 },
    { user: technicianUser, supabase: mockSupabase }
  );
  assert.equal(goodRes.status, 'success');
  assert.equal(goodRes.data?.hoursSpent, 4.25);
});

test('verifyReportAction: Enforces coordinator role, separation of duties, and rejection rework', async () => {
  // 1. Technician cannot verify repairs
  const techRes = await verifyReportAction(
    INITIAL_ACTION_STATE,
    { reportId: UUID_REPORT, isSatisfactory: true },
    { user: technicianUser, supabase: createMockSupabase() }
  );
  assert.equal(techRes.status, 'error');
  assert.match(techRes.message, /Only Maintenance Coordinators/);

  // 2. Separation of duties: Coordinator cannot verify own report (PD-R4, enforced by the RPC)
  const selfSubmitMock = createMockSupabase({
    rpc: () => ({
      data: null,
      error: { message: 'CMIRS_FORBIDDEN: a reporter may not verify their own report' },
    }),
  });
  const selfSubmitRes = await verifyReportAction(
    INITIAL_ACTION_STATE,
    { reportId: UUID_REPORT, isSatisfactory: true },
    { user: coordinatorUser, supabase: selfSubmitMock }
  );
  assert.equal(selfSubmitRes.status, 'error');
  assert.match(selfSubmitRes.message, /do not have permission/i);

  // 3. Verification rejection reopens report with mandatory notes (Approved Decision 2)
  const rejectMock = createMockSupabase({
    rpc: (fnName) => {
      if (fnName === 'verify_report_with_notifications') {
        return {
          data: {
            verification_id: 'verif-uuid-1',
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
  const rejectRes = await verifyReportAction(
    INITIAL_ACTION_STATE,
    { reportId: UUID_REPORT, isSatisfactory: false, notes: 'Sink drain still leaking underneath P-trap' },
    { user: coordinatorUser, supabase: rejectMock }
  );
  assert.equal(rejectRes.status, 'success');
  assert.equal(rejectRes.data?.isSatisfactory, false);
  assert.equal(rejectRes.data?.newStatus, 'reopened');
  assert.match(rejectRes.message, /verification rejected; ticket reopened/);
});
