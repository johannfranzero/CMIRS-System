import type { AnalyticsDataResult } from '../../types/reports';
import {
  calculateOperationalAnalytics,
  isAnalyticsDatasetComplete,
  type RawAnalyticsReport,
} from './transform.ts';

export const ANALYTICS_MAX_REPORT_ROWS = 1000;

export const SELECT_ANALYTICS_REPORTS_FIELDS = `
  id,
  status,
  confirmed_priority,
  is_urgent_hazard,
  categories (
    name
  ),
  locations (
    building_name
  ),
  assignments (
    technician_id,
    status,
    technician:profiles!technician_id (
      full_name
    )
  )
`;

interface AnalyticsQueryResult {
  data: RawAnalyticsReport[] | null;
  count?: number | null;
  error: unknown;
}

interface AnalyticsReportsQuery {
  select(
    columns: string,
    options: { count: 'exact' }
  ): {
    order(column: string): {
      range(from: number, to: number): Promise<AnalyticsQueryResult>;
    };
  };
}

export interface AnalyticsReadSupabaseClient {
  from(table: 'reports'): unknown;
}

export async function getOperationalAnalyticsFromClient(
  supabase: AnalyticsReadSupabaseClient
): Promise<AnalyticsDataResult> {
  try {
    const reportsQuery = supabase.from('reports') as AnalyticsReportsQuery;
    const { data, count, error } = await reportsQuery
      .select(SELECT_ANALYTICS_REPORTS_FIELDS, { count: 'exact' })
      .order('id')
      .range(0, ANALYTICS_MAX_REPORT_ROWS - 1);

    if (error) {
      return {
        analytics: null,
        state: 'error',
        totalCount: null,
        fetchedCount: 0,
        error: 'Operational analytics are temporarily unavailable. Please try again shortly.',
      };
    }

    const reports = data ?? [];

    if (!isAnalyticsDatasetComplete(count, reports.length)) {
      return {
        analytics: null,
        state: 'incomplete',
        totalCount: count ?? null,
        fetchedCount: reports.length,
        error:
          'Operational analytics cannot be shown because the complete RLS-visible report set was not retrieved.',
      };
    }

    return {
      analytics: calculateOperationalAnalytics(reports),
      state: 'ready',
      totalCount: count ?? null,
      fetchedCount: reports.length,
    };
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
