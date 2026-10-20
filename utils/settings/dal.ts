import { getCurrentUserAndProfile } from '@/utils/auth/server';
import { createClient } from '@/utils/supabase/server';
import type { AdministratorSettingsData } from '@/types/settings';
import {
  createSettingsUserDirectoryResult,
  mapRoleChangeAudit,
} from './transform';

const ROLE_CHANGE_HISTORY_LIMIT = 100;
export const SETTINGS_USER_DIRECTORY_MAX_ROWS = 1000;
const ROLE_CHANGE_HISTORY_ERROR_MESSAGE =
  'Role-change audit history is temporarily unavailable. Please try again shortly.';

export async function getAdministratorSettingsData(): Promise<AdministratorSettingsData> {
  const user = await getCurrentUserAndProfile();

  if (!user?.profile?.is_active || user.profile.role !== 'administrator') {
    return {
      userDirectory: createSettingsUserDirectoryResult(
        null,
        null,
        new Error('Unauthenticated administrator settings request')
      ),
      roleChangeHistory: [],
      roleChangeHistoryError: ROLE_CHANGE_HISTORY_ERROR_MESSAGE,
    };
  }

  try {
    const supabase = await createClient();
    const [usersResult, auditResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active', { count: 'exact' })
        .order('full_name')
        .range(0, SETTINGS_USER_DIRECTORY_MAX_ROWS - 1),
      supabase
        .from('role_change_audit')
        .select(`
          id,
          old_role,
          new_role,
          created_at,
          affected_user:profiles!user_id (
            full_name
          ),
          changed_by_user:profiles!changed_by (
            full_name
          )
        `)
        .order('created_at', { ascending: false })
        .limit(ROLE_CHANGE_HISTORY_LIMIT),
    ]);

    return {
      userDirectory: createSettingsUserDirectoryResult(
        usersResult.data,
        usersResult.count,
        usersResult.error
      ),
      roleChangeHistory: auditResult.error
        ? []
        : (auditResult.data ?? []).map(mapRoleChangeAudit),
      roleChangeHistoryError: auditResult.error ? ROLE_CHANGE_HISTORY_ERROR_MESSAGE : null,
    };
  } catch {
    return {
      userDirectory: createSettingsUserDirectoryResult(
        null,
        null,
        new Error('Administrator settings retrieval failed')
      ),
      roleChangeHistory: [],
      roleChangeHistoryError: ROLE_CHANGE_HISTORY_ERROR_MESSAGE,
    };
  }
}
