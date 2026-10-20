'use client';

import { useMemo, useState } from 'react';
import type { LocationOption } from '@/types/reports';
import { filterLocationsBySearch } from '@/utils/locations/directory';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { LocationsIcon, SearchIcon } from '@/components/ui/icons';

interface LocationsDirectoryProps {
  locations: LocationOption[];
}

function LocationDetails({ location }: { location: LocationOption }) {
  const details = [
    location.floor ? ['Floor', location.floor] : null,
    location.room ? ['Room', location.room] : null,
  ].filter((detail): detail is [string, string] => Boolean(detail));

  return (
    <>
      {details.length > 0 && (
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="mt-0.5 font-medium text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {location.description && (
        <p className="mt-4 border-t border-slate-100 pt-4 text-sm leading-relaxed text-slate-600">
          {location.description}
        </p>
      )}
    </>
  );
}

export function LocationsDirectory({ locations }: LocationsDirectoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredLocations = useMemo(
    () => filterLocationsBySearch(locations, searchQuery),
    [locations, searchQuery]
  );
  const hasSearchQuery = searchQuery.trim().length > 0;
  const resultsMessage = hasSearchQuery
    ? `${filteredLocations.length} location${filteredLocations.length === 1 ? '' : 's'} found`
    : `${locations.length} active location${locations.length === 1 ? '' : 's'} available`;

  if (locations.length === 0) {
    return (
      <EmptyState
        title="No active locations available"
        description="There are currently no active campus locations available in the directory."
        icon={<LocationsIcon className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="location-search" className="mb-2 block text-sm font-medium text-slate-700">
          Search locations
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            id="location-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search building, floor, room, or description"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-24 text-sm text-slate-900 shadow-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            aria-describedby="location-search-results"
          />
          {hasSearchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
            >
              Clear
            </Button>
          )}
        </div>
        <p id="location-search-results" className="mt-2 text-sm text-slate-500" aria-live="polite">
          {resultsMessage}
        </p>
      </div>

      {filteredLocations.length === 0 ? (
        <EmptyState
          title="No locations match your search"
          description="Try a different building name, floor, room, or description."
          icon={<SearchIcon className="h-6 w-6" />}
          actionLabel="Clear search"
          onAction={() => setSearchQuery('')}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredLocations.map((location) => (
            <Card key={location.id} className="h-full">
              <CardContent className="h-full">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
                    <LocationsIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900">{location.building_name}</h2>
                    {location.floor || location.room ? (
                      <p className="mt-1 text-sm text-slate-500">
                        {[location.floor && `Floor ${location.floor}`, location.room && `Room ${location.room}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">Campus facility</p>
                    )}
                  </div>
                </div>
                <LocationDetails location={location} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
