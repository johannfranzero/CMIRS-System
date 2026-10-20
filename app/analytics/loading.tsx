export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 p-6" role="status" aria-live="polite" aria-label="Loading operational analytics">
      <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      </div>
      <span className="sr-only">Loading operational analytics</span>
    </div>
  );
}
