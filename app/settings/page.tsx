import { requireRole } from '@/utils/auth/server';
import { getAdministratorSettingsData } from '@/utils/settings/dal';
import { AppShell } from '@/components/layout/app-shell';
import { RoleChangeAuditHistory } from '@/components/settings/role-change-audit-history';
import { UserDirectory } from '@/components/settings/user-directory';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ExclamationTriangleIcon, SettingsIcon, UserIcon } from '@/components/ui/icons';
import { formatRoleLabel } from '@/types/auth';

export const instant = false;

function SectionError({
  title = 'Settings data is temporarily unavailable',
  message,
  detail,
}: {
  title?: string;
  message: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4" role="alert">
      <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
      <div>
        <h2 className="font-semibold text-amber-950">{title}</h2>
        <p className="mt-1 text-sm text-amber-950">{message}</p>
        {detail && <p className="mt-2 text-sm text-amber-900">{detail}</p>}
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireRole(['administrator'], '/settings');
  const settingsData = await getAdministratorSettingsData();

  return (
    <AppShell user={user} pageTitle="Administrator Settings">
      <div className="mx-auto max-w-7xl space-y-6 py-6 sm:py-8">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600">
            <SettingsIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Administrator Settings</h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 sm:text-base">
              Read-only account, user-directory, and role-audit information.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Current Administrator Account</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                  <UserIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">{user.profile.full_name}</p>
                  <p className="text-sm text-slate-600">{user.profile.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="info">{formatRoleLabel(user.profile.role)}</Badge>
                <Badge variant={user.profile.is_active ? 'success' : 'neutral'}>
                  {user.profile.is_active ? 'Active account' : 'Inactive account'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User Directory</CardTitle>
          </CardHeader>
          <CardContent>
            {settingsData.userDirectory.state !== 'ready' ? (
              <SectionError
                title={
                  settingsData.userDirectory.state === 'incomplete'
                    ? 'User directory is incomplete'
                    : undefined
                }
                message={settingsData.userDirectory.error ?? 'The user directory is unavailable.'}
                detail={
                  settingsData.userDirectory.state === 'incomplete'
                    ? `Retrieved ${settingsData.userDirectory.fetchedCount} of ${settingsData.userDirectory.totalCount ?? 'an unknown number of'} accounts. No partial directory is displayed.`
                    : undefined
                }
              />
            ) : (
              <UserDirectory users={settingsData.userDirectory.users} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Role-Change Audit History</CardTitle>
          </CardHeader>
          <CardContent>
            {settingsData.roleChangeHistoryError ? (
              <SectionError message={settingsData.roleChangeHistoryError} />
            ) : (
              <RoleChangeAuditHistory entries={settingsData.roleChangeHistory} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
