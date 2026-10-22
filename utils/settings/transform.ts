import { formatRoleLabel, type UserRole } from '../../types/auth.ts';
import type {
  RoleChangeAuditHistoryEntry,
  SettingsUserDirectoryResult,
  SettingsUserDirectoryEntry,
} from '@/types/settings';

export const SETTINGS_USER_DIRECTORY_ERROR_MESSAGE =
  'The user directory is temporarily unavailable. Please try again shortly.';

export const SETTINGS_USER_DIRECTORY_INCOMPLETE_MESSAGE =
  'The complete user directory could not be retrieved. No partial accounts are displayed.';

interface RawSettingsUser {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  role?: UserRole | null;
  is_active?: boolean | null;
}

interface RawRoleChangeAudit {
  id?: string | null;
  old_role?: UserRole | null;
  new_role?: UserRole | null;
  created_at?: string | null;
  affected_user?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
  changed_by_user?: { full_name?: string | null } | Array<{ full_name?: string | null }> | null;
}

function relationName(
  relation: { full_name?: string | null } | Array<{ full_name?: string | null }> | null | undefined
): string {
  const value = Array.isArray(relation) ? relation[0]?.full_name : relation?.full_name;
  return typeof value === 'string' && value.trim() ? value.trim() : 'Name unavailable';
}

export function mapSettingsUser(
  user: RawSettingsUser,
  hasAuthAccount: boolean | null = null
): SettingsUserDirectoryEntry {
  return {
    id: user.id ?? '',
    fullName: user.full_name?.trim() || 'Name unavailable',
    email: user.email?.trim() || 'Email unavailable',
    role: user.role ?? 'student_personnel',
    isActive: user.is_active === true,
    hasAuthAccount,
  };
}

export function isSettingsUserDirectoryComplete(
  totalCount: number | null | undefined,
  fetchedCount: number
): boolean {
  return (
    totalCount !== null &&
    totalCount !== undefined &&
    totalCount >= 0 &&
    totalCount === fetchedCount
  );
}

export function createSettingsUserDirectoryResult(
  users: RawSettingsUser[] | null | undefined,
  totalCount: number | null | undefined,
  error: unknown,
  authAccountStatus?: Map<string, boolean> | null
): SettingsUserDirectoryResult {
  const fetchedCount = users?.length ?? 0;

  if (error) {
    return {
      users: [],
      state: 'error',
      totalCount: totalCount ?? null,
      fetchedCount,
      error: SETTINGS_USER_DIRECTORY_ERROR_MESSAGE,
    };
  }

  if (!isSettingsUserDirectoryComplete(totalCount, fetchedCount)) {
    return {
      users: [],
      state: 'incomplete',
      totalCount: totalCount ?? null,
      fetchedCount,
      error: SETTINGS_USER_DIRECTORY_INCOMPLETE_MESSAGE,
    };
  }

  return {
    users: (users ?? []).map((user) =>
      mapSettingsUser(
        user,
        user.id && authAccountStatus ? (authAccountStatus.get(user.id) ?? null) : null
      )
    ),
    state: 'ready',
    totalCount: totalCount ?? null,
    fetchedCount,
    error: null,
  };
}

export function mapRoleChangeAudit(
  audit: RawRoleChangeAudit
): RoleChangeAuditHistoryEntry {
  return {
    id: audit.id ?? '',
    affectedUserName: relationName(audit.affected_user),
    actorName: relationName(audit.changed_by_user),
    oldRole: audit.old_role ?? 'student_personnel',
    newRole: audit.new_role ?? 'student_personnel',
    createdAt: audit.created_at ?? '',
  };
}

export function filterSettingsUsers(
  users: readonly SettingsUserDirectoryEntry[],
  searchQuery: string
): SettingsUserDirectoryEntry[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [...users];
  }

  return users.filter((user) =>
    [user.fullName, user.email, formatRoleLabel(user.role), user.isActive ? 'active' : 'inactive']
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  );
}

export function formatAuditTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Timestamp unavailable';
  }

  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(date);
}
