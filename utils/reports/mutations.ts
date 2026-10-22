/**
 * CMIRS — Data Access Layer (DAL) Mutations Service
 *
 * Source of Truth: PostgreSQL core schema, RLS policies, and triggers in
 * `supabase/migrations/20261018000001_core_schema.sql` through `20261018000006_storage_setup.sql`.
 *
 * Security & Architectural Guarantees:
 * 1. Zero Privileged Bypass: All mutations execute under the authenticated user's session client.
 *    No service-role key or admin bypass is permitted in user-facing workflows.
 * 2. Cryptographic Identity Authority: The acting user ID (`auth.uid()`) and verified institutional
 *    role (`profiles.role`) are established exclusively by the server via `getCurrentUserAndProfile()`.
 *    Client-supplied IDs and roles are strictly rejected.
 * 3. Pure Input Validation: Every payload is validated against canonical schema bounds before database queries.
 * 4. Error Sanitization: Raw PostgREST, SQL, and internal database errors are never leaked to callers.
 * 5. Separation of Duties: Coordinators cannot verify reports they authored or for which they served as technician.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedUser } from '../../types/auth';
import type { ReportStatus, PriorityLevel } from '../../types/reports';
import type {
  MutationResult,
  CreatedReportResult,
} from '../../types/mutations';
import {
  validateReportSubmissionInput,
  validateReportTriageInput,
  validateTechnicianAssignmentInput,
  validateAssignmentDeclineInput,
  validateStatusTransitionInput,
  validateWorkLogInput,
  validateVerificationInput,
} from './validation.ts';
import { sanitizeErrorMessage } from './transform.ts';
import { invokeLifecycleRpc, resolveRequestId } from './lifecycle-rpc.ts';

/**
 * Execution context allowing dependency injection for unit testing and server action pipelines.
 */
export interface MutationContext {
  supabase?: SupabaseClient;
  user?: AuthenticatedUser | null;
  /**
   * Idempotency token for the notification-bearing command RPCs (Phase 4C, S-03).
   * The client supplies it so that a retry of the same user action returns the original
   * result instead of creating a second report, assignment, or notification.
   */
  requestId?: string;
}

/**
 * Resolves the authenticated user and Supabase client from context or defaults.
 */
async function resolveAuthAndClient(context?: MutationContext) {
  let user: AuthenticatedUser | null | undefined = context?.user;
  if (user === undefined) {
    const { getCurrentUserAndProfile } = await import('@/utils/auth/server');
    user = await getCurrentUserAndProfile();
  }

  // If user is unauthenticated or inactive, fail early without initializing database client
  if (!user || !user.profile?.is_active) {
    return { user, supabase: (context?.supabase ?? null) as unknown as SupabaseClient };
  }

  let supabase = context?.supabase;
  if (supabase === undefined) {
    const { createClient } = await import('@/utils/supabase/server');
    supabase = (await createClient()) as unknown as SupabaseClient;
  }

  return { user, supabase: supabase as SupabaseClient };
}

// =============================================================================
// 1. Report Submission (`createReportRecord`)
// =============================================================================

/**
 * Creates a new maintenance or incident report record.
 *
 * Requirements & Database Invariants:
 * - Table: `public.reports` (INSERT).
 * - Enforced by RLS `reports_insert`: `reporter_id = auth.uid() AND status = 'submitted' AND confirmed_priority IS NULL`.
 * - Trigger T2 (`trg_reports_report_number`) unconditionally generates `report_number` (e.g. 'RPT-000001').
 * - All authenticated canonical roles may submit reports (Approved PD-R6).
 */
