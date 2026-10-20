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
  getFacilityBreakdownFromReports,
} from '@/utils/reports/dal';
import { getRoleDashboardConfig } from '@/utils/reports/mock-filter';
import { formatRoleLabel } from '@/utils/auth/validation';

export const instant = false;

export default async function DashboardPage() {
  const user = await requireAuth('/');
  const firstName = user.profile.full_name
    ? user.profile.full_name.trim().split(/\s+/)[0]
    : 'there';

  const role = user.profile.role;
  const [kpiResult, queueResult] = await Promise.all([
    getDashboardKpiStats(),
    getReportsQueue({ pageSize: 5 }),
  ]);

  const stats = kpiResult.stats;
  const liveReports = queueResult.reports;
  const facilityBreakdown = getFacilityBreakdownFromReports(liveReports);
  const dashboardConfig = getRoleDashboardConfig(role, firstName, stats);
  const isOversightRole = role === 'coordinator' || role === 'administrator' || role === 'management';
  const isTechnician = role === 'technician';
  const isStudent = role === 'student_personnel';

  return (
    <AppShell user={user} pageTitle="Operations Dashboard">
      <div className="flex flex-col gap-6">
        {/* Live Data Connection Banner with Active Role Perspective */}
        <div className="bg-emerald-50/80 border border-emerald-200/90 rounded-xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2.5 text-emerald-950">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse shrink-0" />
            <p>
              <strong className="font-semibold text-emerald-900">Live Backend Connected:</strong> Serving records from Supabase Cloud. PostgreSQL Row Level Security actively enforces your role scope.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Perspective: {formatRoleLabel(role)}
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white text-emerald-700 border border-emerald-200">
              Live RLS Active
            </span>
          </div>
        </div>

        {/* Database Query Warning / Notice if present */}
        {kpiResult.error && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center gap-2">
            <ExclamationTriangleIcon size={16} className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Database Notice: {kpiResult.error}</span>
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
            <Link href="/reports/new">
              <Button
                variant="primary"
                leftIcon={<PlusCircleIcon className="w-4 h-4" />}
              >
                Submit Report
              </Button>
            </Link>
          </div>
        </div>

        {/* Metric KPI Cards Derived Strictly from Visible Reports */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title={dashboardConfig.cards[0].title}
            value={stats.totalActive}
            description={dashboardConfig.cards[0].description}
            icon={<ReportsIcon size={20} className="w-5 h-5 text-indigo-600 shrink-0" />}
            variant="default"
          />

          <StatCard
            title={dashboardConfig.cards[1].title}
            value={stats.pendingReview}
            description={dashboardConfig.cards[1].description}
            icon={<ClockIcon size={20} className="w-5 h-5 text-amber-600 shrink-0" />}
            variant="amber"
          />

          <StatCard
            title={dashboardConfig.cards[2].title}
            value={stats.inProgress}
            description={dashboardConfig.cards[2].description}
            icon={<WrenchIcon size={20} className="w-5 h-5 text-blue-600 shrink-0" />}
            variant="blue"
          />

          <StatCard
            title={dashboardConfig.cards[3].title}
            value={stats.urgentHazards}
            description={dashboardConfig.cards[3].description}
            icon={<ExclamationTriangleIcon size={20} className="w-5 h-5 text-rose-600 shrink-0" />}
            variant="rose"
            urgentAlert={stats.urgentHazards > 0}
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

            <ReportList reports={liveReports} userRole={role} />
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
                    {facilityBreakdown.length} {facilityBreakdown.length === 1 ? 'Zone' : 'Zones'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="divide-y divide-slate-100 p-0 text-xs">
                {facilityBreakdown.length > 0 ? (
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
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                </CardHeader>
                <CardContent className="divide-y divide-slate-100 p-0 text-xs">
                  <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                        AM
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">Alex Morgan</p>
                        <p className="text-slate-400">Plumbing & Electrical</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                      2 tasks
                    </span>
                  </div>

                  <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                        ER
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">Elena Rostova</p>
                        <p className="text-slate-400">HVAC Specialist</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                      1 task
                    </span>
                  </div>

                  <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                        MB
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">Marco Bellini</p>
                        <p className="text-slate-400">General Maintenance</p>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                      Available
                    </span>
                  </div>
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
                    Coordinator assessment typically occurs within 2 hours of report submission during campus operating hours.
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
                  <div className="mt-2 text-2xl font-bold">
                    94.2% On-Time
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    15 repairs successfully verified and closed out this week within policy SLA windows.
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
                    Submitted &rarr; Triage & Priority &rarr; Technician Assigned &rarr; Verification Sign-off.
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
