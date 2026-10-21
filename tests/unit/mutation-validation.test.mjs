import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidUuid,
  isReportStatus,
  isPriorityLevel,
  isAssignmentStatus,
  validateReportSubmissionInput,
  validateAssignmentDeclineInput,
  validateWorkLogInput,
  validateReportTriageInput,
  validateTechnicianAssignmentInput,
  validateStatusTransitionInput,
  validateVerificationInput,
  validateAttachmentMetaInput,
  VALID_REPORT_STATUSES,
  VALID_PRIORITY_LEVELS,
  VALID_ASSIGNMENT_STATUSES,
} from '../../utils/reports/validation.ts';

// Sample valid UUID fixtures
const VALID_UUID_1 = '11111111-2222-3333-4444-555555555555';
const VALID_UUID_2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// =============================================================================
// TEST SUITE: Mutation Input Validation and Boundary Guards (Milestone 1)
// =============================================================================

test('Enum & Identifier Guards: Accurately validates UUIDs and canonical database enums', () => {
  // UUID validation
  assert.equal(isValidUuid(VALID_UUID_1), true);
  assert.equal(isValidUuid(VALID_UUID_2.toUpperCase()), true);
  assert.equal(isValidUuid('not-a-uuid'), false);
  assert.equal(isValidUuid('------------------------------------'), false);
  assert.equal(isValidUuid(''), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(12345), false);

  // ReportStatus validation (all 9 canonical values)
  for (const status of VALID_REPORT_STATUSES) {
    assert.equal(isReportStatus(status), true, `Status "${status}" must be valid`);
  }
  assert.equal(isReportStatus('deleted'), false);
  assert.equal(isReportStatus('in-progress'), false); // hyphenated is invalid; underscored is valid
  assert.equal(isReportStatus(''), false);

  // PriorityLevel validation (all 4 values)
  for (const priority of VALID_PRIORITY_LEVELS) {
    assert.equal(isPriorityLevel(priority), true, `Priority "${priority}" must be valid`);
  }
  assert.equal(isPriorityLevel('urgent'), false); // urgent is boolean flag, not priority_level
  assert.equal(isPriorityLevel('extreme'), false);

  // AssignmentStatus validation (all 7 values)
  for (const status of VALID_ASSIGNMENT_STATUSES) {
    assert.equal(isAssignmentStatus(status), true, `AssignmentStatus "${status}" must be valid`);
  }
  assert.equal(isAssignmentStatus('rejected'), false); // 'declined' is canonical, not 'rejected'
});

test('Report Submission: Accepts valid submission payload and trims text fields', () => {
  const payload = {
    title: '   Broken Door Lock in 101   ',
    description: '   The classroom door latch is stuck and will not engage when closed.   ',
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
    isUrgentHazard: true,
  };

  const result = validateReportSubmissionInput(payload);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.title, 'Broken Door Lock in 101');
    assert.equal(result.data.description, 'The classroom door latch is stuck and will not engage when closed.');
    assert.equal(result.data.categoryId, VALID_UUID_1);
    assert.equal(result.data.locationId, VALID_UUID_2);
    assert.equal(result.data.isUrgentHazard, true);
  }
});

test('Report Submission: Rejects payloads with spoofed authorization or identity fields', () => {
  const maliciousPayloads = [
    {
      title: 'Water pipe leak in lab',
      description: 'Water leaking under sink',
      categoryId: VALID_UUID_1,
      locationId: VALID_UUID_2,
      reporter_id: 'spoofed-user-uuid', // Attempting to spoof reporter ID
    },
    {
      title: 'Water pipe leak in lab',
      description: 'Water leaking under sink',
      categoryId: VALID_UUID_1,
      locationId: VALID_UUID_2,
      status: 'verified', // Attempting to bypass submitted status
    },
    {
      title: 'Water pipe leak in lab',
      description: 'Water leaking under sink',
      categoryId: VALID_UUID_1,
      locationId: VALID_UUID_2,
      confirmed_priority: 'critical', // Attempting to self-triage
    },
    {
      title: 'Water pipe leak in lab',
      description: 'Water leaking under sink',
      categoryId: VALID_UUID_1,
      locationId: VALID_UUID_2,
      report_number: 'RPT-999999', // Attempting to spoof sequential report number
    },
  ];

  for (const payload of maliciousPayloads) {
    const result = validateReportSubmissionInput(payload);
    assert.equal(result.success, false, 'Must reject payload containing client-supplied authority keys');
    assert.ok(
      Object.keys(result.errors).length > 0,
      'Errors must indicate forbidden client-supplied fields'
    );
  }
});

