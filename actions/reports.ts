'use server';

/**
 * CMIRS — Server Actions for Report Lifecycle & Mutations
 *
 * Source of Truth:
 * - `docs/frontend/PHASE_3_3_MUTATION_INTEGRATION_PLAN.md`
 * - `docs/frontend/PHASE_3_3_MILESTONE_2_REPORT.md`
 * - Database Schema: `supabase/migrations/20261018000001_core_schema.sql` through `20261018000006_storage_setup.sql`.
 *
 * Architectural & Security Rules:
 * 1. Strict Server Actions: Annotated with 'use server' for React 19 form actions & programmatic invocation.
 * 2. Zero Privileged Bypass: All actions execute under the authenticated user's session client.
 * 3. Cryptographic Identity Authority: Identity and role are derived exclusively from server session JWT
 *    and active database profile via `getCurrentUserAndProfile()`. Client identity claims are rejected.
 * 4. Dual-Mode Input Extraction: Supports both `FormData` (from HTML forms) and typed JavaScript payloads.
 * 5. Deterministic Cache Invalidation: Revalidates `/` and `/reports` only upon confirmed database success.
 * 6. Error Sanitization: Raw SQL and database internals are never returned to callers.
 */

import type {
  ActionFormState,
  ReportSubmissionInput,
  CreatedReportResult,
  ReportTriageInput,
  TechnicianAssignmentInput,
  AssignmentDeclineInput,
  StatusTransitionInput,
  WorkLogInput,
  VerificationInput,
} from '../types/mutations';
import type { ReportStatus, PriorityLevel } from '../types/reports';
import type { AuthenticatedUser } from '../types/auth';
import {
  validateReportSubmissionInput,
  validateReportTriageInput,
  validateTechnicianAssignmentInput,
  validateAssignmentDeclineInput,
  validateStatusTransitionInput,
  validateWorkLogInput,
  validateVerificationInput,
} from '../utils/reports/validation.ts';
import {
  createReportRecord,
  triageReportRecord,
  assignTechnicianToReport,
  declineAssignmentViaRpc,
  transitionReportStatusRecord,
  createWorkLogRecord,
  verifyReportRecord,
  type MutationContext,
} from '../utils/reports/mutations.ts';

/**
 * Initial idle state contract for React 19 `useActionState` hooks.
 */
export const INITIAL_ACTION_STATE: ActionFormState<never> = {
  status: 'idle',
};

/**
 * Resolves the authenticated user from injected context or via server session lookup.
 */
async function resolveUser(context?: MutationContext): Promise<AuthenticatedUser | null> {
  if (context?.user !== undefined) {
    return context.user;
  }
  const { getCurrentUserAndProfile } = await import('@/utils/auth/server');
  return getCurrentUserAndProfile();
}

/**
 * Safely invalidates Next.js Server Component route caches after a confirmed successful mutation.
 * Handled deliberately so revalidation errors do not obscure successful database writes.
 */
async function triggerCacheRevalidation(paths: string[] = ['/', '/reports']): Promise<void> {
  try {
    let revalidate: ((path: string) => void) | undefined;
    try {
      const mod = await import('next/cache');
      revalidate = mod.revalidatePath;
    } catch {
      const mod = await import('next/cache.js');
      revalidate = mod.revalidatePath;
    }

    if (revalidate) {
      for (const path of paths) {
        revalidate(path);
      }
    }
  } catch (err) {
    // In unit test or non-request environments where Next cache context is unavailable, log concise notice
    if (process.env.NODE_ENV !== 'test') {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[triggerCacheRevalidation] Notice: Route cache revalidation skipped in non-Next runtime:', msg);
    }
  }
}

// =============================================================================
// 1. Submit Report Action (`submitReportAction`)
// =============================================================================

/**
 * Server Action: Creates a new maintenance or incident report.
 * Accessible to all authenticated canonical roles per Approved PD-R6.
 */
export async function submitReportAction(
  prevState: ActionFormState<CreatedReportResult>,
  payload: FormData | ReportSubmissionInput,
  context?: MutationContext
): Promise<ActionFormState<CreatedReportResult>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    rawInput = {
      title: payload.get('title')?.toString(),
      description: payload.get('description')?.toString(),
      categoryId: payload.get('categoryId')?.toString(),
      locationId: payload.get('locationId')?.toString(),
      isUrgentHazard:
        payload.get('isUrgentHazard') === 'true' || payload.get('isUrgentHazard') === 'on',
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input on the server
  const validation = validateReportSubmissionInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Please correct the highlighted form errors.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate caller
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  // 4. Invoke Data Access Layer
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await createReportRecord(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to submit report. Please try again.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: `Report ${result.data.reportNumber} submitted successfully.`,
    data: result.data,
  };
}

