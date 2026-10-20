import { requireRole } from '@/utils/auth/server';
import { getOperationalAnalytics } from '@/utils/reports/dal';
import { AppShell } from '@/components/layout/app-shell';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AnalyticsIcon, ExclamationTriangleIcon } from '@/components/ui/icons';

export const instant = false;

export default async function AnalyticsPage() {
  const user = await requireRole(['coordinator', 'administrator', 'management'], '/analytics');
  const result = await getOperationalAnalytics();

  return (
    <AppShell user={user} pageTitle="Operational Analytics">
      <div className="mx-auto max-w-7xl py-6 sm:py-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
              <AnalyticsIcon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Operational Analytics
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-slate-600 sm:text-base">
                Report and workload metrics for the records visible to your authenticated role.
              </p>
            </div>
          </div>
          <Badge variant="info" className="w-fit">RLS-visible reporting scope</Badge>
        </header>

        {result.state === 'ready' && result.analytics ? (
          <AnalyticsDashboard analytics={result.analytics} />
        ) : (
          <Card
            role="alert"
            className={
              result.state === 'incomplete'
                ? 'border-amber-200 bg-amber-50'
                : 'border-rose-200 bg-rose-50'
            }
          >
            <CardContent className="flex items-start gap-3">
              <ExclamationTriangleIcon
                className={
                  result.state === 'incomplete'
                    ? 'mt-0.5 h-5 w-5 shrink-0 text-amber-700'
                    : 'mt-0.5 h-5 w-5 shrink-0 text-rose-700'
                }
              />
              <div>
                <h2 className="font-semibold text-slate-900">
                  {result.state === 'incomplete'
                    ? 'Analytics are incomplete'
                    : 'Analytics are temporarily unavailable'}
                </h2>
                <p className="mt-1 text-sm text-slate-700">{result.error}</p>
                {result.state === 'incomplete' && (
                  <p className="mt-2 text-sm text-slate-600">
                    Retrieved {result.fetchedCount} of {result.totalCount ?? 'an unknown number of'} visible reports. No partial totals are displayed.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