test('Report Submission: Enforces title and description length boundaries and control characters', () => {
  // Title too short (< 5 chars)
  const shortTitle = validateReportSubmissionInput({
    title: 'Lock',
    description: 'This is a valid description with enough characters.',
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
  });
  assert.equal(shortTitle.success, false);
  assert.ok(shortTitle.errors.title);

  // Title too long (> 120 chars)
  const longTitle = validateReportSubmissionInput({
    title: 'A'.repeat(121),
    description: 'This is a valid description with enough characters.',
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
  });
  assert.equal(longTitle.success, false);
  assert.ok(longTitle.errors.title);

  // Title with newlines or tabs
  const newlineTitle = validateReportSubmissionInput({
    title: 'Broken Door\nIn Science Building',
    description: 'This is a valid description with enough characters.',
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
  });
  assert.equal(newlineTitle.success, false);
  assert.ok(newlineTitle.errors.title);

  // Description too short (< 10 chars)
  const shortDesc = validateReportSubmissionInput({
    title: 'Valid Title Here',
    description: 'Too short',
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
  });
  assert.equal(shortDesc.success, false);
  assert.ok(shortDesc.errors.description);

  // Description too long (> 2000 chars)
  const longDesc = validateReportSubmissionInput({
    title: 'Valid Title Here',
    description: 'D'.repeat(2001),
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
  });
  assert.equal(longDesc.success, false);
  assert.ok(longDesc.errors.description);

  // Exact boundary tests: Title 5 chars, Description 10 chars -> valid!
  const minValid = validateReportSubmissionInput({
    title: '12345',
    description: '1234567890',
    categoryId: VALID_UUID_1,
    locationId: VALID_UUID_2,
  });
  assert.equal(minValid.success, true);
});

test('Report Submission: Rejects malformed categoryId and locationId identifiers', () => {
  const badIds = validateReportSubmissionInput({
    title: 'Valid Title Here',
    description: 'Valid Description with enough length.',
    categoryId: 'invalid-category',
    locationId: VALID_UUID_2,
  });
  assert.equal(badIds.success, false);
  assert.ok(badIds.errors.categoryId);

  const missingLoc = validateReportSubmissionInput({
    title: 'Valid Title Here',
    description: 'Valid Description with enough length.',
    categoryId: VALID_UUID_1,
    locationId: '',
  });
  assert.equal(missingLoc.success, false);
  assert.ok(missingLoc.errors.locationId);
});

test('Assignment Decline: Validates decline reason matching database constraint chk_decline_reason', () => {
  // Valid decline
  const valid = validateAssignmentDeclineInput({
    assignmentId: VALID_UUID_1,
    reason: 'Schedule conflict with emergency HVAC repair',
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.reason, 'Schedule conflict with emergency HVAC repair');
  }

  // Whitespace-only reason -> must fail (matching btrim(decline_reason) != '')
  const whitespace = validateAssignmentDeclineInput({
    assignmentId: VALID_UUID_1,
    reason: '     ',
  });
  assert.equal(whitespace.success, false);
  assert.ok(whitespace.errors.reason);

  // Empty reason -> must fail
  const empty = validateAssignmentDeclineInput({
    assignmentId: VALID_UUID_1,
    reason: '',
  });
  assert.equal(empty.success, false);
  assert.ok(empty.errors.reason);

  // Reason too short (< 5 chars)
  const shortReason = validateAssignmentDeclineInput({
    assignmentId: VALID_UUID_1,
    reason: 'busy',
  });
  assert.equal(shortReason.success, false);
  assert.ok(shortReason.errors.reason);

  // Reason too long (> 500 chars)
  const longReason = validateAssignmentDeclineInput({
    assignmentId: VALID_UUID_1,
    reason: 'R'.repeat(501),
  });
  assert.equal(longReason.success, false);
  assert.ok(longReason.errors.reason);

  // Malformed assignment UUID
  const badUuid = validateAssignmentDeclineInput({
    assignmentId: 'bad-uuid',
    reason: 'Valid reason here',
  });
  assert.equal(badUuid.success, false);
  assert.ok(badUuid.errors.assignmentId);
});

