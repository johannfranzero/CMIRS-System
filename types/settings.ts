import type { UserRole } from '@/types/auth';

export interface SettingsUserDirectoryEntry {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  /**
   * Phase 4E: true when a CONFIRMED Supabase Auth user exists for this profile.
   * A profile row without one cannot sign in and must not be presented as a working account.
   * `null` means the linkage status could not be read.
   */
  hasAuthAccount: boolean | null;
}

export type SettingsUserDirectoryState = 'ready' | 'incomplete' | 'error';

export interface SettingsUserDirectoryResult {
  users: SettingsUserDirectoryEntry[];
  state: SettingsUserDirectoryState;
  totalCount: number | null;
  fetchedCount: number;
  error: string | null;
}

export interface RoleChangeAuditHistoryEntry {
  id: string;
  affectedUserName: string;
  actorName: string;
  oldRole: UserRole;
  newRole: UserRole;
  createdAt: string;
}

export interface AdministratorSettingsData {
  userDirectory: SettingsUserDirectoryResult;
  roleChangeHistory: RoleChangeAuditHistoryEntry[];
  roleChangeHistoryError: string | null;
}
