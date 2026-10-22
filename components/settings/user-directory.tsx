'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SettingsUserDirectoryEntry } from '@/types/settings';
import { formatRoleLabel, USER_ROLES } from '@/types/auth';
import { filterSettingsUsers } from '@/utils/settings/transform';
import {
  updateInstitutionalAccountAction,
  INITIAL_ACCOUNT_MANAGEMENT_STATE,
} from '@/actions/accounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ExclamationTriangleIcon, SearchIcon, UserIcon } from '@/components/ui/icons';

interface UserDirectoryProps {
  users: SettingsUserDirectoryEntry[];
  /** The signed-in administrator; their own row cannot be managed. */
  currentUserId?: string;
}

export function UserDirectory({ users, currentUserId }: UserDirectoryProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [managedUserId, setManagedUserId] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState(
    updateInstitutionalAccountAction,
    INITIAL_ACCOUNT_MANAGEMENT_STATE
  );

  const filteredUsers = useMemo(
    () => filterSettingsUsers(users, searchQuery),
    [searchQuery, users]
  );
  const hasSearchQuery = searchQuery.trim().length > 0;

  useEffect(() => {
    if (state.status === 'success') {
      // The refreshed directory already shows the new account state; the panel stays open so
      // the administrator can see the result in place.
      router.refresh();
    }
  }, [state, router]);

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

      {state.status === 'error' && state.message && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"
        >
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

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
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">Administrator user directory and account management</caption>
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-2 py-3 font-medium">Name</th>
                <th scope="col" className="px-2 py-3 font-medium">Email</th>
                <th scope="col" className="px-2 py-3 font-medium">Role</th>
                <th scope="col" className="px-2 py-3 font-medium">Account status</th>
                <th scope="col" className="px-2 py-3 font-medium">Login account</th>
                <th scope="col" className="px-2 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isSelf = currentUserId !== undefined && user.id === currentUserId;
                const isOpen = managedUserId === user.id;

                return (
                  <tr key={user.id} className="border-b border-slate-100 last:border-0 align-top">
                    <th scope="row" className="whitespace-nowrap px-2 py-3 font-medium text-slate-800">
                      {user.fullName}
                      {isSelf && (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          You
                        </span>
                      )}
                    </th>
                    <td className="px-2 py-3 text-slate-600">{user.email}</td>
                    <td className="px-2 py-3">
                      <Badge variant="neutral" size="sm">{formatRoleLabel(user.role)}</Badge>
                    </td>
                    <td className="px-2 py-3">
                      <Badge variant={user.isActive ? 'success' : 'neutral'} size="sm">
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-2 py-3">
                      {user.hasAuthAccount === null ? (
                        <Badge variant="neutral" size="sm">Unknown</Badge>
                      ) : user.hasAuthAccount ? (
                        <Badge variant="info" size="sm">Confirmed</Badge>
                      ) : (
                        <Badge variant="warning" size="sm">No login account</Badge>
                      )}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {isSelf ? (
                        <span className="text-xs text-slate-400">Not manageable</span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-expanded={isOpen}
                          onClick={() => setManagedUserId(isOpen ? null : user.id)}
                        >
                          {isOpen ? 'Close' : 'Manage'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {managedUserId &&
            (() => {
              const target = users.find((user) => user.id === managedUserId);
              if (!target) return null;

              return (
                <form
                  action={formAction}
                  className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-4"
                >
                  <input type="hidden" name="profileId" value={target.id} />

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <label
                        htmlFor={`role-${target.id}`}
                        className="mb-1 block text-xs font-semibold text-slate-800"
                      >
                        Institutional role
                      </label>
                      <select
                        id={`role-${target.id}`}
                        name="role"
                        defaultValue={target.role}
                        disabled={isPending}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {formatRoleLabel(role)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={target.isActive}
                        disabled={isPending}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      May sign in
                    </label>
                  </div>

                  <div>
                    <label
                      htmlFor={`reason-${target.id}`}
                      className="mb-1 block text-xs font-semibold text-slate-800"
                    >
                      Reason (required for a role change)
                    </label>
                    <input
                      id={`reason-${target.id}`}
                      name="reason"
                      type="text"
                      maxLength={500}
                      disabled={isPending}
                      placeholder="e.g. Technician account provisioned for the electrical team"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
                    />
                  </div>

                  <p className="text-[11px] text-slate-500">
                    Changing a role is recorded in the role-change audit history. This action
                    cannot create a Supabase login: account creation happens in Supabase Auth, and
                    the profile is linked to that login automatically.
                  </p>

                  <div className="flex items-center gap-2">
                    <Button type="submit" variant="primary" size="sm" disabled={isPending}>
                      {isPending ? 'Saving...' : 'Save account state'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setManagedUserId(null)}
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              );
            })()}
        </div>
      )}
    </div>
  );
}
