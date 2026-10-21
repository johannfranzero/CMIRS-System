import type {
  MaintenanceReport,
  DashboardStats,
  ReportStatus,
  PriorityLevel,
  AssignmentStatus,
  DetailedReport,
  ReportAssignmentDetail,
  ReportStatusHistoryItem,
  ReportWorkLogItem,
  ReportVerificationItem,
  ReportAttachmentItem,
  OperationalAnalytics,
  AnalyticsDistributionItem,
  TechnicianWorkloadItem,
} from '../../types/reports';

/**
 * Phase 4D: the hardcoded `FALLBACK_CATEGORIES`, `FALLBACK_LOCATIONS` and `FALLBACK_TECHNICIANS`
 * fixtures were removed from this module. They were previously returned by the reference-data
 * DAL functions whenever a Supabase query failed or returned no rows, which silently served
 * fabricated reference data (including two non-existent technician accounts) to authenticated
 * users. The reference catalogs now fail honestly instead.
 */

/**
 * Raw joined record shape returned from Supabase PostgREST queries.
 */
export interface RawDbReportRow {
  id: string;
  report_number: string;
  title: string;
  description: string;
  status: ReportStatus;
  is_urgent_hazard: boolean;
  confirmed_priority: PriorityLevel | null;
  created_at: string;
  updated_at: string;
  category_id?: string;
  location_id?: string;
  reporter_id?: string;
  categories?: {
    id?: string;
    name?: string;
    description?: string;
  } | null;
  locations?: {
    id?: string;
    building_name?: string;
    floor?: string;
    room?: string;
    description?: string;
  } | null;
  reporter?: {
    id?: string;
    full_name?: string;
    role?: string;
    email?: string;
  } | null;
  assignments?: Array<{
    id?: string;
    status?: AssignmentStatus;
    assigned_at?: string;
    started_at?: string | null;
    completed_at?: string | null;
    notes?: string | null;
    decline_reason?: string | null;
    technician_id?: string;
    technician?: {
      id?: string;
      full_name?: string;
      email?: string;
      phone?: string;
    } | null;
    work_logs?: Array<{
      id?: string;
      assignment_id?: string;
      description?: string;
      hours_spent?: number | string;
      created_at?: string;
      technician_id?: string;
      technician?: {
        id?: string;
        full_name?: string;
      } | null;
    }> | null;
  }> | null;
}

/**
 * Raw joined shape for detailed report view including history, logs, verifications, and attachments.
 */
export interface RawDbReportDetailRow extends RawDbReportRow {
  report_status_history?: Array<{
    id: string;
    previous_status: ReportStatus | null;
    new_status: ReportStatus;
    reason?: string | null;
    created_at: string;
    changed_by: string;
    changed_by_profile?: {
      id?: string;
      full_name?: string;
      role?: string;
    } | null;
  }> | null;
  verifications?: Array<{
    id: string;
    is_satisfactory: boolean;
    notes?: string | null;
    verified_at: string;
    verified_by: string;
    verifier?: {
      id?: string;
      full_name?: string;
      role?: string;
    } | null;
  }> | null;
  report_attachments?: Array<{
    id: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    created_at: string;
    deleted_at?: string | null;
    uploaded_by: string;
    uploader?: {
      id?: string;
      full_name?: string;
    } | null;
  }> | null;
}


/**
 * Computes calendar week boundaries in Philippine Standard Time (PST / Asia/Manila, UTC+8).
 * Week starts Monday at 12:00:00 AM (00:00:00.000) and ends the following Monday at 12:00:00 AM exclusive.
 *
 * Designed to be timezone-independent: yields identical UTC boundary instants regardless of
 * the local server runtime timezone.
 */
