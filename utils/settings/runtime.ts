import type { AdministratorSettingsData } from '../../types/settings';
import {
  createSettingsUserDirectoryResult,
  mapRoleChangeAudit,
} from './transform.ts';

export const SETTINGS_USER_DIRECTORY_MAX_ROWS = 1000;
const ROLE_CHANGE_HISTORY_LIMIT = 100;
const ROLE_CHANGE_HISTORY_ERROR_MESSAGE =
  'Role-change audit history is temporarily unavailable. Please try again shortly.';

interface RawSettingsUser {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  role?: 'student_personnel' | 'coordinator' | 'technician' | 'administrator' | 'management' | null;
  is_active?: boolean | null;
}

interface RawRoleChangeAudit {
  id?: string | null;
  old_role?: RawSettingsUser['role'];
  new_role?: RawSettingsUser['role'];
  created_at?: string | null;
  affected_user?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  changed_by_user?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
}

interface QueryResult<Row> {
  data: Row[] | null;
  count?: number | null;
  error: unknown;
}

interface ProfilesQuery {
  select(
    columns: string,
    options: { count: 'exact' }
  ): {
    order(column: string): {
      range(from: number, to: number): Promise<QueryResult<RawSettingsUser>>;
    };
  };
}

interface RoleChangeAuditQuery {
  select(columns: string): {
    order(column: string, options: { ascending: boolean }): {
      limit(count: number): Promise<QueryResult<RawRoleChangeAudit>>;
    };
  };
}

export interface SettingsReadSupabaseClient {
  from(table: 'profiles' | 'role_change_audit'): unknown;
  rpc?(
    fn: string,
    params: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Loads the bulk auth-account linkage status for the given profile ids.
 *
 * Phase 4E: one round trip for the whole directory. A failure yields an empty map, which
 * makes the directory show an "unknown" linkage state rather than claiming that an account
 * has (or has not) a login.
 */
async function loadAuthAccountStatus(
  supabase: SettingsReadSupabaseClient,
  profileIds: string[]
): Promise<Map<string, boolean>> {
  const status = new Map<string, boolean>();
  if (profileIds.length === 0 || typeof supabase.rpc !== 'function') {
    return status;
  }

  try {
    const { data, error } = await supabase.rpc('profiles_auth_account_status', {
      p_profile_ids: profileIds,
    });

    if (error || !Array.isArray(data)) {
      return status;
    }

    for (const row of data as Array<{ profile_id?: string; has_auth_account?: boolean }>) {
      if (typeof row.profile_id === 'string' && typeof row.has_auth_account === 'boolean') {
        status.set(row.profile_id, row.has_auth_account);
      }
    }
  } catch {
    return status;
  }

  return status;
}

export async function getAdministratorSettingsDataFromClient(
  supabase: SettingsReadSupabaseClient
): Promise<AdministratorSettingsData> {
  try {
    const profilesQuery = supabase.from('profiles') as ProfilesQuery;
    const auditQuery = supabase.from('role_change_audit') as RoleChangeAuditQuery;
    const [usersResult, auditResult] = await Promise.all([
      profilesQuery
        .select('id, full_name, email, role, is_active', { count: 'exact' })
        .order('full_name')
        .range(0, SETTINGS_USER_DIRECTORY_MAX_ROWS - 1),
      auditQuery
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

    const profiles = (usersResult.data ?? []) as RawSettingsUser[];
    const authAccountStatus = await loadAuthAccountStatus(
      supabase,
      profiles.map((profile) => profile.id).filter((id): id is string => typeof id === 'string')
    );

    return {
      userDirectory: createSettingsUserDirectoryResult(
        usersResult.data,
        usersResult.count,
        usersResult.error,
        authAccountStatus
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
