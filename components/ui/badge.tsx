import React from 'react';
import { ReportStatus, PriorityLevel } from '@/types/reports';
import { ExclamationTriangleIcon, CheckCircleIcon, ClockIcon, WrenchIcon } from './icons';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
  variant?: 'default' | 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}: BadgeProps) {
  const variantStyles = {
    default: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-rose-50 text-rose-800 border-rose-200',
  };

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs sm:text-sm px-2.5 py-1',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full border ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: ReportStatus;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  switch (status) {
    case 'submitted':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-amber-50 text-amber-800 border-amber-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <ClockIcon size={14} className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Submitted</span>
        </span>
      );
    case 'under_review':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-sky-50 text-sky-800 border-sky-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse shrink-0" />
          <span>Under Review</span>
        </span>
      );
    case 'assigned':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-indigo-50 text-indigo-800 border-indigo-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
          <span>Assigned</span>
        </span>
      );
    case 'in_progress':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-blue-50 text-blue-800 border-blue-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <WrenchIcon size={14} className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          <span>In Progress</span>
        </span>
      );
    case 'on_hold':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-orange-50 text-orange-800 border-orange-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <ClockIcon size={14} className="w-3.5 h-3.5 text-orange-500 shrink-0" />
          <span>On Hold</span>
        </span>
      );
    case 'completed':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-teal-50 text-teal-800 border-teal-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <CheckCircleIcon size={14} className="w-3.5 h-3.5 text-teal-600 shrink-0" />
          <span>Completed</span>
        </span>
      );
    case 'verified':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-emerald-50 text-emerald-800 border-emerald-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <CheckCircleIcon size={14} className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>Verified Closed</span>
        </span>
      );
    case 'reopened':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-rose-50 text-rose-800 border-rose-200 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <ExclamationTriangleIcon size={14} className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span>Reopened</span>
        </span>
      );
    case 'cancelled':
      return (
        <span
          className={`inline-flex items-center gap-1.5 font-medium rounded-full border bg-slate-100 text-slate-700 border-slate-300 ${
            size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
          }`}
        >
          <span>Cancelled</span>
        </span>
      );
  }
}

interface PriorityBadgeProps {
  priority: PriorityLevel;
  isUrgentHazard?: boolean;
}

export function PriorityBadge({ priority, isUrgentHazard = false }: PriorityBadgeProps) {
  const priorityConfig = {
    critical: {
      bg: 'bg-red-50 text-red-800 border-red-200',
      label: 'Critical',
      dot: 'bg-red-500',
    },
    high: {
      bg: 'bg-amber-50 text-amber-800 border-amber-200',
      label: 'High',
      dot: 'bg-amber-500',
    },
    medium: {
      bg: 'bg-blue-50 text-blue-800 border-blue-200',
      label: 'Medium',
      dot: 'bg-blue-500',
    },
    low: {
      bg: 'bg-slate-100 text-slate-700 border-slate-200',
      label: 'Low',
      dot: 'bg-slate-400',
    },
  };

  const config = priorityConfig[priority];

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border ${config.bg}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot} shrink-0`} />
        <span>{config.label}</span>
      </span>

      {isUrgentHazard && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-semibold bg-rose-100 text-rose-900 border border-rose-300"
          title="Reporter flagged as urgent safety hazard"
        >
          <ExclamationTriangleIcon size={12} className="w-3 h-3 text-rose-700 shrink-0" />
          <span>Urgent</span>
        </span>
      )}
    </div>
  );
}