export function getPhilippineWeekBounds(referenceDate = new Date()): {
  startOfWeek: Date;
  endOfWeek: Date;
} {
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8 in milliseconds
  const manilaTime = new Date(referenceDate.getTime() + PHT_OFFSET_MS);

  // In UTC getters on shifted time: 0 = Sun, 1 = Mon, ..., 6 = Sat
  const dayOfWeek = manilaTime.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const year = manilaTime.getUTCFullYear();
  const month = manilaTime.getUTCMonth();
  const date = manilaTime.getUTCDate() - daysSinceMonday;

  // Monday 00:00:00.000 in Manila represented as UTC Instant
  const startUtcMs = Date.UTC(year, month, date, 0, 0, 0, 0) - PHT_OFFSET_MS;
  const startOfWeek = new Date(startUtcMs);

  // Following Monday 00:00:00.000 in Manila (exclusive)
  const endOfWeek = new Date(startUtcMs + 7 * 24 * 60 * 60 * 1000);

  return { startOfWeek, endOfWeek };
}

/**
 * Checks if a given timestamp falls within the current Philippine calendar week.
 */
export function isDateInPhilippineWeek(
  dateIsoOrTimestamp: string | Date | undefined | null,
  referenceDate = new Date()
): boolean {
  if (!dateIsoOrTimestamp) return false;
  const targetDate = typeof dateIsoOrTimestamp === 'string'
    ? new Date(dateIsoOrTimestamp)
    : dateIsoOrTimestamp;

  if (Number.isNaN(targetDate.getTime())) return false;

  const { startOfWeek, endOfWeek } = getPhilippineWeekBounds(referenceDate);
  const time = targetDate.getTime();
  return time >= startOfWeek.getTime() && time < endOfWeek.getTime();
}

/**
 * Transforms a raw database joined row into the canonical UI `MaintenanceReport` model.
 *
 * Key business rules:
 * - `confirmed_priority` is nullable (initial reports have NULL until coordinator triage).
 * - `assignedTechnician` is extracted from active assignments (`assigned`, `in_progress`, `on_hold`),
 *   ignoring declined or reassigned records when active work exists.
 * - Missing relations fail gracefully with safe fallback labels.
 */
