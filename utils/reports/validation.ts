/**
 * CMIRS — Mutation Input Validation and Sanitization Service
 *
 * Source of Truth: PostgreSQL core schema, RLS policies, and triggers in
 * `supabase/migrations/20261018000001_core_schema.sql` through `20261018000006_storage_setup.sql`.
 *
 * Rules:
 * - Pure, deterministic, side-effect-free functions.
 * - Enforces database constraints, field bounds, enum invariants, and MIME limitations.
 * - Rejects client-supplied identity claims and authorization claims.
 */

import type {
  ReportSubmissionInput,
  ReportTriageInput,
  TechnicianAssignmentInput,
  AssignmentDeclineInput,
  StatusTransitionInput,
  WorkLogInput,
  VerificationInput,
  AttachmentUploadMetaInput,
  ValidationResult,
} from '../../types/mutations';
import type { ReportStatus, PriorityLevel, AssignmentStatus } from '../../types/reports';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ALLOWED_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REPORT = 5;

const ATTACHMENT_EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const VALID_REPORT_STATUSES: readonly ReportStatus[] = [
  'submitted',
  'under_review',
  'assigned',
  'in_progress',
  'on_hold',
  'completed',
  'verified',
  'reopened',
  'cancelled',
] as const;

export const VALID_PRIORITY_LEVELS: readonly PriorityLevel[] = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export const VALID_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'assigned',
  'in_progress',
  'on_hold',
  'completed',
  'reassigned',
  'cancelled',
  'declined',
] as const;

/**
 * Validates whether a value conforms to standard UUID v4 format.
 */
export function isValidUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
}

/**
 * Validates canonical ReportStatus enum.
 */
export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (VALID_REPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * Validates canonical PriorityLevel enum.
 */
export function isPriorityLevel(value: unknown): value is PriorityLevel {
  return typeof value === 'string' && (VALID_PRIORITY_LEVELS as readonly string[]).includes(value);
}

/**
 * Validates canonical AssignmentStatus enum.
 */
export function isAssignmentStatus(value: unknown): value is AssignmentStatus {
  return typeof value === 'string' && (VALID_ASSIGNMENT_STATUSES as readonly string[]).includes(value);
}

export function isAllowedAttachmentMimeType(
  value: unknown
): value is (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number] {
  return (
    typeof value === 'string' &&
    (ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Returns a storage extension from the trusted MIME allowlist, never from a filename.
 */
export function getAttachmentExtensionForMime(
  mimeType: (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number]
): 'jpg' | 'png' | 'webp' {
  return ATTACHMENT_EXTENSION_BY_MIME[mimeType];
}

/**
 * Preserves a readable name for the immutable metadata record without accepting path segments.
 */
export function sanitizeAttachmentFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const basename = value.replace(/\\\\/g, '/').split('/').pop()?.trim() ?? '';
  const sanitized = basename
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^a-zA-Z0-9._() -]/g, '_')
    .slice(0, 255);

  return sanitized || null;
}

/**
 * Validates Report Submission payload.
 *
 * Requirements:
 * - Title: 5 to 120 characters, no control characters.
 * - Description: 10 to 2000 characters.
 * - CategoryId & LocationId: Valid UUIDs.
 * - isUrgentHazard: boolean.
 * - Rejects any attempt to spoof server-derived identity or initial priority/status.
 */
export function validateReportSubmissionInput(input: unknown): ValidationResult<ReportSubmissionInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid submission payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  // Security guard: Reject client-supplied authority or identity fields
  const forbiddenKeys = ['reporter_id', 'reporterId', 'status', 'confirmed_priority', 'confirmedPriority', 'report_number', 'reportNumber'];
  for (const key of forbiddenKeys) {
    if (key in raw && raw[key] !== undefined && raw[key] !== null) {
      errors[key] = `Client-supplied "${key}" is prohibited. Value is established exclusively by the server.`;
    }
  }

  // 1. Title validation
  if (typeof raw.title !== 'string') {
    errors.title = 'Title is required.';
  } else {
    const trimmedTitle = raw.title.trim();
    if (trimmedTitle.length < 5) {
      errors.title = 'Title must be at least 5 characters.';
    } else if (trimmedTitle.length > 120) {
      errors.title = 'Title must not exceed 120 characters.';
    } else if (/[\r\n\t]/.test(trimmedTitle)) {
      errors.title = 'Title must not contain newline or tab characters.';
    }
  }

  // 2. Description validation
  if (typeof raw.description !== 'string') {
    errors.description = 'Description is required.';
  } else {
    const trimmedDesc = raw.description.trim();
    if (trimmedDesc.length < 10) {
      errors.description = 'Description must be at least 10 characters.';
    } else if (trimmedDesc.length > 2000) {
      errors.description = 'Description must not exceed 2000 characters.';
    }
  }

  // 3. CategoryId validation
  if (!isValidUuid(raw.categoryId)) {
    errors.categoryId = 'A valid category must be selected.';
  }

  // 4. LocationId validation
  if (!isValidUuid(raw.locationId)) {
    errors.locationId = 'A valid campus location must be selected.';
  }

  // 5. isUrgentHazard validation
  const isUrgent = raw.isUrgentHazard === true || raw.isUrgentHazard === 'true';

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      title: (raw.title as string).trim(),
      description: (raw.description as string).trim(),
      categoryId: (raw.categoryId as string).trim(),
      locationId: (raw.locationId as string).trim(),
      isUrgentHazard: isUrgent,
    },
  };
}

