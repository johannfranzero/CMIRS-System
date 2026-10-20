import { createClient } from '@/utils/supabase/server';
import { getCurrentUserAndProfile } from '@/utils/auth/server';
import {
  MaintenanceReport,
  DashboardStats,
  ReportQueueParams,
  PaginatedReportsResult,
  DashboardKpiResult,
  PriorityLevel,
  ReportStatus,
  AssignmentStatus,
} from '@/types/reports';

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
 * Verified PostgREST column selection query including foreign-key joins.
 * Matches schemas defined in `20261018000001_core_schema.sql`.
 */
export const SELECT_REPORTS_FIELDS = `
  id,
  report_number,
  title,
  description,
  status,
  is_urgent_hazard,
  confirmed_priority,
  created_at,
  updated_at,
  category_id,
  location_id,
  reporter_id,
  categories (
    id,
    name,
    description
  ),
  locations (
    id,
    building_name,
    floor,
    room,
    description
  ),
  reporter:profiles!reporter_id (
    id,
    full_name,
    role,
    email
  ),
  assignments (
    id,
    status,
    assigned_at,
    technician_id,
    technician:profiles!technician_id (
      id,
      full_name
    )
  )
`;

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
  // Extract active assignment if present
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
 * Ensures zero leakage of hidden reports across role perspectives.
 */
export function calculateKpiStatsFromDbReports(
  reports: Array<{
    status: ReportStatus;
    is_urgent_hazard: boolean;
    confirmed_priority: PriorityLevel | null;
    created_at?: string;
    updated_at?: string;
  }>
): DashboardStats {
  let totalActive = 0;
  let pendingReview = 0;
  let inProgress = 0;
  let resolvedThisWeek = 0;
  let urgentHazards = 0;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  for (const report of reports) {
    const isResolved = report.status === 'completed' || report.status === 'verified';
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

    if (isResolved) {
      const timestamp = report.updated_at || report.created_at;
      if (timestamp && new Date(timestamp) >= oneWeekAgo) {
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
 * Live Read Data Access Layer: Fetches paginated reports for queue and dashboard.
 *
 * Security & Authorization Guarantees:
 * - Executes under the authenticated user's session client (`createClient()`).
 * - Never uses service-role credentials.
 * - PostgreSQL RLS predicate `can_view_report()` automatically filters visible rows.
 * - Additional role-aware filter applied for `student_personnel` (`reporter_id = auth.uid()`)
 *   for optimal database indexing and defense-in-depth.
 * - Fails closed on unauthenticated or inactive accounts.
 */
export async function getReportsQueue(
  params: ReportQueueParams = {}
): Promise<PaginatedReportsResult> {
  const user = await getCurrentUserAndProfile();

  if (!user || !user.profile.is_active) {
    return {
      reports: [],
      totalCount: 0,
      currentPage: 1,
      pageSize: params.pageSize || 15,
      totalPages: 0,
      hasMore: false,
      isLiveData: false,
      error: 'Unauthenticated or inactive user session.',
    };
  }

  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize || 15));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const supabase = await createClient();

    let query = supabase
      .from('reports')
      .select(SELECT_REPORTS_FIELDS, { count: 'exact' });

    // 1. Role-aware defense-in-depth query scoping
    if (user.profile.role === 'student_personnel') {
      query = query.eq('reporter_id', user.id);
    }

    // 2. Status filter
    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    }

    // 3. Category filter
    if (params.category && params.category !== 'all') {
      query = query.eq('categories.name', params.category);
    }

    // 4. Text search filter
    if (params.search?.trim()) {
      const sanitized = params.search.trim().replace(/[%_]/g, '');
      if (sanitized) {
        query = query.or(
          `title.ilike.%${sanitized}%,report_number.ilike.%${sanitized}%,description.ilike.%${sanitized}%`
        );
      }
    }

    // 5. Order & range pagination
    query = query
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data, count, error } = await query;

    if (error) {
      console.error('[DAL] getReportsQueue query error:', error.message);
      return {
        reports: [],
        totalCount: 0,
        currentPage: page,
        pageSize,
        totalPages: 0,
        hasMore: false,
        isLiveData: true,
        error: `Database query failed: ${error.message}`,
      };
    }

    const transformedReports = (data || []).map((row) =>
      transformDbReportToMaintenanceReport(row as unknown as RawDbReportRow)
    );
    const totalCount = count ?? transformedReports.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return {
      reports: transformedReports,
      totalCount,
      currentPage: page,
      pageSize,
      totalPages,
      hasMore: to + 1 < totalCount,
      isLiveData: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    console.error('[DAL] getReportsQueue unexpected exception:', message);
    return {
      reports: [],
      totalCount: 0,
      currentPage: page,
      pageSize,
      totalPages: 0,
      hasMore: false,
      isLiveData: false,
      error: message,
    };
  }
}

/**
 * Live Read Data Access Layer: Computes Dashboard KPI metrics from visible database records.
 *
 * Security & Authorization Guarantees:
 * - Executes under the authenticated user's session client (`createClient()`).
 * - Never uses service-role credentials.
 * - Strictly aggregates only from rows permitted by PostgreSQL RLS.
 * - Fails closed with zero counts on errors or unauthenticated access.
 */
export async function getDashboardKpiStats(): Promise<DashboardKpiResult> {
  const user = await getCurrentUserAndProfile();

  if (!user || !user.profile.is_active) {
    return {
      stats: {
        totalActive: 0,
        pendingReview: 0,
        inProgress: 0,
        resolvedThisWeek: 0,
        urgentHazards: 0,
      },
      isLiveData: false,
      error: 'Unauthenticated or inactive user session.',
    };
  }

  try {
    const supabase = await createClient();

    let query = supabase
      .from('reports')
      .select('id, status, is_urgent_hazard, confirmed_priority, created_at, updated_at');

    if (user.profile.role === 'student_personnel') {
      query = query.eq('reporter_id', user.id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[DAL] getDashboardKpiStats query error:', error.message);
      return {
        stats: {
          totalActive: 0,
          pendingReview: 0,
          inProgress: 0,
          resolvedThisWeek: 0,
          urgentHazards: 0,
        },
        isLiveData: true,
        error: `Database query failed: ${error.message}`,
      };
    }

    const stats = calculateKpiStatsFromDbReports(
      (data || []) as Array<{
        status: ReportStatus;
        is_urgent_hazard: boolean;
        confirmed_priority: PriorityLevel | null;
        created_at?: string;
        updated_at?: string;
      }>
    );

    return {
      stats,
      isLiveData: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    console.error('[DAL] getDashboardKpiStats unexpected exception:', message);
    return {
      stats: {
        totalActive: 0,
        pendingReview: 0,
        inProgress: 0,
        resolvedThisWeek: 0,
        urgentHazards: 0,
      },
      isLiveData: false,
      error: message,
    };
  }
}
