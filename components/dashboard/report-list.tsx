'use client';

import React, { useState, useMemo } from 'react';
import { MaintenanceReport } from '@/types/reports';
import { StatusBadge, PriorityBadge } from '@/components/ui/badge';
import { SearchIcon, FilterIcon, BuildingIcon, UserIcon, ArrowUpRightIcon } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/empty-state';

interface ReportListProps {
  reports: MaintenanceReport[];
}

export function ReportList({ reports }: ReportListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const categories = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => set.add(r.category));
    return Array.from(set);
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      // Search text filter
      const matchesSearch =
        searchQuery === '' ||
        report.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.trackingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        report.location.building.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (report.location.room && report.location.room.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (report.assignedTechnician && report.assignedTechnician.toLowerCase().includes(searchQuery.toLowerCase()));

      // Status tab filter
      let matchesStatus = true;
      if (statusFilter === 'urgent') {
        matchesStatus = report.isUrgentHazard || report.priority === 'critical';
      } else if (statusFilter === 'pending') {
        matchesStatus = report.status === 'submitted' || report.status === 'under_review';
      } else if (statusFilter === 'in_progress') {
        matchesStatus = report.status === 'assigned' || report.status === 'in_progress' || report.status === 'on_hold';
      } else if (statusFilter === 'completed') {
        matchesStatus = report.status === 'completed' || report.status === 'verified';
      }

      // Category filter
      const matchesCategory = categoryFilter === 'all' || report.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [reports, searchQuery, statusFilter, categoryFilter]);

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setCategoryFilter('all');
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search and Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <SearchIcon className="w-4 h-4" />
          </div>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, tracking #, building, or assignee..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-shadow"
            aria-label="Search reports"
          />
        </div>

        {/* Category selector */}
        <div className="flex items-center gap-2">
          <div className="relative inline-flex items-center">
            <FilterIcon className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent appearance-none cursor-pointer"
              aria-label="Filter by category"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <div className="absolute right-2.5 pointer-events-none text-slate-400 text-xs">▼</div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs sm:text-sm font-medium border-b border-slate-200">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-2 rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            statusFilter === 'all'
              ? 'border-indigo-600 text-indigo-700 font-semibold bg-indigo-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          All Active ({reports.length})
        </button>
        <button
          onClick={() => setStatusFilter('urgent')}
          className={`px-3 py-2 rounded-t-lg transition-colors border-b-2 whitespace-nowrap flex items-center gap-1.5 ${
            statusFilter === 'urgent'
              ? 'border-rose-600 text-rose-800 font-semibold bg-rose-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          Urgent & Critical
        </button>
        <button
          onClick={() => setStatusFilter('pending')}
          className={`px-3 py-2 rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            statusFilter === 'pending'
              ? 'border-indigo-600 text-indigo-700 font-semibold bg-indigo-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          Pending Review
        </button>
        <button
          onClick={() => setStatusFilter('in_progress')}
          className={`px-3 py-2 rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            statusFilter === 'in_progress'
              ? 'border-indigo-600 text-indigo-700 font-semibold bg-indigo-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          In Progress
        </button>
        <button
          onClick={() => setStatusFilter('completed')}
          className={`px-3 py-2 rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            statusFilter === 'completed'
              ? 'border-indigo-600 text-indigo-700 font-semibold bg-indigo-50/40'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          Resolved / Verified
        </button>
      </div>

      {/* Zero match state */}
      {filteredReports.length === 0 && (
        <EmptyState
          title="No reports match your filters"
          description="Try adjusting your search query, status category tab, or filter settings to find what you're looking for."
          actionLabel="Reset all filters"
          onAction={resetFilters}
        />
      )}

      {/* Desktop Table View (Hidden on mobile < md) */}
      {filteredReports.length > 0 && (
        <div className="hidden md:block overflow-hidden bg-white rounded-xl border border-slate-200/90 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 divide-y divide-slate-200">
              <thead className="bg-slate-50/80 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-4 py-3.5 w-32">
                    Tracking
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Issue & Category
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Location
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Priority
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3.5">
                    Assigned To
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right w-24">
                    Reported
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredReports.map((report) => (
                  <tr
                    key={report.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-default"
                  >
                    <td className="px-4 py-3.5 font-mono text-xs font-semibold text-indigo-700">
                      {report.trackingNumber}
                    </td>

                    <td className="px-4 py-3.5 max-w-xs">
                      <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                        {report.title}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {report.category}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 text-slate-800">
                        <BuildingIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-medium">{report.location.building}</span>
                      </div>
                      <div className="text-xs text-slate-500 pl-5">
                        {report.location.room ? `Room ${report.location.room}` : report.location.specificArea || `Floor ${report.location.floor}`}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <PriorityBadge
                        priority={report.priority}
                        isUrgentHazard={report.isUrgentHazard}
                      />
                    </td>

                    <td className="px-4 py-3.5">
                      <StatusBadge status={report.status} />
                    </td>

                    <td className="px-4 py-3.5 text-xs text-slate-700">
                      {report.assignedTechnician ? (
                        <div className="flex items-center gap-1.5">
                          <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-800">{report.assignedTechnician}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">Unassigned</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right text-xs text-slate-500 whitespace-nowrap">
                      {formatDate(report.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mobile Card View (Visible on screens < md) */}
      {filteredReports.length > 0 && (
        <div className="md:hidden flex flex-col gap-3">
          {filteredReports.map((report) => (
            <div
              key={report.id}
              className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-indigo-700">
                  {report.trackingNumber}
                </span>
                <PriorityBadge
                  priority={report.priority}
                  isUrgentHazard={report.isUrgentHazard}
                />
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                  {report.title}
                </h4>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  {report.description}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div className="flex items-center gap-1.5 text-slate-800">
                  <BuildingIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium">{report.location.building}</span>
                  {report.location.room && (
                    <span className="text-slate-500">• Room {report.location.room}</span>
                  )}
                </div>
                <div className="flex items-center justify-between text-slate-500 text-[11px]">
                  <span>Category: {report.category}</span>
                  <span>{formatDate(report.createdAt)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <StatusBadge status={report.status} />
                <div className="text-xs text-slate-600 flex items-center gap-1">
                  <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>{report.assignedTechnician || 'Unassigned'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
