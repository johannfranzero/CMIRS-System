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
 * The roles that are permitted to SUBMIT a new maintenance report.
 *
 * Authority:
 *   * `docs/ROLES.md` — "Submit new report": Student / Personnel ✅, Coordinator ✅,
 *     Administrator —, Management — (pending decision PD-R6, "currently marked as not permitted").
 *   * The Maintenance Technician role is an operational repair role
 *     ("Inspect and perform assigned repairs"); the owner has confirmed that a technician must
 *     not be a reporter, so the matrix row for the technician is withdrawn.
 *
 * This list is enforced on the server (the `submitReportAction` Server Action and the
 * `/reports/new` route) and mirrored in the navigation and the dashboard call to action.
 * It is not a UI-only restriction.
 */
export const REPORT_SUBMITTER_ROLES: readonly UserRole[] = [
  'student_personnel',
  'coordinator',
] as const;

/**
 * Returns true when the role may submit a new maintenance report.
 */
export function canSubmitReport(role: UserRole | string | null | undefined): boolean {
  if (!role) return false;
  return (REPORT_SUBMITTER_ROLES as readonly string[]).includes(role);
}

/**
 * Formats a role value into a human-readable display label.
 */
export function formatRoleLabel(role: UserRole | string | undefined | null): string {
  if (!role) return 'Unknown Role';

  if ((USER_ROLES as readonly string[]).includes(role)) {
    return ROLE_LABELS[role as UserRole];
  }

  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

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
