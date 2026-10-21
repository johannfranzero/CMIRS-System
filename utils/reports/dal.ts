import { createClient } from '@/utils/supabase/server';
import { getCurrentUserAndProfile } from '@/utils/auth/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedUser } from '@/types/auth';
import {
  ReportQueueParams,
  PaginatedReportsResult,
  DashboardKpiResult,
  PriorityLevel,
  ReportStatus,
  AnalyticsDataResult,
  CategoryOption,
  LocationOption,
  LocationsDirectoryResult,
  ReferenceCatalogResult,
  FacilityBreakdownResult,
  TechnicianOption,
  DetailedReport,
} from '@/types/reports';
import {
  RawDbReportRow,
  RawDbReportDetailRow,
  transformDbReportToMaintenanceReport,
  transformDbReportToDetailedReport,
  calculateKpiStatsFromDbReports,
  getFacilityBreakdownFromReports,
  getPhilippineWeekBounds,
  isDateInPhilippineWeek,
  isDatasetTruncated,
  buildReportsQueueUrl,
  sanitizeErrorMessage,
  describeDatabaseError,
} from './transform';
import { createLocationsDirectoryResult } from '@/utils/locations/directory';
import { getOperationalAnalyticsFromClient } from './analytics-runtime';
import {
  getActiveCategoriesFromClient as getActiveCategoriesFromClientImpl,
  getActiveLocationsFromClient as getActiveLocationsFromClientImpl,
  getActiveTechniciansFromClient as getActiveTechniciansFromClientImpl,
  getCampusFacilityBreakdownFromClient as getCampusFacilityBreakdownFromClientImpl,
} from './reference-catalogs';

export {
  ANALYTICS_MAX_REPORT_ROWS,
  SELECT_ANALYTICS_REPORTS_FIELDS,
} from './analytics-runtime';

// Re-export pure helpers for seamless application-wide consumption and testing
export {
  type RawDbReportRow,
  type RawDbReportDetailRow,
  type CategoryOption,
  type LocationOption,
  type LocationsDirectoryResult,
  type ReferenceCatalogResult,
  type FacilityBreakdownResult,
  type TechnicianOption,
  type DetailedReport,
  transformDbReportToMaintenanceReport,
  transformDbReportToDetailedReport,
  calculateKpiStatsFromDbReports,
  getFacilityBreakdownFromReports,
  getPhilippineWeekBounds,
  isDateInPhilippineWeek,
  isDatasetTruncated,
  buildReportsQueueUrl,
  sanitizeErrorMessage,
  describeDatabaseError,
};

/**
 * Verified PostgREST column selection query including foreign-key joins.
 * Matches schemas defined in `20261018000001_core_schema.sql`.
 * Uses `categories!inner` to enforce inner join semantics for category filtering.
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
  categories!inner (
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
 * Live Read Data Access Layer: Fetches paginated reports for queue and dashboard.
 *
 * Security & Authorization Guarantees:
 * - Executes under the authenticated user's session client (`createClient()`).
 * - Never uses service-role credentials.
 * - PostgreSQL RLS predicate `can_view_report()` automatically filters visible rows.
 * - Additional role-aware filter applied for `student_personnel` (`reporter_id = auth.uid()`)
 *   for optimal database indexing and defense-in-depth.
 * - Fails closed on unauthenticated or inactive accounts.
 * - Uses deterministic two-column ordering: `created_at DESC`, `id DESC`.
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

    // 3. Category filter (Finding 1 fix: supports UUID direct filter or PostgREST inner join name filter)
    if (params.category && params.category !== 'all') {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.category
      );
      if (isUuid) {
        query = query.eq('category_id', params.category);
      } else {
        query = query.eq('categories.name', params.category);
      }
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

    // 5. Order & range pagination (Finding 3 fix: deterministic sort tiebreaker with id DESC)
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
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
        error: 'Unable to retrieve maintenance reports from the database. Please try again shortly.',
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
      error: 'An unexpected system error occurred while loading reports.',
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
 * - Finding 2 fix: Explicitly verifies total count vs fetched records to prevent silent truncation.
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
      .select('id, status, is_urgent_hazard, confirmed_priority, created_at, updated_at', {
        count: 'exact',
      });

    if (user.profile.role === 'student_personnel') {
      query = query.eq('reporter_id', user.id);
    }

    const { data, count, error } = await query;

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
        error: 'Unable to calculate operational metrics from the database. Please try again shortly.',
      };
    }

    const fetchedRows = data || [];

    // Finding 2 fix: Truncation detection guard
    if (isDatasetTruncated(count, fetchedRows.length)) {
      console.error(
        `[DAL] getDashboardKpiStats: Dataset truncated. Total matching records (${count}) exceeds fetched records (${fetchedRows.length}). Refusing to compute incomplete KPI metrics.`
      );
      return {
        stats: {
          totalActive: 0,
          pendingReview: 0,
          inProgress: 0,
          resolvedThisWeek: 0,
          urgentHazards: 0,
        },
        isLiveData: true,
        error: `Operational metrics cannot be calculated accurately because total records (${count}) exceed the single-request query limit. Database aggregate function required.`,
      };
    }

    const stats = calculateKpiStatsFromDbReports(
      fetchedRows as Array<{
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
      error: 'An unexpected system error occurred while calculating operational metrics.',
    };
  }
}

export async function getOperationalAnalytics(): Promise<AnalyticsDataResult> {
  const user = await getCurrentUserAndProfile();
  const hasAnalyticsAccess =
    user?.profile?.is_active &&
    ['coordinator', 'administrator', 'management'].includes(user.profile.role);

  if (!hasAnalyticsAccess) {
    return {
      analytics: null,
      state: 'error',
      totalCount: null,
      fetchedCount: 0,
      error: 'Operational analytics are unavailable for this session.',
    };
  }

  try {
    const supabase = await createClient();
    return getOperationalAnalyticsFromClient(supabase);
  } catch {
    return {
      analytics: null,
      state: 'error',
      totalCount: null,
      fetchedCount: 0,
      error: 'Operational analytics are temporarily unavailable. Please try again shortly.',
    };
  }
}

// =============================================================================
// Reference Data Catalog Loaders (Categories, Locations, Active Technicians)
// =============================================================================


/**
 * Live Read DAL: Retrieves all active categories for report creation and filtering.
 *
 * Phase 4D: this function used to return a hardcoded `FALLBACK_CATEGORIES` fixture whenever the
 * query failed or returned zero rows. That silently presented fabricated reference data to
 * authenticated users and produced foreign-key insert failures downstream. It now fails
 * honestly: an empty list plus a sanitized error message.
 */
