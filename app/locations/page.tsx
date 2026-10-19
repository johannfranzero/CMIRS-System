import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LocationsIcon } from '@/components/ui/icons';

export default function LocationsPage() {
  return (
    <AppShell pageTitle="Campus Locations & Facilities">
      <div className="max-w-3xl mx-auto py-8">
        <Card className="text-center p-8 sm:p-12 border-dashed">
          <CardContent className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-4 shadow-xs">
              <LocationsIcon className="w-8 h-8" />
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
              Phase 2 Route Placeholder
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Campus Facilities Directory
            </h2>

            <p className="mt-2 text-sm text-slate-500 max-w-lg leading-relaxed">
              This module will manage campus buildings, zones, floors, and classrooms (Main Academic Building, University Library, Administration Wing, Student Union, and science labs), enabling precise geolocation of maintenance issues.
            </p>

            <div className="mt-6">
              <Link href="/">
                <Button variant="primary">Return to Operations Dashboard</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
