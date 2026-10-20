import type {
  AnalyticsDistributionItem,
  OperationalAnalytics,
  TechnicianWorkloadItem,
} from '@/types/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/stat-card';
import {
  AnalyticsIcon,
  ExclamationTriangleIcon,
  ReportsIcon,
  WrenchIcon,
} from '@/components/ui/icons';

function DistributionTable({
  title,
  items,
  totalReports,
}: {
  title: string;
  items: readonly AnalyticsDistributionItem[];
  totalReports: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title} across RLS-visible reports</caption>
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="pb-2 font-medium">Category</th>
                <th scope="col" className="pb-2 text-right font-medium">Reports</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const percentage = totalReports > 0 ? (item.count / totalReports) * 100 : 0;

                return (
                  <tr key={item.label} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="max-w-52 py-3 pr-4 font-medium text-slate-700">
                      <span className="block truncate" title={item.label}>{item.label}</span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-indigo-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </span>
                    </th>
                    <td className="py-3 text-right font-semibold tabular-nums text-slate-900">{item.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkloadTable({ workload }: { workload: readonly TechnicianWorkloadItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Assignment Workload</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {workload.length === 0 ? (
          <EmptyState
            title="No active assignments"
            description="There are no assigned, in-progress, or on-hold assignments in the retrieved report set."
            icon={<WrenchIcon className="h-6 w-6" />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Current active assignments by technician</caption>
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Technician</th>
                  <th scope="col" className="pb-2 text-right font-medium">Active assignments</th>
                </tr>
              </thead>
              <tbody>
                {workload.map((item) => (
                  <tr key={item.technicianId} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="py-3 font-medium text-slate-700">{item.technicianName}</th>
                    <td className="py-3 text-right font-semibold tabular-nums text-slate-900">
                      {item.activeAssignments}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AnalyticsDashboard({ analytics }: { analytics: OperationalAnalytics }) {
  if (analytics.totalReports === 0) {
    return (
      <EmptyState
        title="No visible reports to analyze"
        description="No reports are currently visible to your authenticated role. Metrics will appear when RLS-visible reports are available."
        icon={<AnalyticsIcon className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Visible Reports"
          value={analytics.totalReports}
          description="Complete RLS-visible report set"
          icon={<ReportsIcon className="h-5 w-5" />}
        />
        <StatCard
          title="Urgent Hazards"
          value={analytics.urgentHazardReports}
          description="Reporter-marked urgent hazards"
          icon={<ExclamationTriangleIcon className="h-5 w-5" />}
          variant="rose"
          urgentAlert={analytics.urgentHazardReports > 0}
        />
        <StatCard
          title="Active Assignments"
          value={analytics.activeAssignments}
          description="Assigned, in progress, or on hold"
          icon={<WrenchIcon className="h-5 w-5" />}
          variant="blue"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DistributionTable
          title="Reports by Status"
          items={analytics.statusDistribution}
          totalReports={analytics.totalReports}
        />
        <DistributionTable
          title="Reports by Confirmed Priority"
          items={analytics.priorityDistribution}
          totalReports={analytics.totalReports}
        />
        <DistributionTable
          title="Reports by Category"
          items={analytics.categoryDistribution}
          totalReports={analytics.totalReports}
        />
        <DistributionTable
          title="Reports by Location"
          items={analytics.locationDistribution}
          totalReports={analytics.totalReports}
        />
      </div>

      <WorkloadTable workload={analytics.technicianWorkload} />
    </div>
  );
}
