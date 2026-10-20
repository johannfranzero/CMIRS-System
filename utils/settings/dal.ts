import { getCurrentUserAndProfile } from '@/utils/auth/server';
import { createClient } from '@/utils/supabase/server';
import type { AdministratorSettingsData } from '@/types/settings';
import { getAdministratorSettingsDataFromClient } from './runtime';
import { createSettingsUserDirectoryResult } from './transform';

export { SETTINGS_USER_DIRECTORY_MAX_ROWS } from './runtime';
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
    return getAdministratorSettingsDataFromClient(supabase);
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