/**
 * Validates Assignment Decline payload.
 * Enforces non-empty, non-whitespace reason (min 5 chars) matching `chk_decline_reason`.
 */
export function validateAssignmentDeclineInput(input: unknown): ValidationResult<AssignmentDeclineInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid decline payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.assignmentId)) {
    errors.assignmentId = 'A valid assignment identifier is required.';
  }

  if (typeof raw.reason !== 'string' || raw.reason.trim().length < 5) {
    errors.reason = 'A decline reason of at least 5 characters is required.';
  } else if (raw.reason.trim().length > 500) {
    errors.reason = 'Decline reason must not exceed 500 characters.';
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      assignmentId: (raw.assignmentId as string).trim(),
      reason: (raw.reason as string).trim(),
    },
  };
}

/**
 * Validates Work Log payload.
 * Enforces hours between 0.1 and 24.0 with at most 2 decimal places.
 */
export function validateWorkLogInput(input: unknown): ValidationResult<WorkLogInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid work log payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.assignmentId)) {
    errors.assignmentId = 'A valid assignment identifier is required.';
  }

  if (typeof raw.description !== 'string' || raw.description.trim().length < 5) {
    errors.description = 'Work description must be at least 5 characters.';
  } else if (raw.description.trim().length > 1000) {
    errors.description = 'Work description must not exceed 1000 characters.';
  }

  const hours = Number(raw.hoursSpent);
  if (Number.isNaN(hours) || hours < 0.1 || hours > 24) {
    errors.hoursSpent = 'Hours spent must be a number between 0.1 and 24.0.';
  } else {
    // Check decimal precision (at most 2 decimals for DECIMAL(5,2))
    const parts = String(raw.hoursSpent).split('.');
    if (parts.length === 2 && parts[1].length > 2) {
      errors.hoursSpent = 'Hours spent cannot exceed 2 decimal places.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      assignmentId: (raw.assignmentId as string).trim(),
      description: (raw.description as string).trim(),
      hoursSpent: Math.round(hours * 100) / 100,
    },
  };
}

/**
 * Validates Report Triage input.
 */
export function validateReportTriageInput(input: unknown): ValidationResult<ReportTriageInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid triage payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.reportId)) {
    errors.reportId = 'A valid report identifier is required.';
  }

  if (!isPriorityLevel(raw.confirmedPriority)) {
    errors.confirmedPriority = 'Confirmed priority must be low, medium, high, or critical.';
  }

  if (raw.status !== 'under_review' && raw.status !== 'assigned') {
    errors.status = 'Triage status must be under_review or assigned.';
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      reportId: (raw.reportId as string).trim(),
      confirmedPriority: raw.confirmedPriority as PriorityLevel,
      status: raw.status as 'under_review' | 'assigned',
    },
  };
}

/**
 * Validates Technician Assignment input.
 */
export function validateTechnicianAssignmentInput(input: unknown): ValidationResult<TechnicianAssignmentInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid assignment payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.reportId)) {
    errors.reportId = 'A valid report identifier is required.';
  }

  if (!isValidUuid(raw.technicianId)) {
    errors.technicianId = 'A valid technician identifier is required.';
  }

  let notes: string | undefined = undefined;
  if (raw.notes !== undefined && raw.notes !== null) {
    if (typeof raw.notes !== 'string') {
      errors.notes = 'Notes must be text.';
    } else if (raw.notes.trim().length > 500) {
      errors.notes = 'Notes must not exceed 500 characters.';
    } else if (raw.notes.trim().length > 0) {
      notes = raw.notes.trim();
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      reportId: (raw.reportId as string).trim(),
      technicianId: (raw.technicianId as string).trim(),
      notes,
    },
  };
}

