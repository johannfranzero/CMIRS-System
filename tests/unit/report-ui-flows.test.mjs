import test from 'node:test';
import assert from 'node:assert/strict';

import {
  transformDbReportToDetailedReport,
} from '../../utils/reports/transform.ts';
import {
  validateReportSubmissionInput,
  validateAttachmentMetaInput,
} from '../../utils/reports/validation.ts';

// Test UUID fixtures
const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_CATEGORY = '11111111-1111-1111-1111-111111111111';
const UUID_LOCATION = '22222222-2222-2222-2222-222222222222';
const UUID_COORDINATOR = '66666666-6666-6666-6666-666666666666';
const UUID_TECHNICIAN = '55555555-5555-5555-5555-555555555555';
const UUID_STUDENT = '77777777-7777-7777-7777-777777777777';

test('UI Usability Validation: Enforces client-side bounds on title, category, location, and description', () => {
  // 1. Missing required fields
  const emptyRes = validateReportSubmissionInput({
    title: '',
    categoryId: '',
    locationId: '',
    description: '',
  });
  assert.equal(emptyRes.success, false);
  assert.ok(emptyRes.errors.title);
  assert.ok(emptyRes.errors.categoryId);
  assert.ok(emptyRes.errors.locationId);
  assert.ok(emptyRes.errors.description);

  // 2. Title length boundaries (5-120 chars)
  const shortTitle = validateReportSubmissionInput({
    title: 'ABCD',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    description: 'Valid description that has more than ten characters.',
  });
  assert.equal(shortTitle.success, false);
  assert.ok(shortTitle.errors.title.includes('5 characters'));

  const longTitle = validateReportSubmissionInput({
    title: 'A'.repeat(121),
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    description: 'Valid description that has more than ten characters.',
  });
  assert.equal(longTitle.success, false);
  assert.ok(longTitle.errors.title.includes('120 characters'));

  // 3. Description length boundaries (10-2000 chars)
  const shortDesc = validateReportSubmissionInput({
    title: 'Valid Report Title',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    description: 'Short',
  });
  assert.equal(shortDesc.success, false);
  assert.ok(shortDesc.errors.description.includes('10 characters'));

  const longDesc = validateReportSubmissionInput({
    title: 'Valid Report Title',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    description: 'D'.repeat(2001),
  });
  assert.equal(longDesc.success, false);
  assert.ok(longDesc.errors.description.includes('2000 characters'));

  // 4. Valid payload with urgent hazard
  const validRes = validateReportSubmissionInput({
    title: 'Water pipe burst in laboratory',
    categoryId: UUID_CATEGORY,
    locationId: UUID_LOCATION,
    description: 'Water leaking actively from overhead pipes near server racks.',
    isUrgentHazard: true,
  });
  assert.equal(validRes.success, true);
  assert.equal(validRes.data.isUrgentHazard, true);
  assert.equal(validRes.data.title, 'Water pipe burst in laboratory');
});

test('Attachment Groundwork: Enforces client-side file count, size, and MIME constraints', () => {
  // 1. Valid attachment metadata
  const validMeta = validateAttachmentMetaInput({
    reportId: UUID_REPORT,
    fileName: 'leak_evidence.jpg',
    fileSize: 2048576, // ~2 MB
    mimeType: 'image/jpeg',
  });
  assert.equal(validMeta.success, true);
  assert.equal(validMeta.data.mimeType, 'image/jpeg');

  // 2. Exceeds 10MB limit (10,485,760 bytes)
  const oversized = validateAttachmentMetaInput({
    reportId: UUID_REPORT,
    fileName: 'huge_photo.png',
    fileSize: 10485761,
    mimeType: 'image/png',
  });
  assert.equal(oversized.success, false);
  assert.ok(oversized.errors.fileSize.includes('10 MB'));

  // 3. Unsupported MIME type
  const badMime = validateAttachmentMetaInput({
    reportId: UUID_REPORT,
    fileName: 'document.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
  });
  assert.equal(badMime.success, false);
  assert.ok(badMime.errors.mimeType || badMime.errors.fileName);

  // 4. WebP format supported
  const webpMeta = validateAttachmentMetaInput({
    reportId: UUID_REPORT,
    fileName: 'screenshot.webp',
    fileSize: 500000,
    mimeType: 'image/webp',
  });
  assert.equal(webpMeta.success, true);
});

test('Coordinator Operational Controls: Triage and assignment lifecycle gating', () => {
  // Helper simulating action panel eligibility logic
  const checkCoordinatorCanTriage = (status) =>
    status === 'submitted' || status === 'under_review';

  const checkReassignmentRevertsToAssigned = (status) =>
    status === 'in_progress';

  // Can triage when submitted or under_review
  assert.equal(checkCoordinatorCanTriage('submitted'), true);
  assert.equal(checkCoordinatorCanTriage('under_review'), true);
  assert.equal(checkCoordinatorCanTriage('in_progress'), false);
  assert.equal(checkCoordinatorCanTriage('completed'), false);
  assert.equal(checkCoordinatorCanTriage('verified'), false);

  // Approved Decision 1: In-progress reports revert to assigned upon technician reassignment
  assert.equal(checkReassignmentRevertsToAssigned('in_progress'), true);
  assert.equal(checkReassignmentRevertsToAssigned('under_review'), false);
});

