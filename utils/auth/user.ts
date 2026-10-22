import { UserProfile, UserRole } from '@/types/auth';
import { formatRoleLabel } from '@/utils/auth/validation';

/**
 * Extracts 1-2 letter initials from a user's full name or email address.
 * Examples:
 * - "Jordan Miller" -> "JM"
 * - "Alice" -> "A"
 * - "alex.reyes@campus.edu" -> "AR"
 * - null/undefined -> "AU" (Authorized User)
 */
export function getInitials(name?: string | null, email?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return parts[0].substring(0, 2).toUpperCase();
    }
  }

  if (email && email.trim()) {
    const localPart = email.trim().split('@')[0];
    const parts = localPart.split(/[-._+]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return parts[0].substring(0, 2).toUpperCase();
    }
  }

  return 'AU';
}

/**
 * Returns a verified display name for the user with safe fallback handling.
 */
export function getUserDisplayName(
  profile?: UserProfile | null,
  email?: string | null
): string {
  if (profile?.full_name && profile.full_name.trim()) {
    return profile.full_name.trim();
  }

  if (email && email.trim()) {
    return email.trim().split('@')[0];
  }

  return 'Authorized User';
}

/**
 * Returns a human-readable role title for display in the application shell.
 */
export function getUserRoleTitle(role?: UserRole | null): string {
  if (!role) return 'Authorized Personnel';
  return formatRoleLabel(role);
}
