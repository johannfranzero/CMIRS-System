import { requireAuth } from '@/utils/auth/server';
import { getLocationsDirectory } from '@/utils/reports/dal';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { LocationsIcon } from '@/components/ui/icons';
import { LocationsDirectory } from '@/components/locations/locations-directory';

export const instant = false;

export default async function LocationsPage() {
  const user = await requireAuth('/locations');
  const directory = await getLocationsDirectory();

  return (
    <AppShell user={user} pageTitle="Campus Locations & Facilities">
      <div className="mx-auto max-w-6xl py-6 sm:py-8">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <LocationsIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Campus Locations Directory
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 sm:text-base">
                Find active campus facilities by building, floor, room, or description.
              </p>
            </div>
          </div>
        </header>

        {directory.error ? (
          <Card role="alert" className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-start gap-3">
              <LocationsIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="font-semibold text-amber-950">Locations are temporarily unavailable</h2>
                <p className="mt-1 text-sm text-amber-900">{directory.error}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <LocationsDirectory locations={directory.locations} />
        )}
      </div>
    </AppShell>
  );
}
