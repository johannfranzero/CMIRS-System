import type { LocationOption, LocationsDirectoryResult } from '@/types/reports';

export const LOCATIONS_DIRECTORY_ERROR_MESSAGE =
  'Unable to load campus locations. Please try again shortly.';

export function mapDirectoryLocation(location: LocationOption): LocationOption {
  return {
    id: location.id,
    building_name: location.building_name,
    floor: location.floor ?? null,
    room: location.room ?? null,
    description: location.description ?? null,
  };
}

export function createLocationsDirectoryResult(
  locations: LocationOption[] | null | undefined,
  error: unknown
): LocationsDirectoryResult {
  if (error) {
    return {
      locations: [],
      error: LOCATIONS_DIRECTORY_ERROR_MESSAGE,
    };
  }

  return {
    locations: (locations ?? []).map(mapDirectoryLocation),
    error: null,
  };
}

export function filterLocationsBySearch(
  locations: readonly LocationOption[],
  searchQuery: string
): LocationOption[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [...locations];
  }

  return locations.filter((location) =>
    [location.building_name, location.floor, location.room, location.description]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  );
}