export async function getActiveCategories(): Promise<ReferenceCatalogResult<CategoryOption>> {
  try {
    const supabase = await createClient();
    return await getActiveCategoriesFromClient(supabase);
  } catch (err) {
    console.error('[DAL] getActiveCategories unexpected exception:', err);
    return {
      items: [],
      error: 'The maintenance category list is temporarily unavailable. Please try again shortly.',
    };
  }
}

/**
 * Client-injectable implementation of {@link getActiveCategories}.
 * Exposed so the failure behaviour can be verified without a live database.
 */
export async function getActiveCategoriesFromClient(
  client: SupabaseClient
): Promise<ReferenceCatalogResult<CategoryOption>> {
  return getActiveCategoriesFromClientImpl(client);
}

/**
 * Live Read DAL: Retrieves all active campus locations for report creation.
 *
 * Phase 4D: previously returned a hardcoded `FALLBACK_LOCATIONS` fixture on failure. It now
 * fails honestly with an empty list and a sanitized error message.
 */
export async function getActiveLocations(): Promise<ReferenceCatalogResult<LocationOption>> {
  try {
    const supabase = await createClient();
    return await getActiveLocationsFromClient(supabase);
  } catch (err) {
    console.error('[DAL] getActiveLocations unexpected exception:', err);
    return {
      items: [],
      error: 'The campus location list is temporarily unavailable. Please try again shortly.',
    };
  }
}

/**
 * Client-injectable implementation of {@link getActiveLocations}.
 */
export async function getActiveLocationsFromClient(
  client: SupabaseClient
): Promise<ReferenceCatalogResult<LocationOption>> {
  return getActiveLocationsFromClientImpl(client);
}

export async function getLocationsDirectory(): Promise<LocationsDirectoryResult> {
  const user = await getCurrentUserAndProfile();

  if (!user || !user.profile?.is_active) {
    return createLocationsDirectoryResult(null, new Error('Unauthenticated locations request'));
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('locations')
      .select('id, building_name, floor, room, description')
      .eq('is_active', true)
      .order('building_name')
      .order('floor')
      .order('room');

    return createLocationsDirectoryResult(data, error);
  } catch {
    return createLocationsDirectoryResult(null, new Error('Locations directory retrieval failed'));
  }
}

/**
 * Live Read DAL: Retrieves active technicians available for coordinator assignment.
 * Restricted to coordinator and administrator roles.
 *
 * Phase 4D: this function used to return a hardcoded `FALLBACK_TECHNICIANS` fixture (two
 * non-existent technician accounts) whenever the query failed or returned zero rows, which
 * offered coordinators assignable identities that do not exist in `public.profiles`. It now
 * fails honestly with an empty list and a sanitized error message.
 */
export async function getActiveTechnicians(): Promise<ReferenceCatalogResult<TechnicianOption>> {
  const user = await getCurrentUserAndProfile();
  if (!user || !user.profile?.is_active || (user.profile.role !== 'coordinator' && user.profile.role !== 'administrator')) {
    return { items: [], error: null };
  }

  try {
    const supabase = await createClient();
    return await getActiveTechniciansFromClient(supabase);
  } catch (err) {
    console.error('[DAL] getActiveTechnicians unexpected exception:', err);
    return {
      items: [],
      error: 'The technician directory is temporarily unavailable. Please try again shortly.',
    };
  }
}

/**
 * Client-injectable implementation of {@link getActiveTechnicians}.
 */