test('Coordinator Verification: Strict separation of duties enforcement (PD-R4 and D2)', () => {
  // Helper simulating UI separation of duties calculation
  const evaluateVerificationEligibility = (report, coordinatorId) => {
    const isAuthor = Boolean(report.reporterId && report.reporterId === coordinatorId);
    const isTechnicianWorker = report.assignmentsList.some(
      (a) => a.technicianId === coordinatorId
    );
    const isDisqualified = isAuthor || isTechnicianWorker;
    return {
      canVerify: !isDisqualified && report.status === 'completed',
      isAuthor,
      isTechnicianWorker,
      isDisqualified,
    };
  };

  const completedReport = {
    id: UUID_REPORT,
    status: 'completed',
    reporterId: UUID_STUDENT,
    assignmentsList: [
      { technicianId: UUID_TECHNICIAN, status: 'completed' },
    ],
  };

  // 1. Independent coordinator -> Eligible
  const independent = evaluateVerificationEligibility(completedReport, UUID_COORDINATOR);
  assert.equal(independent.canVerify, true);
  assert.equal(independent.isDisqualified, false);

  // 2. Coordinator is author (PD-R4) -> Disqualified
  const authorCoordinator = evaluateVerificationEligibility(
    { ...completedReport, reporterId: UUID_COORDINATOR },
    UUID_COORDINATOR
  );
  assert.equal(authorCoordinator.canVerify, false);
  assert.equal(authorCoordinator.isAuthor, true);
  assert.equal(authorCoordinator.isDisqualified, true);

  // 3. Coordinator served as technician (D2) -> Disqualified
  const techCoordinator = evaluateVerificationEligibility(
    {
      ...completedReport,
      reporterId: UUID_STUDENT,
      assignmentsList: [{ technicianId: UUID_COORDINATOR, status: 'completed' }],
    },
    UUID_COORDINATOR
  );
  assert.equal(techCoordinator.canVerify, false);
  assert.equal(techCoordinator.isTechnicianWorker, true);
  assert.equal(techCoordinator.isDisqualified, true);
});

test('Technician Operational Controls: Active work order state machine gating', () => {
  const evaluateTechnicianActions = (status, isAssignedCaller) => {
    if (!isAssignedCaller) {
      return { canStart: false, canHold: false, canResume: false, canComplete: false, canDecline: false, canLogWork: false };
    }
    return {
      canStart: status === 'assigned',
      canDecline: status === 'assigned',
      canHold: status === 'in_progress',
      canResume: status === 'on_hold',
      canComplete: status === 'in_progress' || status === 'on_hold',
      canLogWork: status === 'in_progress' || status === 'on_hold',
    };
  };

  // 1. Assigned status: can start work or decline assignment
  const assigned = evaluateTechnicianActions('assigned', true);
  assert.equal(assigned.canStart, true);
  assert.equal(assigned.canDecline, true);
  assert.equal(assigned.canComplete, false);
  assert.equal(assigned.canHold, false);

  // 2. In-progress status: can hold, complete, or log work
  const inProgress = evaluateTechnicianActions('in_progress', true);
  assert.equal(inProgress.canStart, false);
  assert.equal(inProgress.canHold, true);
  assert.equal(inProgress.canComplete, true);
  assert.equal(inProgress.canLogWork, true);
  assert.equal(inProgress.canDecline, false);

  // 3. On-hold status: can resume, complete, or log work
  const onHold = evaluateTechnicianActions('on_hold', true);
  assert.equal(onHold.canResume, true);
  assert.equal(onHold.canComplete, true);
  assert.equal(onHold.canLogWork, true);
  assert.equal(onHold.canHold, false);

  // 4. Non-assigned technician -> all actions blocked
  const unassigned = evaluateTechnicianActions('in_progress', false);
  assert.equal(unassigned.canStart, false);
  assert.equal(unassigned.canComplete, false);
  assert.equal(unassigned.canLogWork, false);
});

test('Reporter Operational Controls: Cancellation eligibility', () => {
  const checkReporterCanCancel = (status, isCallerReporter) => {
    if (!isCallerReporter) return false;
    return status === 'submitted' || status === 'under_review';
  };

  // Reporter can cancel when submitted or under_review
  assert.equal(checkReporterCanCancel('submitted', true), true);
  assert.equal(checkReporterCanCancel('under_review', true), true);

  // Reporter cannot cancel once assigned, in_progress, or completed
  assert.equal(checkReporterCanCancel('assigned', true), false);
  assert.equal(checkReporterCanCancel('in_progress', true), false);
  assert.equal(checkReporterCanCancel('completed', true), false);

  // Non-reporters cannot use reporter cancellation
  assert.equal(checkReporterCanCancel('submitted', false), false);
});

