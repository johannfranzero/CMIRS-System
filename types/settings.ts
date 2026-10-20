import type { UserRole } from '@/types/auth';

export interface SettingsUserDirectoryEntry {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
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
