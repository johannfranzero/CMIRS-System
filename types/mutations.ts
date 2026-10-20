/**
 * CMIRS — Mutation Payload Contracts and Action Result Types
 *
 * Source of Truth: PostgreSQL core schema, RLS policies, and triggers in
 * `supabase/migrations/20261018000001_core_schema.sql` through `20261018000006_storage_setup.sql`.
 *
 * Architectural Rules:
 * - Client payloads must never include server-derived authorization fields
 *   (e.g., `reporter_id`, `role`, `assigned_by`, `verified_by`).
 * - All mutations enforce strict type safety and input boundaries before database queries.
 */

import type { PriorityLevel, ReportStatus } from './reports';

/**
 * Standardized server-side mutation result returned by DAL functions and Server Actions.
 */
export interface MutationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * React 19 Action State contract for Server Actions bound to forms (`useActionState`).
 */
export interface ActionFormState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  data?: T;
  fieldErrors?: Record<string, string>;
}

/**
 * Payload submitted by a user to create a new maintenance or incident report.
 * Note: `reporter_id` is excluded; established strictly from server session `auth.uid()`.
 */
export interface ReportSubmissionInput {
  title: string;
  description: string;
  categoryId: string;
  locationId: string;
  isUrgentHazard: boolean;
}

/**
 * Result returned upon successful report record creation.
 */
export interface CreatedReportResult {
  id: string;
  reportNumber: string;
  status: ReportStatus;
  createdAt: string;
}

/**
 * Payload for Coordinator review and priority triage.
 */
export interface ReportTriageInput {
  reportId: string;
  confirmedPriority: PriorityLevel;
  status: 'under_review' | 'assigned';
}

/**
 * Payload for Coordinator assigning a technician to a report.
 */
export interface TechnicianAssignmentInput {
  reportId: string;
  technicianId: string;
  notes?: string;
}

/**
 * Payload for Technician declining an assigned work order.
 * Enforces non-empty reason per database constraint `chk_decline_reason`.
 */
export interface AssignmentDeclineInput {
  assignmentId: string;
  reason: string;
}

/**
 * Payload for transitioning report work lifecycle status (e.g., in_progress, on_hold, cancelled).
 */
export interface StatusTransitionInput {
  reportId: string;
  targetStatus: ReportStatus;
  reason?: string;
  assignmentId?: string;
}

/**
 * Payload for Technician logging work hours and repair actions.
 */
export interface WorkLogInput {
  assignmentId: string;
  description: string;
  hoursSpent: number;
}

/**
 * Payload for Coordinator verification of a completed repair.
 * Separation of duties: Coordinator cannot be the reporter or technician.
 */
export interface VerificationInput {
  reportId: string;
  isSatisfactory: boolean;
  notes?: string;
}

/**
 * Payload for validating photo attachment metadata before or during upload.
 */
export interface AttachmentUploadMetaInput {
  reportId: string;
  fileName: string;
  fileSize: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * Result returned after a binary upload and immutable metadata registration succeed.
 * Storage paths intentionally remain server-only.
 */
export interface UploadedAttachmentResult {
  attachmentId: string;
  reportId: string;
  fileName: string;
  fileSize: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  createdAt: string;
}

export interface AttachmentViewUrlResult {
  attachmentId: string;
  reportId: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  signedUrl: string;
  expiresInSeconds: 3600;
}

export interface SoftDeletedAttachmentResult {
  attachmentId: string;
  reportId: string;
}

/**
 * Generic Validation Result containing sanitized typed data or specific field errors.
 */
export type ValidationResult<T> =
  | { success: true; data: T; errors?: never }
  | { success: false; data?: never; errors: Record<string, string> };
