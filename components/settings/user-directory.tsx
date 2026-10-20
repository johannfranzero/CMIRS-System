'use client';

import { useMemo, useState } from 'react';
import type { SettingsUserDirectoryEntry } from '@/types/settings';
import { filterSettingsUsers, formatSettingsRole } from '@/utils/settings/transform';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchIcon, UserIcon } from '@/components/ui/icons';

interface UserDirectoryProps {
  users: SettingsUserDirectoryEntry[];
}

export function UserDirectory({ users }: UserDirectoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredUsers = useMemo(
    () => filterSettingsUsers(users, searchQuery),
    [searchQuery, users]
  );
  const hasSearchQuery = searchQuery.trim().length > 0;

  if (users.length === 0) {
    return (
      <EmptyState
        title="No user accounts available"
        description="There are no user accounts available in the administrator directory."
        icon={<UserIcon className="h-6 w-6" />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="settings-user-search" className="mb-2 block text-sm font-medium text-slate-700">
          Search user directory
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            id="settings-user-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, email, role, or status"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-24 text-sm text-slate-900 shadow-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            aria-describedby="settings-user-results"
          />
          {hasSearchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
            >
              Clear
            </Button>
          )}
        </div>
        <p id="settings-user-results" className="mt-2 text-sm text-slate-500" aria-live="polite">
          {filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'} shown
        </p>
      </div>

      {filteredUsers.length === 0 ? (
        <EmptyState
          title="No users match your search"
          description="Try a different name, email, role, or account-status term."
          icon={<SearchIcon className="h-6 w-6" />}
          actionLabel="Clear search"
          onAction={() => setSearchQuery('')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Read-only administrator user directory</caption>
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-2 py-3 font-medium">Name</th>
                <th scope="col" className="px-2 py-3 font-medium">Email</th>
                <th scope="col" className="px-2 py-3 font-medium">Role</th>
                <th scope="col" className="px-2 py-3 font-medium">Account status</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="whitespace-nowrap px-2 py-3 font-medium text-slate-800">{user.fullName}</th>
                  <td className="px-2 py-3 text-slate-600">{user.email}</td>
                  <td className="px-2 py-3"><Badge variant="neutral" size="sm">{formatSettingsRole(user.role)}</Badge></td>
                  <td className="px-2 py-3">
                    <Badge variant={user.isActive ? 'success' : 'neutral'} size="sm">
                      {user.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
