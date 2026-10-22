import { redirect } from 'next/navigation';
import { requireAuth } from '@/utils/auth/server';
import { canSubmitReport } from '@/types/auth';
import { AppShell } from '@/components/layout/app-shell';
import { getActiveCategories, getActiveLocations } from '@/utils/reports/dal';
import { ReportSubmissionForm } from '@/components/reports/report-submission-form';

export const instant = false;

export default async function NewReportPage() {
  const user = await requireAuth('/reports/new');

  // Role authorization for the submission operation, enforced on the server.
  // Only the reporter roles may file a maintenance report; the navigation hides the entry
  // point for the others, but this check is the actual authorization.
  if (!canSubmitReport(user.profile.role)) {
    redirect('/unauthorized');
  }

  // Load active reference catalogs through authenticated DAL.
  // Phase 4D: a failed catalog query now surfaces an honest unavailable state instead of
  // silently substituting fabricated categories or locations.
  const [categoriesResult, locationsResult] = await Promise.all([
    getActiveCategories(),
    getActiveLocations(),
  ]);

  return (
    <AppShell user={user} pageTitle="Submit Maintenance Report">
      <div className="py-2">
        <ReportSubmissionForm
          categories={categoriesResult.items}
          locations={locationsResult.items}
          userRole={user.profile.role}
          categoriesError={categoriesResult.error}
          locationsError={locationsResult.error}
        />
      </div>
    </AppShell>
  );
}