// =============================================================================
// 2. Triage Report Action (`triageReportAction`)
// =============================================================================

/**
 * Server Action: Confirms priority level and triage lifecycle status.
 * Restricted strictly to `coordinator` role.
 */
export async function triageReportAction(
  prevState: ActionFormState<{ id: string; status: ReportStatus; confirmedPriority: PriorityLevel }>,
  payload: FormData | ReportTriageInput,
  context?: MutationContext
): Promise<ActionFormState<{ id: string; status: ReportStatus; confirmedPriority: PriorityLevel }>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    rawInput = {
      reportId: payload.get('reportId')?.toString(),
      confirmedPriority: payload.get('confirmedPriority')?.toString(),
      status: payload.get('status')?.toString(),
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input
  const validation = validateReportTriageInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Invalid triage parameters.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate and enforce coordinator role
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'coordinator') {
    return {
      status: 'error',
      message: 'Access denied: Only Maintenance Coordinators may triage reports.',
    };
  }

  // 4. Invoke Data Access Layer
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await triageReportRecord(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to triage report.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: 'Report triage completed successfully.',
    data: result.data,
  };
}

// =============================================================================
// 3. Assign Technician Action (`assignTechnicianAction`)
// =============================================================================

/**
 * Server Action: Dispatches or reassigns a technician to a maintenance report.
 * Restricted strictly to `coordinator` role.
 */
export async function assignTechnicianAction(
  prevState: ActionFormState<{ assignmentId: string; reportId: string; technicianId: string; status: 'assigned' }>,
  payload: FormData | TechnicianAssignmentInput,
  context?: MutationContext
): Promise<ActionFormState<{ assignmentId: string; reportId: string; technicianId: string; status: 'assigned' }>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    const rawNotes = payload.get('notes')?.toString();
    rawInput = {
      reportId: payload.get('reportId')?.toString(),
      technicianId: payload.get('technicianId')?.toString(),
      notes: rawNotes && rawNotes.trim().length > 0 ? rawNotes : undefined,
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input
  const validation = validateTechnicianAssignmentInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Invalid technician assignment parameters.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate and enforce coordinator role
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'coordinator') {
    return {
      status: 'error',
      message: 'Access denied: Only Maintenance Coordinators may assign technicians.',
    };
  }

  // 4. Invoke Data Access Layer
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await assignTechnicianToReport(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to assign technician.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: 'Technician assigned successfully.',
    data: result.data,
  };
}

// =============================================================================
// 4. Decline Assignment Action (`declineAssignmentAction`)
// =============================================================================

/**
 * Server Action: Declines an assigned work order via the approved database RPC.
 * Restricted strictly to `technician` role on assignments assigned to the caller.
 */
export async function declineAssignmentAction(
  prevState: ActionFormState<{ assignmentId: string; status: 'declined' }>,
  payload: FormData | AssignmentDeclineInput,
  context?: MutationContext
): Promise<ActionFormState<{ assignmentId: string; status: 'declined' }>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    rawInput = {
      assignmentId: payload.get('assignmentId')?.toString(),
      reason: payload.get('reason')?.toString(),
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input
  const validation = validateAssignmentDeclineInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Invalid decline reason. A detailed reason is required.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate and enforce technician role
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'technician') {
    return {
      status: 'error',
      message: 'Access denied: Only Maintenance Technicians may decline assignments.',
    };
  }

  // 4. Invoke Data Access Layer
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await declineAssignmentViaRpc(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to decline assignment.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: 'Work order assignment declined.',
    data: result.data,
  };
}

// =============================================================================
// 5. Status Transition Action (`transitionReportStatusAction`)
// =============================================================================

/**
 * Server Action: Advances or halts report lifecycle status according to the state machine.
 * Enforces role-based transition matrix (reporter cancellation, technician work tracking, coordinator holds).
 */
