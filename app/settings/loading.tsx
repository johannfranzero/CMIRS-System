export default function SettingsLoading() {
  return (
    <div className="space-y-6 p-6" role="status" aria-live="polite" aria-label="Loading administrator settings">
      <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
      <span className="sr-only">Loading administrator settings</span>
    </div>
  );
}