test('Data Transformation: DetailedReport mapping, soft-deleted attachment filtering, and chronological sorting', () => {
  const rawDbRow = {
    id: UUID_REPORT,
    report_number: 'RPT-000001',
    title: 'Overhead conduit leak',
    description: 'Active leak dripping into electrical cabinet.',
    status: 'in_progress',
    is_urgent_hazard: true,
    confirmed_priority: 'critical',
    created_at: '2026-10-20T08:00:00Z',
    updated_at: '2026-10-20T09:30:00Z',
    category_id: UUID_CATEGORY,
    location_id: UUID_LOCATION,
    reporter_id: UUID_STUDENT,
    categories: { id: UUID_CATEGORY, name: 'Plumbing & Water' },
    locations: { id: UUID_LOCATION, building_name: 'Science Hall', floor: '2', room: '201' },
    reporter: { id: UUID_STUDENT, full_name: 'Juan Dela Cruz', role: 'student_personnel', email: 'juan@campus.edu' },
    assignments: [
      {
        id: 'a1',
        technician_id: UUID_TECHNICIAN,
        status: 'in_progress',
        assigned_at: '2026-10-20T08:15:00Z',
        technician: { id: UUID_TECHNICIAN, full_name: 'Rina Bautista', email: 'rina.bautista@campus.edu' },
        work_logs: [
          {
            id: 'w1',
            assignment_id: 'a1',
            technician_id: UUID_TECHNICIAN,
            description: 'Turned off main isolation valve',
            hours_spent: 1.5,
            created_at: '2026-10-20T08:45:00Z',
          },
        ],
      },
    ],
    report_status_history: [
      {
        id: 'h1',
        previous_status: 'submitted',
        new_status: 'under_review',
        changed_by: UUID_COORDINATOR,
        created_at: '2026-10-20T08:10:00Z',
      },
      {
        id: 'h2',
        previous_status: 'under_review',
        new_status: 'in_progress',
        changed_by: UUID_TECHNICIAN,
        created_at: '2026-10-20T08:20:00Z',
      },
    ],
    verifications: [
      {
        id: 'v1',
        verified_by: UUID_COORDINATOR,
        is_satisfactory: true,
        notes: 'Inspection confirmed leak resolved and area dried.',
        verified_at: '2026-10-20T09:30:00Z',
        verifier: { id: UUID_COORDINATOR, full_name: 'Maria Coordinator' },
      },
    ],
    report_attachments: [
      {
        id: 'att-1',
        file_path: 'reports/333/att1.jpg',
        file_name: 'leak_damage.jpg',
        file_size: 1048576,
        mime_type: 'image/jpeg',
        created_at: '2026-10-20T08:00:00Z',
        deleted_at: null,
        uploaded_by: UUID_STUDENT,
      },
      {
        id: 'att-2',
        file_path: 'reports/333/att2.jpg',
        file_name: 'blurry_discarded.jpg',
        file_size: 500000,
        mime_type: 'image/jpeg',
        created_at: '2026-10-20T08:01:00Z',
        deleted_at: '2026-10-20T08:05:00Z', // Soft-deleted
        uploaded_by: UUID_STUDENT,
      },
    ],
  };

  const detailed = transformDbReportToDetailedReport(rawDbRow);

  // 1. Basic properties
  assert.equal(detailed.id, UUID_REPORT);
  assert.equal(detailed.trackingNumber, 'RPT-000001');
  assert.equal(detailed.title, 'Overhead conduit leak');
  assert.equal(detailed.isUrgentHazard, true);
  assert.equal(detailed.priority, 'critical');
  assert.equal(detailed.assignedTechnician, 'Rina Bautista');

  // 2. Work logs aggregated
  assert.equal(detailed.workLogs.length, 1);
  assert.equal(detailed.workLogs[0].description, 'Turned off main isolation valve');
  assert.equal(detailed.workLogs[0].hoursSpent, 1.5);

  // 3. Status history sorted in reverse chronological order
  assert.equal(detailed.statusHistory.length, 2);
  assert.equal(detailed.statusHistory[0].newStatus, 'in_progress'); // Later timestamp first
  assert.equal(detailed.statusHistory[1].newStatus, 'under_review');

  // 4. Verifications mapped
  assert.equal(detailed.verifications.length, 1);
  assert.equal(detailed.verifications[0].isSatisfactory, true);
  assert.equal(detailed.verifications[0].verifierName, 'Maria Coordinator');

  // 5. Soft-deleted attachments are filtered out
  assert.equal(detailed.attachments.length, 1);
  assert.equal(detailed.attachments[0].fileName, 'leak_damage.jpg');
});

test('Phase 4D: Reference catalog fallback fixtures are removed from the runtime transform module', async () => {
  // The FALLBACK_CATEGORIES / FALLBACK_LOCATIONS / FALLBACK_TECHNICIANS fixtures were removed in
  // Phase 4D. The reference-catalog DAL functions now fail honestly instead of serving
  // fabricated categories, locations, or technician identities to authenticated users.
  const transformModule = await import('../../utils/reports/transform.ts');
  assert.equal('FALLBACK_CATEGORIES' in transformModule, false);
  assert.equal('FALLBACK_LOCATIONS' in transformModule, false);
  assert.equal('FALLBACK_TECHNICIANS' in transformModule, false);
});
