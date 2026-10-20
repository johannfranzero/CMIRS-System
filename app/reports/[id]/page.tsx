import React from 'react';
import Link from 'next/link';
import { requireAuth } from '@/utils/auth/server';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, PriorityBadge } from '@/components/ui/badge';
import {
  BuildingIcon,
  UserIcon,
  ClockIcon,
  ChevronLeftIcon,
  ExclamationTriangleIcon,
} from '@/components/ui/icons';
import { getReportDetails, getActiveTechnicians } from '@/utils/reports/dal';
import { ReportActionPanel } from '@/components/reports/report-action-panel';
import { ReportTimeline } from '@/components/reports/report-timeline';

export const instant = false;

interface ReportDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportDetailPage({ params }: ReportDetailPageProps) {
  const { id } = await params;
  const user = await requireAuth(`/reports/${id}`);

  // Fetch complete report record through authenticated DAL
  const detailResult = await getReportDetails(id);
  const report = detailResult.report;

  // If coordinator or admin, load active technicians for assignment controls
  let availableTechnicians: Array<{ id: string; full_name: string; email: string }> = [];
  if (user.profile.role === 'coordinator' || user.profile.role === 'administrator') {
    availableTechnicians = await getActiveTechnicians();
  }

  // Handle report not found or access denied
  if (!report) {
    return (
      <AppShell user={user} pageTitle="Report Details">
        <div className="max-w-2xl mx-auto py-12">
          <Card className="text-center p-8 sm:p-12 border-dashed border-slate-300">
            <CardContent className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-4 shadow-xs">
                <ExclamationTriangleIcon size={32} className="w-8 h-8" />
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Report Not Found
              </h2>

              <p className="mt-2 text-sm text-slate-500 max-w-md leading-relaxed">
                {detailResult.error ||
                  'The requested report could not be found, or your institutional account credentials do not permit viewing this record.'}
              </p>

              <div className="mt-6 flex items-center gap-3">
                <Link href="/reports">
                  <Button variant="primary">Return to Reports Queue</Button>
                </Link>
                <Link href="/">
                  <Button variant="outline">Dashboard</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const activeAssignment = report.assignmentsList.find(
    (a) => a.status === 'assigned' || a.status === 'in_progress' || a.status === 'on_hold'
  );

  return (
    <AppShell user={user} pageTitle={`Report ${report.trackingNumber}`}>
      <div className="flex flex-col gap-6">
        {/* Navigation Breadcrumb & Header Bar */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Link
              href="/reports"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-indigo-600 transition-colors"
            >
              <ChevronLeftIcon size={16} className="w-4 h-4" />
              Back to Reports Queue
            </Link>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-2xs">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-lg">
                  {report.trackingNumber}
                </span>
                <StatusBadge status={report.status} />
                <PriorityBadge
                  priority={report.priority}
                  isUrgentHazard={report.isUrgentHazard}
                />
              </div>

              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight leading-snug">
                {report.title}
              </h1>

              <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <ClockIcon size={14} className="w-3.5 h-3.5 text-slate-400" />
                  Submitted: <strong className="font-medium text-slate-700">{formatDate(report.createdAt)}</strong>
                </span>
                <span>•</span>
                <span>
                  Category: <strong className="font-medium text-slate-700">{report.category}</strong>
                </span>
                <span>•</span>
                <span>
                  Updated: <strong className="font-medium text-slate-700">{formatDate(report.updatedAt)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Urgent Safety Hazard Prominent Alert */}
        {report.isUrgentHazard && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-amber-50 border border-amber-300 flex items-start gap-3 text-amber-950 text-sm"
          >
            <ExclamationTriangleIcon size={22} className="w-5.5 h-5.5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-950">Urgent Safety Hazard Flagged</p>
              <p className="text-xs text-amber-900 mt-0.5 leading-relaxed">
                The reporter flagged this issue as an immediate safety hazard. Coordinators and technicians must observe appropriate safety precautions when conducting on-site assessment and repairs.
              </p>
            </div>
          </div>
        )}

        {/* 2-Column Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main Column (2/3 width on large screens) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* 1. Problem Description Card */}
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="bg-slate-50/60 border-b border-slate-200/80 px-6 py-4">
                <CardTitle className="text-sm font-bold text-slate-900">
                  Incident Description & Findings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                  {report.description}
                </p>
              </CardContent>
            </Card>

            {/* 2. Campus Location Details Card */}
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="bg-slate-50/60 border-b border-slate-200/80 px-6 py-4">
                <div className="flex items-center gap-2">
                  <BuildingIcon size={18} className="w-4.5 h-4.5 text-slate-500" />
                  <CardTitle className="text-sm font-bold text-slate-900">
                    Location & Facility Information
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-slate-500 block">Campus Building</span>
                    <strong className="text-slate-900 font-semibold text-sm mt-0.5 block">
                      {report.location.building}
                    </strong>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-slate-500 block">Floor</span>
                    <strong className="text-slate-900 font-semibold text-sm mt-0.5 block">
                      Floor {report.location.floor}
                    </strong>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-slate-500 block">Room / Specific Area</span>
                    <strong className="text-slate-900 font-semibold text-sm mt-0.5 block">
                      {report.location.room
                        ? `Room ${report.location.room}`
                        : report.location.specificArea || 'General Area'}
                    </strong>
                  </div>
                </div>

                {report.location.specificArea && (
                  <p className="mt-3 text-xs text-slate-600 bg-slate-50/70 p-3 rounded-lg border border-slate-100">
                    <strong className="font-semibold text-slate-800">Area Description:</strong> {report.location.specificArea}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* 3. Lifecycle Timeline & Activities */}
            <ReportTimeline report={report} />
          </div>

          {/* Sidebar Column (1/3 width on large screens) */}
          <div className="flex flex-col gap-6">
            {/* 1. Operational Action Panel (Interactive Client Controls) */}
            <ReportActionPanel
              report={report}
              user={user}
              availableTechnicians={availableTechnicians}
            />

            {/* 2. Reporter Profile Card */}
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="bg-slate-50/60 border-b border-slate-200/80 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <UserIcon size={16} className="w-4 h-4 text-slate-500" />
                  <CardTitle className="text-xs font-bold text-slate-900">
                    Reporter Information
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-5 text-xs flex flex-col gap-2">
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">Name:</span>
                  <strong className="font-semibold text-slate-900">{report.reporterName}</strong>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100">
                  <span className="text-slate-500">Role:</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                    {report.reporterRole.replace('_', ' ')}
                  </span>
                </div>
                {report.reporterEmail && (
                  <div className="flex justify-between items-center py-1">
                    <span className="text-slate-500">Email:</span>
                    <span className="font-mono text-slate-700 truncate max-w-[170px]">{report.reporterEmail}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 3. Technician Assignment Status Card */}
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="bg-slate-50/60 border-b border-slate-200/80 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <UserIcon size={16} className="w-4 h-4 text-slate-500" />
                  <CardTitle className="text-xs font-bold text-slate-900">
                    Technician Assignment
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-5 text-xs flex flex-col gap-2.5">
                {activeAssignment ? (
                  <>
                    <div className="flex justify-between items-center py-1 border-b border-slate-100">
                      <span className="text-slate-500">Technician:</span>
                      <strong className="font-semibold text-slate-900">{activeAssignment.technicianName}</strong>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-100">
                      <span className="text-slate-500">Status:</span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase">
                        {activeAssignment.status}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-100">
                      <span className="text-slate-500">Assigned:</span>
                      <span className="text-slate-700">{formatDate(activeAssignment.assignedAt)}</span>
                    </div>
                    {activeAssignment.notes && (
                      <div className="mt-1 p-2 rounded-lg bg-slate-50 border border-slate-100 text-slate-700">
                        <span className="font-semibold block text-slate-800">Dispatch Notes:</span>
                        &quot;{activeAssignment.notes}&quot;
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4 text-slate-400 italic">
                    No active technician assigned to this report yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