export async function createReportRecord(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<CreatedReportResult>> {
  // 1. Validate payload structure and boundaries
  const validation = validateReportSubmissionInput(input);
  if (!validation.success) {
    return {
      success: false,
      error: 'Invalid report submission payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve authenticated caller
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  try {
    // 3. Execute the notification-bearing submission command.
    //    The command mutates the report and creates the coordinator notifications in ONE
    //    database transaction (Phase 4C, S-01). `p_request_id` makes a retry of the same
    //    user action return the original report instead of creating a second one (S-03).
    const outcome = await invokeLifecycleRpc<{
      report_id: string;
      report_number: string;
      status: string;
      created_at: string;
    }>(
      supabase,
      'submit_report_with_notifications',
      {
        p_title: validation.data.title,
        p_description: validation.data.description,
        p_category_id: validation.data.categoryId,
        p_location_id: validation.data.locationId,
        p_is_urgent_hazard: validation.data.isUrgentHazard,
        p_request_id: resolveRequestId(context?.requestId ?? input),
      },
      'Failed to create maintenance report.'
    );

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    return {
      success: true,
      data: {
        id: outcome.data.report_id,
        reportNumber: outcome.data.report_number,
        status: outcome.data.status as ReportStatus,
        createdAt: outcome.data.created_at,
      },
    };
  } catch (err) {
    console.error('[createReportRecord] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred while submitting the report.',
    };
  }
}

// =============================================================================
// 2. Report Triage (`triageReportRecord`)
// =============================================================================

/**
 * Confirms priority and advances report from `submitted` to `under_review` or `assigned`.
 *
 * Requirements & Database Invariants:
 * - Table: `public.reports` (UPDATE).
 * - Enforced by RLS `reports_update_coordinator`: `public.get_user_role() = 'coordinator' AND status NOT IN ('verified', 'cancelled')`.
 * - Role Authorization: Only `coordinator` role may perform triage.
 * - Trigger T3 automatically audits status change into `public.report_status_history`.
 */
export async function triageReportRecord(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<{ id: string; status: ReportStatus; confirmedPriority: PriorityLevel }>> {
  // 1. Validate payload
  const validation = validateReportTriageInput(input);
  if (!validation.success) {
    return {
      success: false,
      error: 'Invalid triage payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve caller and enforce coordinator role
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'coordinator') {
    return {
      success: false,
      error: 'Access denied: Only Maintenance Coordinators may triage reports.',
    };
  }

  try {
    // 3. Execute the notification-bearing triage command.
    //    Triage advances the report to 'under_review' only; the assignment command owns
    //    'assigned' (approved decision P-04).
    const outcome = await invokeLifecycleRpc<{
      report_id: string;
      status: string;
      confirmed_priority: string;
    }>(
      supabase,
      'triage_report_with_notifications',
      {
        p_report_id: validation.data.reportId,
        p_confirmed_priority: validation.data.confirmedPriority,
        p_target_status: validation.data.status,
        p_request_id: resolveRequestId(context?.requestId ?? input),
      },
      'Failed to update report triage status.'
    );

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    return {
      success: true,
      data: {
        id: outcome.data.report_id,
        status: outcome.data.status as ReportStatus,
        confirmedPriority: outcome.data.confirmed_priority as PriorityLevel,
      },
    };
  } catch (err) {
    console.error('[triageReportRecord] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred during triage.',
    };
  }
}

// =============================================================================
// 3. Technician Assignment (`assignTechnicianToReport`)
// =============================================================================

/**
 * Assigns a technician to a report, handling reassignments and status transitions.
 *
 * Requirements & Database Invariants:
 * - Table 1: `public.assignments` (INSERT / UPDATE).
 * - Table 2: `public.reports` (UPDATE).
 * - Enforced by RLS `assignments_insert_coordinator` and `reports_update_coordinator`.
 * - Approved Decision 1 (Reassignment): If report is `in_progress`, revert status to `assigned`
 *   for the newly assigned technician. Mark existing active assignment as `reassigned`.
 * - Approved Decision 3 (Direct Assignment): Permit assignment directly from `submitted`.
 */
export async function assignTechnicianToReport(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<{ assignmentId: string; reportId: string; technicianId: string; status: 'assigned' }>> {
  // 1. Validate payload
  const validation = validateTechnicianAssignmentInput(input);
  if (!validation.success) {
    return {
      success: false,
      error: 'Invalid technician assignment payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve caller and enforce coordinator role
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'coordinator') {
    return {
      success: false,
      error: 'Access denied: Only Maintenance Coordinators may assign technicians.',
    };
  }

  try {
    // 3. Execute the notification-bearing assignment command.
    //    The command locks the report and its active assignments, rejects a duplicate
    //    dispatch to the already-active technician (approved decision P-05), marks the
    //    previous assignment 'reassigned', creates the new assignment, moves the report to
    //    'assigned', and delivers the assignment notification — all in one transaction.
    const outcome = await invokeLifecycleRpc<{
      assignment_id: string;
      report_id: string;
      technician_id: string;
      status: string;
      was_reassignment: boolean;
    }>(
      supabase,
      'assign_or_reassign_report_with_notifications',
      {
        p_report_id: validation.data.reportId,
        p_technician_id: validation.data.technicianId,
        p_notes: validation.data.notes ?? null,
        p_request_id: resolveRequestId(context?.requestId ?? input),
      },
      'Failed to create technician assignment.'
    );

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    return {
      success: true,
      data: {
        assignmentId: outcome.data.assignment_id,
        reportId: outcome.data.report_id,
        technicianId: outcome.data.technician_id,
        status: 'assigned',
      },
    };
  } catch (err) {
    console.error('[assignTechnicianToReport] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred while assigning the technician.',
    };
  }
}

// =============================================================================
// 4. Assignment Decline (`declineAssignmentViaRpc`)
// =============================================================================

/**
 * Declines an assigned work order via the approved database RPC.
 *
 * Requirements & Database Invariants:
 * - Invokes RPC: `public.decline_assignment(target_assignment_id UUID, reason TEXT)`.
 * - Enforces caller owns the assignment, caller role is 'technician', and status is 'assigned'.
 * - Enforces non-empty, non-whitespace reason via `btrim()` matching `chk_decline_reason`.
 */
export async function declineAssignmentViaRpc(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<{ assignmentId: string; status: 'declined' }>> {
  // 1. Validate payload
  const validation = validateAssignmentDeclineInput(input);
  if (!validation.success) {
    return {
      success: false,
      error: 'Invalid decline payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve caller and enforce technician role
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'technician') {
    return {
      success: false,
      error: 'Access denied: Only Maintenance Technicians may decline assignments.',
    };
  }

  try {
    // 3. Invoke approved database RPC
    const { error: rpcError } = await supabase.rpc('decline_assignment', {
      target_assignment_id: validation.data.assignmentId,
      reason: validation.data.reason,
    });

    if (rpcError) {
      console.error('[declineAssignmentViaRpc] RPC decline_assignment error:', rpcError);
      return {
        success: false,
        error: sanitizeErrorMessage(rpcError, 'Failed to decline assignment.'),
      };
    }

    return {
      success: true,
      data: {
        assignmentId: validation.data.assignmentId,
        status: 'declined',
      },
    };
  } catch (err) {
    console.error('[declineAssignmentViaRpc] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred while declining the assignment.',
    };
  }
}

// =============================================================================
// 5. Status Transition (`transitionReportStatusRecord`)
// =============================================================================

/**
 * Transitions report lifecycle status according to the approved state machine and actor permissions.
 *
 * Requirements & Database Invariants:
 * - Table 1: `public.reports` (UPDATE).
 * - Table 2: `public.assignments` (UPDATE when applicable).
 * - Trigger T3 automatically logs status transition into `public.report_status_history`.
 * - Actors & State Machine:
 *   - Reporter: Cancel own report while in `submitted` or `under_review` (Approved PD-W2).
 *   - Technician: `in_progress`, `on_hold`, `completed` on assigned work order (Approved PD-W1).
 *   - Coordinator: Hold, resume, or cancellation across non-terminal states (Approved PD-W3).
 */
export async function transitionReportStatusRecord(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<{ reportId: string; previousStatus: ReportStatus; newStatus: ReportStatus }>> {
  // 1. Validate payload
  const validation = validateStatusTransitionInput(input);
  if (!validation.success) {
    // When a single field is at fault, surface its precise message rather than a generic
    // one (for example: "Repair completion notes of at least 5 characters are required").
    const fieldMessages = Object.values(validation.errors).filter(
      (message): message is string => typeof message === 'string' && message.length > 0
    );
    return {
      success: false,
      error:
        fieldMessages.length === 1 ? fieldMessages[0] : 'Invalid status transition payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve caller
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  const { reportId, targetStatus } = validation.data;

  // The command RPC owns the transition matrix. Rejecting the statuses that belong to other
  // commands here produces a precise, actionable message instead of a generic failure.
  const SUPPORTED_TRANSITIONS: ReportStatus[] = ['in_progress', 'on_hold', 'completed', 'cancelled'];
  if (!SUPPORTED_TRANSITIONS.includes(targetStatus)) {
    return {
      success: false,
      error:
        targetStatus === 'assigned'
          ? 'Use the technician assignment command to move a report to assigned.'
          : targetStatus === 'under_review'
            ? 'Use the triage command to move a report to under review.'
            : targetStatus === 'verified' || targetStatus === 'reopened'
              ? 'Use the verification command to close or reopen a completed report.'
              : `Unsupported direct transition to "${targetStatus}".`,
    };
  }

  try {
    // Execute the notification-bearing status command.
    // The command re-derives the caller, the report state, the assignment ownership and the
    // role permissions inside the database, applies the report and assignment side effects
    // together, records the status history reason, and delivers the approved notifications.
    const outcome = await invokeLifecycleRpc<{
      report_id: string;
      previous_status: string;
      new_status: string;
    }>(
      supabase,
      'transition_report_status_with_notifications',
      {
        p_report_id: reportId,
        p_target_status: targetStatus,
        p_reason: validation.data.reason ?? null,
        p_request_id: resolveRequestId(context?.requestId ?? input),
      },
      'Failed to transition report status.'
    );

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    return {
      success: true,
      data: {
        reportId: outcome.data.report_id,
        previousStatus: outcome.data.previous_status as ReportStatus,
        newStatus: outcome.data.new_status as ReportStatus,
      },
    };
  } catch (err) {
    console.error('[transitionReportStatusRecord] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred during status transition.',
    };
  }
}

// =============================================================================
// 6. Work Log Entry (`createWorkLogRecord`)
// =============================================================================

/**
 * Creates a work session log entry on an active technician assignment.
 *
 * Requirements & Database Invariants:
 * - Table: `public.work_logs` (INSERT).
 * - Enforced by RLS `work_logs_insert`: `technician_id = auth.uid()` on active assignment (`assigned`, `in_progress`, `on_hold`).
 * - Decimal precision: Hours spent up to 2 decimal places (`DECIMAL(5,2)`).
 */
export async function createWorkLogRecord(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<{ id: string; assignmentId: string; hoursSpent: number; createdAt: string }>> {
  // 1. Validate payload
  const validation = validateWorkLogInput(input);
  if (!validation.success) {
    return {
      success: false,
      error: 'Invalid work log payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve caller and enforce technician role
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'technician') {
    return {
      success: false,
      error: 'Access denied: Only Maintenance Technicians may log work hours.',
    };
  }

  try {
    // 3. Insert work log record
    const { data, error } = await supabase
      .from('work_logs')
      .insert({
        assignment_id: validation.data.assignmentId,
        technician_id: user.id,
        description: validation.data.description,
        hours_spent: validation.data.hoursSpent,
      })
      .select('id, assignment_id, hours_spent, created_at')
      .single();

    if (error || !data) {
      console.error('[createWorkLogRecord] Error inserting work log:', error);
      return {
        success: false,
        error: sanitizeErrorMessage(error, 'Failed to record work log entry.'),
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        assignmentId: data.assignment_id,
        hoursSpent: Number(data.hours_spent),
        createdAt: data.created_at,
      },
    };
  } catch (err) {
    console.error('[createWorkLogRecord] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred while recording the work log.',
    };
  }
}

// =============================================================================
// 7. Coordinator Verification (`verifyReportRecord`)
// =============================================================================

/**
 * Records coordinator verification of a completed repair, resolving or reopening the report.
 *
 * Requirements & Database Invariants:
 * - Table 1: `public.verifications` (INSERT).
 * - Table 2: `public.reports` (UPDATE: `verified` if satisfactory, `reopened` if unsatisfactory).
 * - Enforced by RLS `verifications_insert_coordinator`:
 *   - Verified by = auth.uid()
 *   - Report status = 'completed'
 *   - Separation of Duties (PD-R4): Verifier != Reporter (`r.reporter_id != auth.uid()`)
 *   - Separation of Duties (D2): Verifier != Technician (`NOT EXISTS assignments.technician_id = auth.uid()`)
 * - Approved Decision 2: Unlimited verification rejections are permitted in MVP with history tracking.
 */
export async function verifyReportRecord(
  input: unknown,
  context?: MutationContext
): Promise<MutationResult<{ verificationId: string; reportId: string; isSatisfactory: boolean; newStatus: ReportStatus }>> {
  // 1. Validate payload
  const validation = validateVerificationInput(input);
  if (!validation.success) {
    return {
      success: false,
      error: 'Invalid verification payload.',
      fieldErrors: validation.errors,
    };
  }

  // 2. Resolve caller and enforce coordinator role
  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active) {
    return {
      success: false,
      error: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'coordinator') {
    return {
      success: false,
      error: 'Access denied: Only Maintenance Coordinators may verify reports.',
    };
  }

  const { reportId, isSatisfactory, notes } = validation.data;

  try {
    // Execute the notification-bearing verification command.
    // The command locks the report, requires the 'completed' status, enforces the
    // separation of duties (the reporter and the assigned technician may not verify their
    // own work), writes the verification record, moves the report to 'verified' or
    // 'reopened', and delivers the verification notification — all in one transaction.
    const outcome = await invokeLifecycleRpc<{
      verification_id: string;
      report_id: string;
      is_satisfactory: boolean;
      new_status: string;
    }>(
      supabase,
      'verify_report_with_notifications',
      {
        p_report_id: reportId,
        p_is_satisfactory: isSatisfactory,
        p_notes: notes ?? null,
        p_request_id: resolveRequestId(context?.requestId ?? input),
      },
      'Failed to record verification result.'
    );

    if (!outcome.ok) {
      return { success: false, error: outcome.error };
    }

    return {
      success: true,
      data: {
        verificationId: outcome.data.verification_id,
        reportId: outcome.data.report_id,
        isSatisfactory: outcome.data.is_satisfactory,
        newStatus: outcome.data.new_status as ReportStatus,
      },
    };
  } catch (err) {
    console.error('[verifyReportRecord] Unexpected exception:', err);
    return {
      success: false,
      error: 'An unexpected system error occurred during report verification.',
    };
  }
}
