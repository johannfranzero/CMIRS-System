import type {
  MaintenanceReport,
  DashboardStats,
  ReportStatus,
  PriorityLevel,
  AssignmentStatus,
} from '../../types/reports';

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
    technician_id?: string;
    technician?: {
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
 * Replaces internal technical database error messages with sanitized, user-friendly notices.
 */
export function sanitizeErrorMessage(
  error: unknown,
  fallbackMessage = 'Unable to complete the database request. Please try again shortly.'
): string {
  if (!error) return fallbackMessage;
  // Never expose raw SQL errors, schema names, or table names to the UI
  return fallbackMessage;
}