test('Work Log: Enforces hour limits, precision, and description boundaries', () => {
  // Valid work log
  const valid = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Replaced copper pipe elbow and tested pressure',
    hoursSpent: 2.5,
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.hoursSpent, 2.5);
  }

  // Minimum valid hours (0.1)
  const minHours = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Initial site inspection',
    hoursSpent: 0.1,
  });
  assert.equal(minHours.success, true);

  // Maximum valid hours (24.0)
  const maxHours = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Full day emergency flood containment',
    hoursSpent: 24,
  });
  assert.equal(maxHours.success, true);

  // 0 hours -> invalid
  const zeroHours = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Zero hour log',
    hoursSpent: 0,
  });
  assert.equal(zeroHours.success, false);
  assert.ok(zeroHours.errors.hoursSpent);

  // Negative hours -> invalid
  const negHours = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Negative log',
    hoursSpent: -1.5,
  });
  assert.equal(negHours.success, false);
  assert.ok(negHours.errors.hoursSpent);

  // Excessively large hours (> 24)
  const excessHours = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Too many hours',
    hoursSpent: 25,
  });
  assert.equal(excessHours.success, false);
  assert.ok(excessHours.errors.hoursSpent);

  // Decimal precision beyond 2 places (DECIMAL(5,2))
  const precision = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'Three decimals',
    hoursSpent: 2.555,
  });
  assert.equal(precision.success, false);
  assert.ok(precision.errors.hoursSpent);

  // Description too short
  const shortDesc = validateWorkLogInput({
    assignmentId: VALID_UUID_1,
    description: 'fix',
    hoursSpent: 1.0,
  });
  assert.equal(shortDesc.success, false);
  assert.ok(shortDesc.errors.description);
});

test('Report Triage: Validates confirmed priority level and triage status transition', () => {
  // Valid triage to under_review
  const triage1 = validateReportTriageInput({
    reportId: VALID_UUID_1,
    confirmedPriority: 'high',
    status: 'under_review',
  });
  assert.equal(triage1.success, true);

  // Assigned requires the dedicated assignment command
  const triage2 = validateReportTriageInput({
    reportId: VALID_UUID_1,
    confirmedPriority: 'critical',
    status: 'assigned',
  });
  assert.equal(triage2.success, false);
  assert.ok(triage2.errors.status);

  // Invalid priority
  const badPriority = validateReportTriageInput({
    reportId: VALID_UUID_1,
    confirmedPriority: 'urgent',
    status: 'under_review',
  });
  assert.equal(badPriority.success, false);
  assert.ok(badPriority.errors.confirmedPriority);

  // Invalid status (e.g. attempting to jump straight to verified)
  const badStatus = validateReportTriageInput({
    reportId: VALID_UUID_1,
    confirmedPriority: 'low',
    status: 'verified',
  });
  assert.equal(badStatus.success, false);
  assert.ok(badStatus.errors.status);
});

test('Technician Assignment: Validates reportId and technicianId UUIDs with optional notes', () => {
  // Valid assignment with notes
  const valid = validateTechnicianAssignmentInput({
    reportId: VALID_UUID_1,
    technicianId: VALID_UUID_2,
    notes: 'Please check the circuit breaker panel on floor 2.',
  });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.notes, 'Please check the circuit breaker panel on floor 2.');
  }

  // Valid assignment without notes
  const noNotes = validateTechnicianAssignmentInput({
    reportId: VALID_UUID_1,
    technicianId: VALID_UUID_2,
  });
  assert.equal(noNotes.success, true);
  if (noNotes.success) {
    assert.equal(noNotes.data.notes, undefined);
  }

  // Notes exceeding 500 chars
  const longNotes = validateTechnicianAssignmentInput({
    reportId: VALID_UUID_1,
    technicianId: VALID_UUID_2,
    notes: 'N'.repeat(501),
  });
  assert.equal(longNotes.success, false);
  assert.ok(longNotes.errors.notes);
});

