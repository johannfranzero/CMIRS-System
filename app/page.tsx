import React from 'react';
import Link from 'next/link';
import { requireAuth } from '@/utils/auth/server';
import { AppShell } from '@/components/layout/app-shell';
import { StatCard } from '@/components/ui/stat-card';
import { ReportList } from '@/components/dashboard/report-list';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ReportsIcon,
  ClockIcon,
  WrenchIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  BuildingIcon,
  UserIcon,
  PlusCircleIcon,
} from '@/components/ui/icons';
import {
  getDashboardKpiStats,
  getReportsQueue,
  getCampusFacilityBreakdown,
} from '@/utils/reports/dal';
import { getRoleDashboardConfig } from '@/utils/reports/dashboard-config';
import { canSubmitReport } from '@/types/auth';

export const instant = false;

export default async function DashboardPage() {
  const user = await requireAuth('/');
  const firstName = user.profile.full_name
    ? user.profile.full_name.trim().split(/\s+/)[0]
    : 'there';

  const role = user.profile.role;
  const [kpiResult, queueResult, facilityResult] = await Promise.all([
    getDashboardKpiStats(),
    getReportsQueue({ pageSize: 5 }),
    getCampusFacilityBreakdown(),
  ]);

  const stats = kpiResult.stats;
  const liveReports = queueResult.reports;
  const facilityBreakdown = facilityResult.breakdown;
  const dashboardConfig = getRoleDashboardConfig(role, firstName, stats);
  const isOversightRole = role === 'coordinator' || role === 'administrator' || role === 'management';
  const isTechnician = role === 'technician';
  const isStudent = role === 'student_personnel';

  return (
    <AppShell user={user} pageTitle="Operations Dashboard">
      <div className="flex flex-col gap-6">
        {/* Phase 4D.1: the previous "Live Backend Connected / Live RLS Active" banner was
            removed. It asserted a verified connection state that the server component cannot
            actually prove (a successful query may still return zero rows, and RLS filtering is
            enforced in the database, not reported by the client). The per-query error notice
            below surfaces the real, sanitized failure when a query does fail. */}

        {/* Database Query Warning / Notice if present (Sanitized) */}
        {(kpiResult.error || queueResult.error || facilityResult.error) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center gap-2">
            <ExclamationTriangleIcon size={16} className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Notice: {kpiResult.error || queueResult.error || facilityResult.error}
            </span>
          </div>
        )}

        {/* Dashboard Welcome Header with Role-Specific Context */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Campus Operations Dashboard
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {dashboardConfig.welcomeMessage}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Only the reporter roles may file a maintenance report (Phase 4H). The
                authorization is enforced on the server in the `submitReportAction` Server
                Action and the `/reports/new` route; this is the usability affordance. */}
            {canSubmitReport(role) && (
              <Link href="/reports/new">
                <Button
                  variant="primary"
                  leftIcon={<PlusCircleIcon className="w-4 h-4" />}
                >
                  Submit Report
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Metric KPI Cards Derived Strictly from Visible Reports.
            Phase 4D.2: when the KPI query failed the metrics are UNKNOWN, so the cards render
            an "Unavailable" state instead of a misleading 0. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title={dashboardConfig.cards[0].title}
            value={stats.totalActive}
            description={dashboardConfig.cards[0].description}
            icon={<ReportsIcon size={20} className="w-5 h-5 text-indigo-600 shrink-0" />}
            variant="default"
            unavailable={Boolean(kpiResult.error)}
          />

          <StatCard
            title={dashboardConfig.cards[1].title}
            value={stats.pendingReview}
            description={dashboardConfig.cards[1].description}
            icon={<ClockIcon size={20} className="w-5 h-5 text-amber-600 shrink-0" />}
            variant="amber"
            unavailable={Boolean(kpiResult.error)}
          />

          <StatCard
            title={dashboardConfig.cards[2].title}
            value={stats.inProgress}
            description={dashboardConfig.cards[2].description}
            icon={<WrenchIcon size={20} className="w-5 h-5 text-blue-600 shrink-0" />}
            variant="blue"
            unavailable={Boolean(kpiResult.error)}
          />

          <StatCard
            title={dashboardConfig.cards[3].title}
            value={stats.urgentHazards}
            description={dashboardConfig.cards[3].description}
            icon={<ExclamationTriangleIcon size={20} className="w-5 h-5 text-rose-600 shrink-0" />}
            variant="rose"
            urgentAlert={!kpiResult.error && stats.urgentHazards > 0}
            unavailable={Boolean(kpiResult.error)}
          />
        </div>

        {/* Main Grid: Role-Filtered Reports Queue & Side Widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Reports Table / Card List (3 Columns on Large Screens) */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  {dashboardConfig.tableTitle}
                </h3>
                <p className="text-xs sm:text-sm text-slate-500">
                  {dashboardConfig.tableDescription}
                </p>
              </div>

              <Link
                href="/reports"
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1"
              >
                <span>View Full Queue</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>

            <ReportList
              reports={liveReports}
              userRole={role}
              error={queueResult.error}
              totalCount={queueResult.totalCount}
            />

            {/* Phase 4D.2: make a truncated page visible instead of implying it is the whole set */}
            {!queueResult.error && queueResult.totalCount > liveReports.length && (
              <p className="text-xs text-slate-500">
                Showing the {liveReports.length} most recent of {queueResult.totalCount} reports
                visible to your role.{' '}
                <Link href="/reports" className="text-indigo-600 hover:text-indigo-800 font-semibold">
                  View the full queue
                </Link>
                .
              </p>
            )}
          </div>

          {/* Side Widgets (1 Column on Large Screens) */}
          <div className="flex flex-col gap-5">
            {/* Campus Facilities Breakdown (Derived strictly from visible reports) */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <BuildingIcon size={16} className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>{isStudent ? 'Reported Facilities' : 'Campus Facilities'}</span>
                  </CardTitle>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {facilityResult.error
                      ? 'Unavailable'
                      : `${facilityBreakdown.length} ${facilityBreakdown.length === 1 ? 'Zone' : 'Zones'}`}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="divide-y divide-slate-100 p-0 text-xs">
                {facilityResult.error ? (
                  <div className="p-4 text-center text-amber-700 text-xs">
                    {facilityResult.error}
                  </div>
                ) : facilityBreakdown.length > 0 ? (
                  facilityBreakdown.map((facility) => (
                    <div
                      key={facility.building}
                      className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <p className="font-semibold text-slate-800 truncate">{facility.building}</p>
                        <p className="text-slate-400 text-[11px]">Active Zone</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 shrink-0">
                        {facility.count} {facility.count === 1 ? 'report' : 'reports'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    No active reports in facilities for your account.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Role-Specific Secondary Widget: Technicians on duty for oversight/tech; Guidelines for students */}
            {isOversightRole || isTechnician ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                      <UserIcon size={16} className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>Technicians On Duty</span>
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="p-4 text-xs text-slate-500 italic">
                  Real-time technician availability is not yet implemented. View technician assignments on individual report detail pages.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <ExclamationTriangleIcon size={16} className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>Reporting Guidelines</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-2.5 text-xs text-slate-600">
                  <p>
                    <strong className="text-slate-800">Urgent Safety Hazards:</strong> Flag issues involving water leaks near electrical panels, broken emergency exits, or fire risks for immediate priority triage.
                  </p>
                  <p className="text-slate-500 pt-1 border-t border-slate-100">
                    Reports enter the coordinator triage queue as <strong className="text-slate-700">Submitted</strong>.
                    A coordinator confirms the priority before a technician is assigned. Response-time targets are not
                    measured by the system, so no turnaround estimate is shown here.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Tertiary Widget: Resolution SLA for oversight; Report Lifecycle Guide for students */}
            {isOversightRole || isTechnician ? (
              <Card className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white border-transparent">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                    <CheckCircleIcon size={16} className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Resolution SLA</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                    Automated SLA tracking is not yet implemented. Resolution history is visible in the timeline on each report detail page.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white border-transparent">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-indigo-300 text-xs font-semibold uppercase tracking-wider">
                    <CheckCircleIcon size={16} className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Report Lifecycle</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                    Submitted &rarr; Triage &amp; Priority &rarr; Technician Assigned &rarr; Verification Sign-off.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