export async function getActiveTechniciansFromClient(
  client: SupabaseClient
): Promise<ReferenceCatalogResult<TechnicianOption>> {
  return getActiveTechniciansFromClientImpl(client);
}

/**
 * Live Read DAL: Computes the campus facility (zone) breakdown from every RLS-visible report.
 *
 * Phase 4D: the dashboard previously derived this widget from the five most recent queue rows,
 * so the displayed "Zones" count and per-building report counts described only that page of
 * results. It now aggregates over the complete RLS-visible data set and refuses to publish
 * partial numbers when the single-request row limit truncates the result.
 */
export async function getCampusFacilityBreakdown(): Promise<FacilityBreakdownResult> {
  const user = await getCurrentUserAndProfile();

  if (!user || !user.profile.is_active) {
    return { breakdown: [], error: 'Unauthenticated or inactive user session.', isTruncated: false };
  }

  try {
    const supabase = await createClient();
    return await getCampusFacilityBreakdownFromClient(supabase, user);
  } catch (err) {
    console.error('[DAL] getCampusFacilityBreakdown unexpected exception:', err);
    return {
      breakdown: [],
      error: 'The campus facility breakdown is temporarily unavailable. Please try again shortly.',
      isTruncated: false,
    };
  }
}

/**
 * Client-injectable implementation of {@link getCampusFacilityBreakdown}.
 */
export async function getCampusFacilityBreakdownFromClient(
  client: SupabaseClient,
  user: AuthenticatedUser
): Promise<FacilityBreakdownResult> {
  return getCampusFacilityBreakdownFromClientImpl(client, {
    reporterId: user.profile.role === 'student_personnel' ? user.id : null,
  });
}

// =============================================================================
// Detailed Single Report Loader (`getReportDetails`)
// =============================================================================

export const SELECT_REPORT_DETAIL_FIELDS = `
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
    started_at,
    completed_at,
    notes,
    decline_reason,
    technician_id,
    technician:profiles!technician_id (
      id,
      full_name,
      email,
      phone
    ),
    work_logs (
      id,
      assignment_id,
      description,
      hours_spent,
      created_at,
      technician_id,
      technician:profiles!technician_id (
        id,
        full_name
      )
    )
  ),
  report_status_history (
    id,
    previous_status,
    new_status,
    reason,
    created_at,
    changed_by,
    changed_by_profile:profiles!changed_by (
      id,
      full_name,
      role
    )
  ),
  verifications (
    id,
    is_satisfactory,
    notes,
    verified_at,
    verified_by,
    verifier:profiles!verified_by (
      id,
      full_name,
      role
    )
  ),
  report_attachments (
    id,
    file_name,
    file_size,
    mime_type,
    created_at,
    deleted_at,
    uploaded_by,
    uploader:profiles!uploaded_by (
      id,
      full_name
    )
  )
`;

export interface ReportDetailResult {
  report: DetailedReport | null;
  isLiveData: boolean;
  error?: string;
}

/**
 * Live Read DAL: Retrieves complete report details for `app/reports/[id]/page.tsx`.
 *
 * Security & Authorization Guarantees:
 * - Executes under the authenticated user's session client (`createClient()`).
 * - Never uses service-role credentials.
 * - Enforces can_view_report() RLS predicate and defense-in-depth scoping.
 * - Fails closed on unauthenticated or inactive accounts.
 */
export async function getReportDetails(id: string): Promise<ReportDetailResult> {
  const user = await getCurrentUserAndProfile();

  if (!user || !user.profile?.is_active) {
    return {
      report: null,
      isLiveData: false,
      error: 'Unauthenticated or inactive user session.',
    };
  }

  if (!id || typeof id !== 'string') {
    return {
      report: null,
      isLiveData: false,
      error: 'A valid report identifier is required.',
    };
  }

  try {
    const supabase = await createClient();

    let query = supabase
      .from('reports')
      .select(SELECT_REPORT_DETAIL_FIELDS)
      .eq('id', id);

    // Defense-in-depth: If student reporter, scope query to own reports
    if (user.profile.role === 'student_personnel') {
      query = query.eq('reporter_id', user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.warn('[DAL] getReportDetails query error:', error.message);
      return {
        report: null,
        isLiveData: true,
        error: 'Unable to retrieve report details from the database.',
      };
    }

    if (!data) {
      return {
        report: null,
        isLiveData: true,
        error: 'Report not found or access denied.',
      };
    }

    const report = transformDbReportToDetailedReport(data as unknown as RawDbReportDetailRow);

    // Defense-in-depth: Final role visibility verification
    if (user.profile.role === 'student_personnel' && report.reporterId && report.reporterId !== user.id) {
      return {
        report: null,
        isLiveData: true,
        error: 'Access denied: You do not have permission to view this report.',
      };
    }

    return {
      report,
      isLiveData: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    console.error('[DAL] getReportDetails exception:', message);
    return {
      report: null,
      isLiveData: false,
      error: 'An unexpected system error occurred while loading report details.',
    };
  }
}