export async function transitionReportStatusAction(
  prevState: ActionFormState<{ reportId: string; previousStatus: ReportStatus; newStatus: ReportStatus }>,
  payload: FormData | StatusTransitionInput,
  context?: MutationContext
): Promise<ActionFormState<{ reportId: string; previousStatus: ReportStatus; newStatus: ReportStatus }>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    const rawReason = payload.get('reason')?.toString();
    const rawAssignId = payload.get('assignmentId')?.toString();
    rawInput = {
      reportId: payload.get('reportId')?.toString(),
      targetStatus: payload.get('targetStatus')?.toString(),
      reason: rawReason && rawReason.trim().length > 0 ? rawReason : undefined,
      assignmentId: rawAssignId && rawAssignId.trim().length > 0 ? rawAssignId : undefined,
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input
  const validation = validateStatusTransitionInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Invalid status transition parameters.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate caller
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  // 4. Invoke Data Access Layer
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await transitionReportStatusRecord(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to transition report status.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: `Report status updated to "${result.data.newStatus}".`,
    data: result.data,
  };
}

// =============================================================================
// 6. Work Log Action (`createWorkLogAction`)
// =============================================================================

/**
 * Server Action: Records technician work session hours and maintenance actions.
 * Restricted strictly to `technician` role on active assignments.
 */
export async function createWorkLogAction(
  prevState: ActionFormState<{ id: string; assignmentId: string; hoursSpent: number; createdAt: string }>,
  payload: FormData | WorkLogInput,
  context?: MutationContext
): Promise<ActionFormState<{ id: string; assignmentId: string; hoursSpent: number; createdAt: string }>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    rawInput = {
      assignmentId: payload.get('assignmentId')?.toString(),
      description: payload.get('description')?.toString(),
      hoursSpent: Number(payload.get('hoursSpent')),
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input
  const validation = validateWorkLogInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Invalid work log parameters.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate and enforce technician role
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'technician') {
    return {
      status: 'error',
      message: 'Access denied: Only Maintenance Technicians may log work hours.',
    };
  }

  // 4. Invoke Data Access Layer
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await createWorkLogRecord(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to record work log.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: 'Work log recorded successfully.',
    data: result.data,
  };
}

// =============================================================================
// 7. Verify Report Action (`verifyReportAction`)
// =============================================================================

/**
 * Server Action: Verifies completed repair work, either closing report as verified
 * or reopening it for further technician work.
 * Enforces strict separation of duties (verifier != reporter, verifier != technician).
 * Restricted strictly to `coordinator` role.
 */
export async function verifyReportAction(
  prevState: ActionFormState<{ verificationId: string; reportId: string; isSatisfactory: boolean; newStatus: ReportStatus }>,
  payload: FormData | VerificationInput,
  context?: MutationContext
): Promise<ActionFormState<{ verificationId: string; reportId: string; isSatisfactory: boolean; newStatus: ReportStatus }>> {
  // 1. Extract payload fields
  let rawInput: Record<string, unknown>;
  if (payload instanceof FormData) {
    const rawNotes = payload.get('notes')?.toString();
    const isSatRaw = payload.get('isSatisfactory');
    rawInput = {
      reportId: payload.get('reportId')?.toString(),
      isSatisfactory: isSatRaw === 'true' || isSatRaw === 'on',
      notes: rawNotes && rawNotes.trim().length > 0 ? rawNotes : undefined,
    };
  } else {
    rawInput = { ...payload };
  }

  // 2. Validate input
  const validation = validateVerificationInput(rawInput);
  if (!validation.success) {
    return {
      status: 'error',
      message: 'Invalid verification parameters.',
      fieldErrors: validation.errors,
    };
  }

  // 3. Authenticate and enforce coordinator role
  const user = await resolveUser(context);
  if (!user || !user.profile.is_active) {
    return {
      status: 'error',
      message: 'Authentication required. Please log in with an active account.',
    };
  }

  if (user.profile.role !== 'coordinator') {
    return {
      status: 'error',
      message: 'Access denied: Only Maintenance Coordinators may verify reports.',
    };
  }

  // 4. Invoke Data Access Layer (enforces separation of duties and completed status)
  const mutationContext: MutationContext = { user, supabase: context?.supabase };
  const result = await verifyReportRecord(validation.data, mutationContext);

  if (!result.success || !result.data) {
    return {
      status: 'error',
      message: result.error ?? 'Failed to verify report.',
      fieldErrors: result.fieldErrors,
    };
  }

  // 5. Revalidate cache on confirmed success
  await triggerCacheRevalidation(['/', '/reports']);

  return {
    status: 'success',
    message: result.data.isSatisfactory
      ? 'Report repair verified and closed.'
      : 'Report verification rejected; ticket reopened for repair.',
    data: result.data,
  };
}