test('Status Transition: Enforces mandatory reasons for holds, cancellations, and reopenings', () => {
  // 1. in_progress -> no mandatory reason required
  const startWork = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'in_progress',
  });
  assert.equal(startWork.success, true);

  // 2. on_hold -> requires reason!
  const holdWithoutReason = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'on_hold',
  });
  assert.equal(holdWithoutReason.success, false);
  assert.ok(holdWithoutReason.errors.reason);

  const holdWithReason = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'on_hold',
    reason: 'Awaiting replacement parts from manufacturer',
  });
  assert.equal(holdWithReason.success, true);

  // 3. cancelled -> requires reason!
  const cancelWithoutReason = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'cancelled',
  });
  assert.equal(cancelWithoutReason.success, false);
  assert.ok(cancelWithoutReason.errors.reason);

  const cancelWithReason = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'cancelled',
    reason: 'Duplicate submission of report RPT-000004',
  });
  assert.equal(cancelWithReason.success, true);

  // 4. reopened -> requires reason!
  const reopenWithoutReason = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'reopened',
  });
  assert.equal(reopenWithoutReason.success, false);
  assert.ok(reopenWithoutReason.errors.reason);

  const reopenWithReason = validateStatusTransitionInput({
    reportId: VALID_UUID_1,
    targetStatus: 'reopened',
    reason: 'Leak reappeared during pressure inspection',
  });
  assert.equal(reopenWithReason.success, true);
});

test('Verification: Enforces detailed notes when repair is marked unsatisfactory', () => {
  // Satisfactory verification (notes optional)
  const passed = validateVerificationInput({
    reportId: VALID_UUID_1,
    isSatisfactory: true,
  });
  assert.equal(passed.success, true);

  // Satisfactory verification with notes
  const passedWithNotes = validateVerificationInput({
    reportId: VALID_UUID_1,
    isSatisfactory: true,
    notes: 'Repair verified clean and fully compliant with plumbing code.',
  });
  assert.equal(passedWithNotes.success, true);

  // Unsatisfactory verification WITHOUT notes -> must fail!
  const failedWithoutNotes = validateVerificationInput({
    reportId: VALID_UUID_1,
    isSatisfactory: false,
  });
  assert.equal(failedWithoutNotes.success, false);
  assert.ok(failedWithoutNotes.errors.notes);

  // Unsatisfactory verification with short notes (< 5 chars)
  const failedShortNotes = validateVerificationInput({
    reportId: VALID_UUID_1,
    isSatisfactory: false,
    notes: 'bad',
  });
  assert.equal(failedShortNotes.success, false);
  assert.ok(failedShortNotes.errors.notes);

  // Unsatisfactory verification with valid notes
  const failedWithValidNotes = validateVerificationInput({
    reportId: VALID_UUID_1,
    isSatisfactory: false,
    notes: 'Seal still leaks under hot water pressure. Needs gasket replacement.',
  });
  assert.equal(failedWithValidNotes.success, true);
});

test('Attachment Metadata: Validates file size and MIME types while storage extensions stay server-derived', () => {
  // Valid attachment metadata
  const valid = validateAttachmentMetaInput({
    reportId: VALID_UUID_1,
    fileName: 'leak_photo.jpg',
    fileSize: 2048576, // ~2 MB
    mimeType: 'image/jpeg',
  });
  assert.equal(valid.success, true);

  // Valid WebP
  const validWebp = validateAttachmentMetaInput({
    reportId: VALID_UUID_1,
    fileName: 'valve.webp',
    fileSize: 500000,
    mimeType: 'image/webp',
  });
  assert.equal(validWebp.success, true);

  // Disallowed MIME type (e.g. PDF or executable)
  const badMime = validateAttachmentMetaInput({
    reportId: VALID_UUID_1,
    fileName: 'document.pdf',
    fileSize: 100000,
    mimeType: 'application/pdf',
  });
  assert.equal(badMime.success, false);
  assert.ok(badMime.errors.mimeType);

  // The original display name cannot determine the persisted Storage extension.
  // Content signatures are verified by the server-side upload layer.
  const suspiciousName = validateAttachmentMetaInput({
    reportId: VALID_UUID_1,
    fileName: 'malware.exe',
    fileSize: 100000,
    mimeType: 'image/png',
  });
  assert.equal(suspiciousName.success, true);

  // Exceeding 10 MB limit (10,485,760 bytes)
  const oversized = validateAttachmentMetaInput({
    reportId: VALID_UUID_1,
    fileName: 'huge.jpg',
    fileSize: 10485761, // 10MB + 1 byte
    mimeType: 'image/jpeg',
  });
  assert.equal(oversized.success, false);
  assert.ok(oversized.errors.fileSize);

  // Zero byte file
  const zeroBytes = validateAttachmentMetaInput({
    reportId: VALID_UUID_1,
    fileName: 'empty.png',
    fileSize: 0,
    mimeType: 'image/png',
  });
  assert.equal(zeroBytes.success, false);
  assert.ok(zeroBytes.errors.fileSize);
});
