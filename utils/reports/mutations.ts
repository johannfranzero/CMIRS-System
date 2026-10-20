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

/**
 * Execution context allowing dependency injection for unit testing and server action pipelines.
 */
export interface MutationContext {
  supabase?: SupabaseClient;
  user?: AuthenticatedUser | null;
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
    // 3. Insert report record
    const { data, error } = await supabase
      .from('reports')
      .insert({
        title: validation.data.title,
        description: validation.data.description,
        category_id: validation.data.categoryId,
        location_id: validation.data.locationId,
        is_urgent_hazard: validation.data.isUrgentHazard,
        reporter_id: user.id,
        status: 'submitted',
        confirmed_priority: null,
      })
      .select('id, report_number, status, created_at')
      .single();

    if (error || !data) {
      console.error('[createReportRecord] PostgREST insert error:', error);
      return {
        success: false,
        error: sanitizeErrorMessage(error, 'Failed to create maintenance report.'),
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        reportNumber: data.report_number,
        status: data.status as ReportStatus,
        createdAt: data.created_at,
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
    // 3. Update report with confirmed priority and triage status
    const { data, error } = await supabase
      .from('reports')
      .update({
        confirmed_priority: validation.data.confirmedPriority,
        status: validation.data.status,
      })
      .eq('id', validation.data.reportId)
      .select('id, status, confirmed_priority')
      .single();

    if (error || !data) {
      console.error('[triageReportRecord] PostgREST update error:', error);
      return {
        success: false,
        error: sanitizeErrorMessage(error, 'Failed to update report triage status.'),
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        status: data.status as ReportStatus,
        confirmedPriority: data.confirmed_priority as PriorityLevel,
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
    // 3. Verify target technician profile is active and has role 'technician'
    const { data: techProfile, error: techError } = await supabase
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', validation.data.technicianId)
      .single();

    if (techError || !techProfile) {
      return {
        success: false,
        error: 'The selected technician profile could not be found.',
      };
    }

    if (!techProfile.is_active || techProfile.role !== 'technician') {
      return {
        success: false,
        error: 'The assigned user must be an active Maintenance Technician.',
      };
    }

    // 4. Verify target report is in an assignable (non-terminal) state
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, status, reporter_id')
      .eq('id', validation.data.reportId)
      .single();

    if (reportError || !report) {
      return {
        success: false,
        error: 'Report not found.',
      };
    }

    if (report.status === 'verified' || report.status === 'cancelled') {
      return {
        success: false,
        error: 'Cannot assign a technician to a verified or cancelled report.',
      };
    }

    // 5. Reassignment Handling: Mark existing active assignments as 'reassigned'
    const { error: reassignError } = await supabase
      .from('assignments')
      .update({ status: 'reassigned' })
      .eq('report_id', validation.data.reportId)
      .in('status', ['assigned', 'in_progress', 'on_hold']);

    if (reassignError) {
      console.error('[assignTechnicianToReport] Error updating previous assignments:', reassignError);
      return {
        success: false,
        error: sanitizeErrorMessage(reassignError, 'Failed to update prior technician assignment.'),
      };
    }

    // 6. Create new assignment row
    const { data: newAssignment, error: insertError } = await supabase
      .from('assignments')
      .insert({
        report_id: validation.data.reportId,
        technician_id: validation.data.technicianId,
        assigned_by: user.id,
        status: 'assigned',
        notes: validation.data.notes ?? null,
      })
      .select('id, report_id, technician_id, status')
      .single();

    if (insertError || !newAssignment) {
      console.error('[assignTechnicianToReport] Error inserting new assignment:', insertError);
      return {
        success: false,
        error: sanitizeErrorMessage(insertError, 'Failed to create technician assignment.'),
      };
    }

    // 7. Update report status to 'assigned' (Reverts 'in_progress' to 'assigned' per Decision 1)
    if (report.status !== 'assigned') {
      const { error: reportUpdateError } = await supabase
        .from('reports')
        .update({ status: 'assigned' })
        .eq('id', validation.data.reportId);

      if (reportUpdateError) {
        console.error('[assignTechnicianToReport] Partial failure: Failed to update report status:', reportUpdateError);
        return {
          success: false,
          error: sanitizeErrorMessage(
            reportUpdateError,
            'Technician assigned, but failed to update report lifecycle status to assigned.'
          ),
        };
      }
    }

    return {
      success: true,
      data: {
        assignmentId: newAssignment.id,
        reportId: newAssignment.report_id,
        technicianId: newAssignment.technician_id,
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
    return {
      success: false,
      error: 'Invalid status transition payload.',
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
  const callerRole = user.profile.role;

  try {
    // 3. Fetch current report state
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, status, reporter_id')
      .eq('id', reportId)
      .single();

    if (reportError || !report) {
      return {
        success: false,
        error: 'Report not found.',
      };
    }

    const currentStatus = report.status as ReportStatus;

    if (currentStatus === 'verified' || currentStatus === 'cancelled') {
      return {
        success: false,
        error: 'Cannot transition a report that has reached a terminal state (verified or cancelled).',
      };
    }

    if (currentStatus === targetStatus) {
      return {
        success: false,
        error: `Report is already in status "${targetStatus}".`,
      };
    }

    // 4. Role and state-machine authorization checks
    if (targetStatus === 'cancelled') {
      // Cancellation logic
      const isReporter = report.reporter_id === user.id;
      const isReporterEligible =
        isReporter && (currentStatus === 'submitted' || currentStatus === 'under_review');
      const isCoordinator = callerRole === 'coordinator';

      if (!isReporterEligible && !isCoordinator) {
        return {
          success: false,
          error:
            'Access denied: You are not authorized to cancel this report in its current state.',
        };
      }

      // If coordinator cancels, cancel active assignments as well (Approved PD-W4)
      if (isCoordinator) {
        await supabase
          .from('assignments')
          .update({ status: 'cancelled' })
          .eq('report_id', reportId)
          .in('status', ['assigned', 'in_progress', 'on_hold']);
      }
    } else if (targetStatus === 'in_progress') {
      // Starting or resuming work
      if (callerRole === 'technician') {
        const { data: assignment } = await supabase
          .from('assignments')
          .select('id, status, started_at')
          .eq('report_id', reportId)
          .eq('technician_id', user.id)
          .in('status', ['assigned', 'on_hold'])
          .maybeSingle();

        if (!assignment) {
          return {
            success: false,
            error: 'Access denied: You do not have an eligible assignment on this report to start or resume work.',
          };
        }

        const updatePayload: Record<string, unknown> = { status: 'in_progress' };
        if (!assignment.started_at) {
          updatePayload.started_at = new Date().toISOString();
        }

        await supabase
          .from('assignments')
          .update(updatePayload)
          .eq('id', assignment.id);
      } else if (callerRole === 'coordinator') {
        if (currentStatus !== 'on_hold') {
          return {
            success: false,
            error: 'Coordinators may only transition reports to in_progress from on_hold.',
          };
        }
      } else {
        return {
          success: false,
          error: 'Access denied: Only assigned technicians or coordinators may start or resume work.',
        };
      }
    } else if (targetStatus === 'on_hold') {
      // Placing work on hold (requires reason)
      if (callerRole === 'technician') {
        const { data: assignment } = await supabase
          .from('assignments')
          .select('id')
          .eq('report_id', reportId)
          .eq('technician_id', user.id)
          .eq('status', 'in_progress')
          .maybeSingle();

        if (!assignment) {
          return {
            success: false,
            error: 'Access denied: You do not have an active in-progress assignment to place on hold.',
          };
        }

        await supabase
          .from('assignments')
          .update({ status: 'on_hold' })
          .eq('id', assignment.id);
      } else if (callerRole !== 'coordinator') {
        return {
          success: false,
          error: 'Access denied: Only assigned technicians or coordinators may place work on hold.',
        };
      }
    } else if (targetStatus === 'completed') {
      // Completing repair
      if (callerRole !== 'technician') {
        return {
          success: false,
          error: 'Access denied: Only the assigned technician may mark a repair as completed.',
        };
      }

      const { data: assignment } = await supabase
        .from('assignments')
        .select('id')
        .eq('report_id', reportId)
        .eq('technician_id', user.id)
        .eq('status', 'in_progress')
        .maybeSingle();

      if (!assignment) {
        return {
          success: false,
          error: 'Access denied: You do not have an in-progress assignment on this report to complete.',
        };
      }

      await supabase
        .from('assignments')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', assignment.id);
    } else {
      return {
        success: false,
        error: `Unsupported direct transition to "${targetStatus}". Use dedicated assignment or verification workflows.`,
      };
    }

    // 5. Update report status in database (Trigger T3 automatically logs to report_status_history)
    const { data: updatedReport, error: updateError } = await supabase
      .from('reports')
      .update({ status: targetStatus })
      .eq('id', reportId)
      .select('id, status')
      .single();

    if (updateError || !updatedReport) {
      console.error('[transitionReportStatusRecord] Error updating report status:', updateError);
      return {
        success: false,
        error: sanitizeErrorMessage(updateError, 'Failed to transition report status.'),
      };
    }

    return {
      success: true,
      data: {
        reportId: updatedReport.id,
        previousStatus: currentStatus,
        newStatus: updatedReport.status as ReportStatus,
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
    // 3. Verify report status and separation-of-duties preconditions
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .select('id, status, reporter_id')
      .eq('id', reportId)
      .single();

    if (reportError || !report) {
      return {
        success: false,
        error: 'Report not found.',
      };
    }

    if (report.status !== 'completed') {
      return {
        success: false,
        error: `Only reports in completed status can be verified. Current status is "${report.status}".`,
      };
    }

    if (report.reporter_id === user.id) {
      return {
        success: false,
        error: 'Separation of duties violation: Coordinators cannot verify reports that they submitted.',
      };
    }

    // 4. Verify coordinator did not serve as technician on this report
    const { data: techAssignment } = await supabase
      .from('assignments')
      .select('id')
      .eq('report_id', reportId)
      .eq('technician_id', user.id)
      .in('status', ['assigned', 'in_progress', 'completed'])
      .maybeSingle();

    if (techAssignment) {
      return {
        success: false,
        error:
          'Separation of duties violation: Coordinators cannot verify reports where they served as the technician.',
      };
    }

    // 5. Insert verification record (must be performed while report is in 'completed' status per RLS)
    const { data: verification, error: verifError } = await supabase
      .from('verifications')
      .insert({
        report_id: reportId,
        verified_by: user.id,
        is_satisfactory: isSatisfactory,
        notes: notes ?? null,
      })
      .select('id, report_id, is_satisfactory')
      .single();

    if (verifError || !verification) {
      console.error('[verifyReportRecord] Error inserting verification record:', verifError);
      return {
        success: false,
        error: sanitizeErrorMessage(verifError, 'Failed to record verification result.'),
      };
    }

    // 6. Update report lifecycle status: 'verified' (terminal) or 'reopened' (rework)
    const targetStatus: ReportStatus = isSatisfactory ? 'verified' : 'reopened';
    const { error: updateError } = await supabase
      .from('reports')
      .update({ status: targetStatus })
      .eq('id', reportId);

    if (updateError) {
      console.error('[verifyReportRecord] Partial failure: Failed to update report status:', updateError);
      return {
        success: false,
        error: sanitizeErrorMessage(
          updateError,
          `Verification recorded, but failed to update report status to "${targetStatus}".`
        ),
      };
    }

    return {
      success: true,
      data: {
        verificationId: verification.id,
        reportId: verification.report_id,
        isSatisfactory: verification.is_satisfactory,
        newStatus: targetStatus,
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