export function transformDbReportToMaintenanceReport(row: RawDbReportRow): MaintenanceReport {
  let activeAssignment: RawDbReportRow['assignments'] extends (infer T)[] | null | undefined
    ? T | undefined
    : undefined = undefined;

  if (Array.isArray(row.assignments) && row.assignments.length > 0) {
    // 1. Look for active work status first
    const activeList = row.assignments.filter(
      (a) => a.status === 'assigned' || a.status === 'in_progress' || a.status === 'on_hold'
    );

    if (activeList.length > 0) {
      // Pick most recently assigned
      activeAssignment = activeList.sort((a, b) => {
        const timeA = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
        const timeB = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
        return timeB - timeA;
      })[0];
    } else {
      // 2. Otherwise check for completed assignment awaiting verification
      const completed = row.assignments.find((a) => a.status === 'completed');
      if (completed) {
        activeAssignment = completed;
      }
    }
  }

  return {
    id: row.id,
    trackingNumber: row.report_number || `RPT-${row.id.substring(0, 8)}`,
    title: row.title || 'Untitled Report',
    description: row.description || '',
    category: row.categories?.name || 'General Maintenance',
    categoryId: row.category_id,
    location: {
      building: row.locations?.building_name || 'Main Campus',
      floor: row.locations?.floor || '1',
      room: row.locations?.room || undefined,
      specificArea: row.locations?.description || undefined,
    },
    locationId: row.location_id,
    status: row.status || 'submitted',
    priority: row.confirmed_priority ?? null,
    isUrgentHazard: Boolean(row.is_urgent_hazard),
    reporterName: row.reporter?.full_name || 'Campus Reporter',
    reporterRole: row.reporter?.role || 'student_personnel',
    reporterId: row.reporter_id || row.reporter?.id,
    reporterEmail: row.reporter?.email,
    assignedTechnician: activeAssignment?.technician?.full_name,
    assignedTechnicianId: activeAssignment?.technician_id,
    assignmentStatus: activeAssignment?.status,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

/**
 * Transforms a raw PostgREST joined detailed report record into the typed DetailedReport domain model.
 */
export function transformDbReportToDetailedReport(row: RawDbReportDetailRow): DetailedReport {
  const base = transformDbReportToMaintenanceReport(row);

  const rawAssignments = Array.isArray(row.assignments) ? row.assignments : [];
  const assignmentsList: ReportAssignmentDetail[] = rawAssignments
    .filter((a): a is NonNullable<typeof a> => a != null && typeof a.id === 'string')
    .map((a) => ({
      id: a.id || '',
      technicianId: a.technician_id || '',
      technicianName: a.technician?.full_name || 'Assigned Technician',
      technicianEmail: a.technician?.email,
      technicianPhone: a.technician?.phone,
      assignedAt: a.assigned_at || base.createdAt,
      startedAt: a.started_at,
      completedAt: a.completed_at,
      status: a.status || 'assigned',
      notes: a.notes,
      declineReason: a.decline_reason,
    }))
    .sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());

  const workLogs: ReportWorkLogItem[] = [];
  for (const a of rawAssignments) {
    if (a && Array.isArray(a.work_logs)) {
      for (const w of a.work_logs) {
        if (w && typeof w.id === 'string') {
          workLogs.push({
            id: w.id,
            assignmentId: w.assignment_id || a.id || '',
            technicianId: w.technician_id || a.technician_id || '',
            technicianName: w.technician?.full_name || a.technician?.full_name || 'Technician',
            description: w.description || '',
            hoursSpent: Number(w.hours_spent) || 0,
            createdAt: w.created_at || base.createdAt,
          });
        }
      }
    }
  }
  workLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const rawHistory = Array.isArray(row.report_status_history) ? row.report_status_history : [];
  const statusHistory: ReportStatusHistoryItem[] = rawHistory
    .filter((h): h is NonNullable<typeof h> => h != null && typeof h.id === 'string')
    .map((h) => ({
      id: h.id || '',
      previousStatus: h.previous_status,
      newStatus: h.new_status,
      changedBy: h.changed_by || '',
      changedByName: h.changed_by_profile?.full_name,
      changedByRole: h.changed_by_profile?.role,
      reason: h.reason,
      createdAt: h.created_at || base.createdAt,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const rawVerifications = Array.isArray(row.verifications) ? row.verifications : [];
  const verifications: ReportVerificationItem[] = rawVerifications
    .filter((v): v is NonNullable<typeof v> => v != null && typeof v.id === 'string')
    .map((v) => ({
      id: v.id || '',
      verifierId: v.verified_by || '',
      verifierName: v.verifier?.full_name,
      verifierRole: v.verifier?.role,
      isSatisfactory: v.is_satisfactory,
      notes: v.notes,
      verifiedAt: v.verified_at || base.createdAt,
    }))
    .sort((a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime());

  const rawAttachments = Array.isArray(row.report_attachments) ? row.report_attachments : [];
  const attachments: ReportAttachmentItem[] = rawAttachments
    .filter((att): att is NonNullable<typeof att> => att != null && typeof att.id === 'string' && att.deleted_at == null)
    .map((att) => ({
      id: att.id || '',
      fileName: att.file_name || 'attachment',
      fileSize: att.file_size || 0,
      mimeType: att.mime_type || 'image/jpeg',
      uploadedBy: att.uploaded_by || '',
      uploaderName: att.uploader?.full_name,
      createdAt: att.created_at || base.createdAt,
      deletedAt: att.deleted_at,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    ...base,
    assignmentsList,
    statusHistory,
    workLogs,
    verifications,
    attachments,
  };
}

/**
 * Calculates Dashboard KPI statistics strictly from visible database records.
 *
 * Implements Approved Business Decisions:
 * 1. `completed` reports count as ACTIVE (work completed by technician, awaiting coordinator verification).
 * 2. Only `verified` reports are considered RESOLVED.
 * 3. `resolvedThisWeek` strictly uses the report's `updated_at` resolution timestamp in Philippine
 *    calendar week (Monday 12:00 AM to following Monday 12:00 AM UTC+8). Does not substitute `created_at`.
 */
export function calculateKpiStatsFromDbReports(
  reports: Array<{
    status: ReportStatus;
    is_urgent_hazard: boolean;
    confirmed_priority: PriorityLevel | null;
    created_at?: string;
    updated_at?: string;
  }>,
  referenceDate = new Date()
): DashboardStats {
  let totalActive = 0;
  let pendingReview = 0;
  let inProgress = 0;
  let resolvedThisWeek = 0;
  let urgentHazards = 0;

  for (const report of reports) {
    // Approved Business Decision: Only verified reports are resolved.
    // 'completed' reports are pending verification and remain ACTIVE.
    const isResolved = report.status === 'verified';
    const isCancelled = report.status === 'cancelled';
    const isActive = !isResolved && !isCancelled;

    if (isActive) {
      totalActive += 1;
    }

    if (report.status === 'submitted' || report.status === 'under_review') {
      pendingReview += 1;
    }

    if (
      report.status === 'assigned' ||
      report.status === 'in_progress' ||
      report.status === 'on_hold'
    ) {
      inProgress += 1;
    }

    // Approved Business Decision: Use actual resolution timestamp (updated_at upon verification),
    // strictly within the Philippine calendar week. Do not substitute created_at.
    if (isResolved && report.updated_at) {
      if (isDateInPhilippineWeek(report.updated_at, referenceDate)) {
        resolvedThisWeek += 1;
      }
    }

    if (report.is_urgent_hazard || report.confirmed_priority === 'critical') {
      urgentHazards += 1;
    }
  }

  return {
    totalActive,
    pendingReview,
    inProgress,
    resolvedThisWeek,
    urgentHazards,
  };
}

/**
 * Checks whether a fetched dataset has been truncated by query or server limits.
 */
export function isDatasetTruncated(
  totalCount: number | null | undefined,
  fetchedCount: number
): boolean {
  if (totalCount === null || totalCount === undefined) return false;
  return totalCount > fetchedCount;
}

export interface RawAnalyticsReport {
  id: string;
  status?: ReportStatus | null;
  confirmed_priority?: PriorityLevel | null;
  is_urgent_hazard?: boolean | null;
  categories?: { name?: string | null } | Array<{ name?: string | null }> | null;
  locations?: { building_name?: string | null } | Array<{ building_name?: string | null }> | null;
  assignments?: Array<{
    technician_id?: string | null;
    status?: AssignmentStatus | null;
    technician?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  }> | null;
}

export const ACTIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'assigned',
  'in_progress',
  'on_hold',
];

function getRelationValue(
  relation: { name?: string | null; building_name?: string | null; full_name?: string | null }
    | Array<{ name?: string | null; building_name?: string | null; full_name?: string | null }>
    | null
    | undefined,
  field: 'name' | 'building_name' | 'full_name'
): string | null {
  const value = Array.isArray(relation) ? relation[0]?.[field] : relation?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createAnalyticsDistribution(labels: readonly string[]): AnalyticsDistributionItem[] {
  const counts = new Map<string, number>();

  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return Array.from(counts, ([label, count]) => ({ label, count })).sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label)
  );
}

function formatStatusLabel(status: ReportStatus | null | undefined): string {
  if (!status) return 'Unspecified status';
  return status
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function formatPriorityLabel(priority: PriorityLevel | null | undefined): string {
  if (!priority) return 'Unconfirmed';
  return `${priority.charAt(0).toUpperCase()}${priority.slice(1)}`;
}

export function isAnalyticsDatasetComplete(
  totalCount: number | null | undefined,
  fetchedCount: number
): boolean {
  return (
    totalCount !== null &&
    totalCount !== undefined &&
    totalCount >= 0 &&
    !isDatasetTruncated(totalCount, fetchedCount)
  );
}

export function calculateOperationalAnalytics(
  reports: readonly RawAnalyticsReport[]
): OperationalAnalytics {
  const statuses: string[] = [];
  const priorities: string[] = [];
  const categories: string[] = [];
  const locations: string[] = [];
  const workloads = new Map<string, TechnicianWorkloadItem>();
  let urgentHazardReports = 0;
  let activeAssignments = 0;

  for (const report of reports) {
    statuses.push(formatStatusLabel(report.status));
    priorities.push(formatPriorityLabel(report.confirmed_priority));
    categories.push(getRelationValue(report.categories, 'name') ?? 'Uncategorized');
    locations.push(getRelationValue(report.locations, 'building_name') ?? 'Unspecified location');

    if (report.is_urgent_hazard) {
      urgentHazardReports += 1;
    }

    for (const assignment of report.assignments ?? []) {
      if (!assignment.status || !ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
        continue;
      }

      activeAssignments += 1;
      const technicianId = assignment.technician_id ?? 'unassigned';
      const technicianName = getRelationValue(assignment.technician, 'full_name') ?? 'Unassigned technician';
      const current = workloads.get(technicianId);

      workloads.set(technicianId, {
        technicianId,
        technicianName,
        activeAssignments: (current?.activeAssignments ?? 0) + 1,
      });
    }
  }

  return {
    totalReports: reports.length,
    urgentHazardReports,
    activeAssignments,
    statusDistribution: createAnalyticsDistribution(statuses),
    priorityDistribution: createAnalyticsDistribution(priorities),
    categoryDistribution: createAnalyticsDistribution(categories),
    locationDistribution: createAnalyticsDistribution(locations),
    technicianWorkload: Array.from(workloads.values()).sort(
      (left, right) =>
        right.activeAssignments - left.activeAssignments ||
        left.technicianName.localeCompare(right.technicianName)
    ),
  };
}

/**
 * Extracts campus facility breakdown counts strictly from visible reports.
 */
export function getFacilityBreakdownFromReports(
  reports: readonly MaintenanceReport[]
): Array<{ building: string; count: number }> {
  const countsByBuilding = new Map<string, number>();

  for (const report of reports) {
    const bldg = report.location?.building || 'Unspecified Facility';
    countsByBuilding.set(bldg, (countsByBuilding.get(bldg) || 0) + 1);
  }

  return Array.from(countsByBuilding.entries()).map(([building, count]) => ({
    building,
    count,
  }));
}

/**
 * Safely constructs a queue URL while preserving active filters and encoding parameters.
 */
export function buildReportsQueueUrl(params: {
  page: number;
  status?: string;
  category?: string;
  search?: string;
}): string {
  const query = new URLSearchParams();

  if (params.page > 1) {
    query.set('page', params.page.toString());
  }

  if (params.status && params.status !== 'all') {
    query.set('status', params.status);
  }

  if (params.category && params.category !== 'all') {
    query.set('category', params.category);
  }

  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim());
  }

  const qs = query.toString();
  return qs ? `/reports?${qs}` : '/reports';
}

/**
 * Maps a Supabase/PostgREST database error onto an accurate, non-revealing user-facing notice.
 *
 * Phase 4D: the previous implementation discarded every database error and always returned a
 * single generic string, which made a genuine failure (for example a foreign-key violation on
 * a category or location that was deactivated) indistinguishable from an outage. The mapping
 * below is intentionally built from a fixed allow-list of messages: no SQL text, schema name,
 * table name, column name, or constraint name is ever surfaced to the browser. The raw error is
 * still written to the server log by the calling DAL function.
 */
export function describeDatabaseError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';

  // PostgreSQL integrity constraint violations
  if (code === '23503') {
    return 'The selected category or location is no longer available. Please reload the page and choose again.';
  }
  if (code === '23505') {
    return 'A record with these details already exists. Please reload the page before retrying.';
  }
  if (code === '23502') {
    return 'A required field could not be recorded by the database. Please try again.';
  }
  if (code === '23514') {
    return 'The submitted details violate a campus maintenance data rule. Please review the form and try again.';
  }

  // Authorization / row level security
  if (code === '42501') {
    return 'You do not have permission to perform this action.';
  }
  if (code === 'PGRST301' || message.includes('jwt') || message.includes('token')) {
    return 'Your session is no longer valid. Please sign in again and retry.';
  }

  // Missing row
  if (code === 'PGRST116') {
    return 'The requested record could not be found.';
  }

  // Connectivity / transport failures
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return 'The database service could not be reached. Please try again shortly.';
  }

  return null;
}

/**
 * Replaces internal technical database error messages with sanitized, user-friendly notices.
 *
 * Uses the accurate allow-listed classification above when the error is recognised, and
 * otherwise falls back to the caller-provided generic notice. Raw database internals are
 * never returned to the caller.
 */
export function sanitizeErrorMessage(
  error: unknown,
  fallbackMessage = 'Unable to complete the database request. Please try again shortly.'
): string {
  if (!error) return fallbackMessage;
  // Never expose raw SQL errors, schema names, or table names to the UI
  return describeDatabaseError(error) ?? fallbackMessage;
}
