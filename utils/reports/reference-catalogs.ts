/**
 * CMIRS — Reference Catalog Runtime (Client-Injectable)
 *
 * Phase 4D: these helpers contain the actual reference-catalog queries used by the dashboard,
 * the report submission form, and the coordinator assignment controls.
 *
 * They deliberately use only relative imports (no path aliases) so the module can be imported
 * directly by the Node test runner, exactly like `utils/reports/analytics-runtime.ts`.
 *
 * Failure policy: a failed or empty query NEVER returns demo fixtures. It returns an empty
 * item list together with a sanitized, user-facing error message so the UI can render an
 * honest unavailable state instead of fabricated categories, locations, or technicians.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CategoryOption,
  LocationOption,
  TechnicianOption,
  FacilityBreakdownResult,
} from '../../types/reports';
import { describeDatabaseError, isDatasetTruncated } from './transform.ts';

export const CATEGORY_CATALOG_ERROR_MESSAGE =
  'The maintenance category list is temporarily unavailable. Please try again shortly.';
export const LOCATION_CATALOG_ERROR_MESSAGE =
  'The campus location list is temporarily unavailable. Please try again shortly.';
export const TECHNICIAN_DIRECTORY_ERROR_MESSAGE =
  'The technician directory is temporarily unavailable. Please try again shortly.';
export const FACILITY_BREAKDOWN_ERROR_MESSAGE =
  'The campus facility breakdown is temporarily unavailable. Please try again shortly.';

/**
 * Loads every active category.
 */
export async function getActiveCategoriesFromClient(
  client: SupabaseClient
): Promise<{ items: CategoryOption[]; error: string | null }> {
  const { data, error } = await client
    .from('categories')
    .select('id, name, description')
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('[DAL] getActiveCategories query error:', error.message);
    return {
      items: [],
      error: describeDatabaseError(error) ?? CATEGORY_CATALOG_ERROR_MESSAGE,
    };
  }

  return { items: (data ?? []) as CategoryOption[], error: null };
}

/**
 * Loads every active campus location.
 */
export async function getActiveLocationsFromClient(
  client: SupabaseClient
): Promise<{ items: LocationOption[]; error: string | null }> {
  const { data, error } = await client
    .from('locations')
    .select('id, building_name, floor, room, description')
    .eq('is_active', true)
    .order('building_name')
    .order('floor')
    .order('room');

  if (error) {
    console.error('[DAL] getActiveLocations query error:', error.message);
    return {
      items: [],
      error: describeDatabaseError(error) ?? LOCATION_CATALOG_ERROR_MESSAGE,
    };
  }

  return { items: (data ?? []) as LocationOption[], error: null };
}

/**
 * Loads every active technician account.
 */
export async function getActiveTechniciansFromClient(
  client: SupabaseClient
): Promise<{ items: TechnicianOption[]; error: string | null }> {
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'technician')
    .eq('is_active', true)
    .order('full_name');

  if (error) {
    console.error('[DAL] getActiveTechnicians query error:', error.message);
    return {
      items: [],
      error: describeDatabaseError(error) ?? TECHNICIAN_DIRECTORY_ERROR_MESSAGE,
    };
  }

  return { items: (data ?? []) as TechnicianOption[], error: null };
}

/**
 * Aggregates the campus facility (zone) breakdown over every RLS-visible active report.
 *
 * Phase 4D: the dashboard previously derived this widget from the five most recent queue rows.
 * The counts therefore described only one page of results. This helper aggregates over the
 * complete visible data set and refuses to publish partial numbers when the single-request row
 * limit truncates the result.
 */
export async function getCampusFacilityBreakdownFromClient(
  client: SupabaseClient,
  options: { reporterId?: string | null } = {}
): Promise<FacilityBreakdownResult> {
  let query = client
    .from('reports')
    .select('id, status, locations (building_name)', { count: 'exact' });

  if (options.reporterId) {
    query = query.eq('reporter_id', options.reporterId);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error('[DAL] getCampusFacilityBreakdown query error:', error.message);
    return {
      breakdown: [],
      error: describeDatabaseError(error) ?? FACILITY_BREAKDOWN_ERROR_MESSAGE,
      isTruncated: false,
    };
  }

  const fetchedRows = (data || []) as Array<{
    id: string;
    status?: string | null;
    locations?: { building_name?: string | null } | Array<{ building_name?: string | null }> | null;
  }>;

  if (isDatasetTruncated(count, fetchedRows.length)) {
    console.error(
      `[DAL] getCampusFacilityBreakdown: Dataset truncated. Total matching records (${count}) exceeds fetched records (${fetchedRows.length}). Refusing to publish an incomplete facility breakdown.`
    );
    return {
      breakdown: [],
      error:
        'The campus facility breakdown cannot be calculated accurately because the visible report count exceeds the single-request query limit.',
      isTruncated: true,
    };
  }

  const activeRows = fetchedRows.filter(
    (row) => row.status !== 'verified' && row.status !== 'cancelled'
  );

  const countsByBuilding = new Map<string, number>();
  for (const row of activeRows) {
    const relation = Array.isArray(row.locations) ? row.locations[0] : row.locations;
    const building = relation?.building_name?.trim() || 'Unspecified Facility';
    countsByBuilding.set(building, (countsByBuilding.get(building) ?? 0) + 1);
  }

  const breakdown = Array.from(countsByBuilding.entries())
    .map(([building, count]) => ({ building, count }))
    .sort((left, right) => right.count - left.count || left.building.localeCompare(right.building));

  return { breakdown, error: null, isTruncated: false };
}