/**
 * Validates Status Transition input.
 * Requires a reason (min 5 chars) for 'on_hold', 'cancelled', and 'reopened'.
 */
export function validateStatusTransitionInput(input: unknown): ValidationResult<StatusTransitionInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid status transition payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.reportId)) {
    errors.reportId = 'A valid report identifier is required.';
  }

  if (!isReportStatus(raw.targetStatus)) {
    errors.targetStatus = 'Target status is not a recognized report status.';
  }

  const target = raw.targetStatus as ReportStatus;
  const reasonRequired = target === 'on_hold' || target === 'cancelled' || target === 'reopened';

  let reason: string | undefined = undefined;
  if (typeof raw.reason === 'string') {
    const trimmed = raw.reason.trim();
    if (trimmed.length > 500) {
      errors.reason = 'Reason must not exceed 500 characters.';
    } else if (trimmed.length > 0) {
      reason = trimmed;
    }
  }

  if (reasonRequired && (!reason || reason.length < 5)) {
    errors.reason = `A reason of at least 5 characters is required when moving to status "${target}".`;
  }

  let assignmentId: string | undefined = undefined;
  if (raw.assignmentId !== undefined && raw.assignmentId !== null && raw.assignmentId !== '') {
    if (!isValidUuid(raw.assignmentId)) {
      errors.assignmentId = 'Assignment ID must be a valid UUID.';
    } else {
      assignmentId = (raw.assignmentId as string).trim();
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      reportId: (raw.reportId as string).trim(),
      targetStatus: target,
      reason,
      assignmentId,
    },
  };
}

/**
 * Validates Verification input.
 * Requires notes when repair is marked unsatisfactory (`isSatisfactory === false`).
 */
export function validateVerificationInput(input: unknown): ValidationResult<VerificationInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid verification payload format.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.reportId)) {
    errors.reportId = 'A valid report identifier is required.';
  }

  const isSatisfactory = raw.isSatisfactory === true || raw.isSatisfactory === 'true';

  let notes: string | undefined = undefined;
  if (typeof raw.notes === 'string') {
    const trimmed = raw.notes.trim();
    if (trimmed.length > 1000) {
      errors.notes = 'Verification notes must not exceed 1000 characters.';
    } else if (trimmed.length > 0) {
      notes = trimmed;
    }
  }

  if (!isSatisfactory && (!notes || notes.length < 5)) {
    errors.notes = 'A detailed note of at least 5 characters is required when a repair fails verification.';
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      reportId: (raw.reportId as string).trim(),
      isSatisfactory,
      notes,
    },
  };
}

/**
 * Validates Attachment metadata payload against constraints in `20261018000006_storage_setup.sql`.
 * - Max size: 10,485,760 bytes (10MB).
 * - MIME types: image/jpeg, image/png, image/webp.
 */
export function validateAttachmentMetaInput(input: unknown): ValidationResult<AttachmentUploadMetaInput> {
  const errors: Record<string, string> = {};

  if (!input || typeof input !== 'object') {
    return { success: false, errors: { _form: 'Invalid attachment metadata payload.' } };
  }

  const raw = input as Record<string, unknown>;

  if (!isValidUuid(raw.reportId)) {
    errors.reportId = 'A valid report identifier is required.';
  }

  const fileName = sanitizeAttachmentFileName(raw.fileName);
  if (!fileName) {
    errors.fileName = 'File name is required.';
  }

  const size = Number(raw.fileSize);
  if (Number.isNaN(size) || !Number.isInteger(size) || size <= 0) {
    errors.fileSize = 'File size must be a positive integer.';
  } else if (size > MAX_ATTACHMENT_BYTES) {
    errors.fileSize = 'File size exceeds maximum limit of 10 MB (10,485,760 bytes).';
  }

  if (!isAllowedAttachmentMimeType(raw.mimeType)) {
    errors.mimeType = 'MIME type must be image/jpeg, image/png, or image/webp.';
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      reportId: (raw.reportId as string).trim(),
      fileName: fileName as string,
      fileSize: size,
      mimeType: raw.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    },
  };
}
