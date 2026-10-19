import { UserRole, USER_ROLES, ROLE_LABELS } from '@/types/auth';

/**
 * Validates whether an email string has a valid RFC-like format.
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  // Standard RFC 5322 simplified email regex pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(trimmed);
}

/**
 * Sanitizes and validates a redirect/return URL to prevent open-redirect vulnerabilities.
 *
 * Rules:
 * - Must be a non-empty string.
 * - Must start with a single `/`.
 * - Must NOT start with `//` (protocol-relative URL).
 * - Must NOT contain backslashes (`\`).
 * - Must NOT contain explicit protocols (`http:`, `https:`, `javascript:`, `data:`).
 * - Defaults to `defaultUrl` (default: `'/'`) if invalid.
 */
export function sanitizeRedirectUrl(
  targetUrl: string | null | undefined,
  defaultUrl: string = '/'
): string {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return defaultUrl;
  }

  const trimmed = targetUrl.trim();

  // Reject empty strings
  if (!trimmed) {
    return defaultUrl;
  }

  // Reject protocol-relative URLs (`//evil.com`) or backslash-based exploits
  if (trimmed.startsWith('//') || trimmed.includes('\\')) {
    return defaultUrl;
  }

  // Reject URLs that contain dangerous schemes
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('data:') ||
    lower.includes('vbscript:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://')
  ) {
    return defaultUrl;
  }

  // Must start with exactly one forward slash
  if (!trimmed.startsWith('/')) {
    return defaultUrl;
  }

  return trimmed;
}

/**
 * Type guard to check if a string matches one of the canonical UserRole values.
 */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Formats a role value into a human-readable display label.
 */
export function formatRoleLabel(role: UserRole | string | undefined | null): string {
  if (!role) return 'Unknown Role';
  if (isUserRole(role)) {
    return ROLE_LABELS[role];
  }
  // Fallback for custom or unmapped string
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
