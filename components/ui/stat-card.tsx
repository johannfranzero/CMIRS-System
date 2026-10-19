import React from 'react';

interface StatCardProps {
  title: string;
  value: number | string;
  description: string;
  icon: React.ReactNode;
  variant?: 'default' | 'amber' | 'blue' | 'emerald' | 'rose';
  urgentAlert?: boolean;
}

export function StatCard({
  title,
  value,
  description,
  icon,
  variant = 'default',
  urgentAlert = false,
}: StatCardProps) {
  const iconTheme = {
    default: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
  };

  return (
    <div
      className={`relative overflow-hidden bg-white rounded-xl border p-5 shadow-xs transition-shadow hover:shadow-sm ${
        urgentAlert
          ? 'border-rose-300 ring-1 ring-rose-300/40'
          : 'border-slate-200/90'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs sm:text-sm font-medium text-slate-500 uppercase tracking-wider">
            {title}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              {value}
            </span>
            {urgentAlert && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800">
                Action required
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 line-clamp-1">{description}</p>
        </div>

        <div
          className={`shrink-0 p-3 rounded-lg border ${iconTheme[variant]} flex items-center justify-center`}
          aria-hidden="true"
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
