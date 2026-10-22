import React from 'react';
import Link from 'next/link';
import { requireAuth } from '@/utils/auth/server';
import { AppShell } from '@/components/layout/app-shell';
import { ReportList } from '@/components/dashboard/report-list';
import { Button } from '@/components/ui/button';
import {
  PlusCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from '@/components/ui/icons';
import { getReportsQueue, buildReportsQueueUrl } from '@/utils/reports/dal';
import { ReportStatus } from '@/types/reports';

export const instant = false;

interface ReportsPageProps {
  searchParams?: Promise<{
    page?: string;
    status?: string;
    category?: string;
    search?: string;
  }>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const user = await requireAuth('/reports');
  const role = user.profile.role;

  // Resolve searchParams asynchronously for Next.js 16
  const params = searchParams ? await searchParams : {};
  const currentPage = params.page ? Math.max(1, parseInt(params.page, 10) || 1) : 1;
  const statusFilter: ReportStatus | 'all' =
    params.status && params.status !== 'all' ? (params.status as ReportStatus) : 'all';
  const categoryFilter = params.category || 'all';
  const searchQuery = params.search || '';

  // Execute live read query through authenticated DAL
  const queueResult = await getReportsQueue({
    page: currentPage,
    pageSize: 15,
    status: statusFilter,
    category: categoryFilter,
    search: searchQuery,
  });

  const isStudent = role === 'student_personnel';
  const isTechnician = role === 'technician';

  const roleDescription = isStudent
    ? 'View and track all maintenance requests and incident reports submitted by your account.'
    : isTechnician
    ? 'Maintenance service queue for assigned work orders and repair dispatches.'
    : 'Campus-wide incident and maintenance report management queue.';

  const prevPageUrl = buildReportsQueueUrl({
    page: queueResult.currentPage - 1,
    status: statusFilter,
    category: categoryFilter,
    search: searchQuery,
  });

  const nextPageUrl = buildReportsQueueUrl({
    page: queueResult.currentPage + 1,
    status: statusFilter,
    category: categoryFilter,
    search: searchQuery,
  });

  return (
    <AppShell user={user} pageTitle="Maintenance Reports Queue">
      <div className="flex flex-col gap-6">
        {/* Phase 4D.1: the identical "Live Backend Connected / Live RLS Active" banner was
            removed here as well. It asserted a connection state the server component cannot
            prove. The per-query error notice below surfaces the real, sanitized failure. */}

        {/* Database Query Warning / Notice if present (Sanitized message) */}
        {queueResult.error && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center gap-2">
            <ExclamationTriangleIcon size={16} className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Notice: {queueResult.error}</span>
          </div>
        )}

        {/* Queue Header with Actions and Summary Counter */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/"
                className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1"
              >
                <ChevronLeftIcon size={14} className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-xs font-semibold text-slate-700">Reports Queue</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Maintenance Reports Queue
            </h2>
            <p className="text-sm text-slate-500 mt-1">{roleDescription}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
              {queueResult.totalCount} {queueResult.totalCount === 1 ? 'Report' : 'Reports'} Registered
            </div>

            <Link href="/reports/new">
              <Button variant="primary" leftIcon={<PlusCircleIcon className="w-4 h-4" />}>
                Submit Report
              </Button>
            </Link>
          </div>
        </div>

        {/* Main Reports Table */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-4 sm:p-6">
          <ReportList
            reports={queueResult.reports}
            userRole={role}
            error={queueResult.error}
            totalCount={queueResult.totalCount}
            emptyTitle={
              isStudent
                ? 'No maintenance requests submitted yet'
                : isTechnician
                ? 'No work orders currently assigned to your queue'
                : 'No reports currently match your queue filters'
            }
            emptyDescription={
              isStudent
                ? 'When you submit a maintenance issue or safety hazard, you will be able to monitor coordinator triage, technician dispatch, and verification progress here.'
                : isTechnician
                ? 'Newly dispatched campus maintenance assignments will appear in this work queue.'
                : 'There are currently no maintenance reports matching your view scope in the live database.'
            }
          />

          {/* Pagination Controls with Filter Parameter Preservation */}
          {queueResult.totalPages > 1 && (
            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
              <p>
                Showing {(queueResult.currentPage - 1) * queueResult.pageSize + 1} to{' '}
                {Math.min(queueResult.currentPage * queueResult.pageSize, queueResult.totalCount)} of{' '}
                {queueResult.totalCount} reports
              </p>

              <div className="flex items-center gap-2">
                {queueResult.currentPage > 1 ? (
                  <Link href={prevPageUrl}>
                    <Button variant="outline" size="sm" leftIcon={<ChevronLeftIcon className="w-3.5 h-3.5" />}>
                      Previous
                    </Button>
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled leftIcon={<ChevronLeftIcon className="w-3.5 h-3.5" />}>
                    Previous
                  </Button>
                )}

                <span className="px-3 py-1 font-semibold text-slate-700 bg-slate-50 rounded-md border border-slate-200">
                  Page {queueResult.currentPage} of {queueResult.totalPages}
                </span>

                {queueResult.hasMore ? (
                  <Link href={nextPageUrl}>
                    <Button variant="outline" size="sm" rightIcon={<ChevronRightIcon className="w-3.5 h-3.5" />}>
                      Next
                    </Button>
                  </Link>
                ) : (
                  <Button variant="outline" size="sm" disabled rightIcon={<ChevronRightIcon className="w-3.5 h-3.5" />}>
                    Next
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
