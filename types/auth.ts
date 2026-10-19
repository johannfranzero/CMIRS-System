/**
 * CMIRS — Authentication and Role-Based Access Control Types
 *
 * Source of Truth: PostgreSQL type `user_role` in
 * `supabase/migrations/20261018000001_core_schema.sql`
 */

/**
 * The five canonical operational roles defined in the CMIRS database.
 * Do not add or rename values here without corresponding database migrations.
 */
export type UserRole =
  | 'student_personnel'
  | 'coordinator'
  | 'technician'
  | 'administrator'
  | 'management';

/**
 * Array of all valid UserRole values for runtime validation.
 */
export const USER_ROLES: readonly UserRole[] = [
  'student_personnel',
  'coordinator',
  'technician',
  'administrator',
  'management',
] as const;

/**
 * Human-readable display labels for each role in the user interface.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  student_personnel: 'Student / Personnel',
  coordinator: 'Maintenance Coordinator',
  technician: 'Maintenance Technician',
  administrator: 'School Administrator',
  management: 'School Management',
};

/**
 * User Profile model representing the `public.profiles` database table.
 */
export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Combined authentication user identity and profile record.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  profile: UserProfile;
}

/**
 * State returned by the `loginAction` Server Action.
 */
export interface LoginFormState {
  success: boolean;
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
}
