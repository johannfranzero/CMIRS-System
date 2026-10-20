import type { RoleChangeAuditHistoryEntry } from '@/types/settings';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { ClockIcon } from '@/components/ui/icons';
import { formatAuditTimestamp, formatSettingsRole } from '@/utils/settings/transform';

export function RoleChangeAuditHistory({ entries }: { entries: RoleChangeAuditHistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No role-change audit events"
        description="No role-change audit records are available for the selected history window."
        icon={<ClockIcon className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">Latest read-only role-change audit events</caption>
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-2 py-3 font-medium">Affected user</th>
            <th scope="col" className="px-2 py-3 font-medium">Previous role</th>
            <th scope="col" className="px-2 py-3 font-medium">New role</th>
            <th scope="col" className="px-2 py-3 font-medium">Changed by</th>
            <th scope="col" className="px-2 py-3 font-medium">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-slate-100 last:border-0">
              <th scope="row" className="whitespace-nowrap px-2 py-3 font-medium text-slate-800">{entry.affectedUserName}</th>
              <td className="px-2 py-3"><Badge variant="neutral" size="sm">{formatSettingsRole(entry.oldRole)}</Badge></td>
              <td className="px-2 py-3"><Badge variant="info" size="sm">{formatSettingsRole(entry.newRole)}</Badge></td>
              <td className="whitespace-nowrap px-2 py-3 text-slate-600">{entry.actorName}</td>
              <td className="whitespace-nowrap px-2 py-3 text-slate-600">{formatAuditTimestamp(entry.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
