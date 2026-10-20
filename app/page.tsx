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
import { MOCK_REPORTS, MOCK_STATS } from '@/data/mock-reports';

export const instant = false;

export default async function DashboardPage() {
  const user = await requireAuth('/');
  const firstName = user.profile.full_name
    ? user.profile.full_name.trim().split(/\s+/)[0]
    : 'there';

  return (
    <AppShell user={user} pageTitle="Operations Dashboard">
      <div className="flex flex-col gap-6">
        {/* Mock Data Banner */}
        <div className="bg-indigo-50/80 border border-indigo-200/90 rounded-xl px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs sm:text-sm">
          <div className="flex items-center gap-2.5 text-indigo-900">
            <span className="w-2 h-2 rounded-full bg-indigo-600 shrink-0" />
            <p>
              <strong className="font-semibold">Phase 1 UI Foundation:</strong> Displaying realistic mock records. No live database connection or active Supabase session.
            </p>
          </div>
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white text-indigo-700 border border-indigo-200 shrink-0">
            Development Preview
          </span>
        </div>

        {/* Dashboard Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Campus Operations Dashboard
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Welcome back, {firstName}. 2 urgent safety hazards require coordinator review.
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

        {/* Metric KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Active"
            value={MOCK_STATS.totalActive}
            description="Across 5 campus buildings"
            icon={<ReportsIcon size={20} className="w-5 h-5 text-indigo-600 shrink-0" />}
            variant="default"
          />

          <StatCard
            title="Pending Triage"
            value={MOCK_STATS.pendingReview}
            description="Awaiting coordinator review"
            icon={<ClockIcon size={20} className="w-5 h-5 text-amber-600 shrink-0" />}
            variant="amber"
          />

          <StatCard
            title="In Progress"
            value={MOCK_STATS.inProgress}
            description="Assigned to field technicians"
            icon={<WrenchIcon size={20} className="w-5 h-5 text-blue-600 shrink-0" />}
            variant="blue"
          />

          <StatCard
            title="Critical Hazards"
            value={MOCK_STATS.urgentHazards}
            description="Immediate safety risk flagged"
            icon={<ExclamationTriangleIcon size={20} className="w-5 h-5 text-rose-600 shrink-0" />}
            variant="rose"
            urgentAlert={true}
          />
        </div>

        {/* Main Grid: Reports Queue & Sidebar Widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Reports Table / Card List (3 Columns on Large Screens) */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  Recent Incident & Maintenance Reports
                </h3>
                <p className="text-xs sm:text-sm text-slate-500">
                  Filter, search, and monitor report lifecycle status across all campus zones.
                </p>
              </div>
            </div>

            <ReportList reports={MOCK_REPORTS} />
          </div>

          {/* Side Widgets (1 Column on Large Screens) */}
          <div className="flex flex-col gap-5">
            {/* Campus Facilities Status Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <BuildingIcon size={16} className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span>Campus Facilities</span>
                  </CardTitle>
                  <span className="text-[11px] font-semibold text-slate-400">
                    4 Active Zones
                  </span>
                </div>
              </CardHeader>
              <CardContent className="divide-y divide-slate-100 p-0 text-xs">
                <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-800">Main Academic Bldg</p>
                    <p className="text-slate-400">Floors 1 & 2 • Lecture Halls</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700">
                    3 reports
                  </span>
                </div>

                <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-800">Administration Wing</p>
                    <p className="text-slate-400">Floor 1 • Executive Suite</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700">
                    2 reports
                  </span>
                </div>

                <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-800">University Library</p>
                    <p className="text-slate-400">Floor 1 • Reading Area</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-rose-50 text-rose-700">
                    2 reports
                  </span>
                </div>

                <div className="px-4 py-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                  <div>
                    <p className="font-semibold text-slate-800">Student Union</p>
                    <p className="text-slate-400">Ground • Cafeteria & Dining</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700">
                    1 report
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Technicians on Duty Widget */}
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

            {/* Resolved This Week Snapshot */}
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
          </div>
        </div>
      </div>
    </AppShell>
  );
}
