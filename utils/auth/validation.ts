import { USER_ROLES, type UserRole } from '../../types/auth.ts';

export { formatRoleLabel } from '../../types/auth.ts';

/**
 * A neutral origin used only to probe how the WHATWG URL parser interprets a candidate
 * redirect path. It is never used to build a redirect response.
 */
const URL_PROBE_ORIGIN = 'https://cmirs-redirect-probe.invalid';

/**
 * ASCII control characters (C0 range) plus DEL.
 *
 * The WHATWG URL parser silently strips ASCII tab (U+0009), line feed (U+000A) and
 * carriage return (U+000D) from any URL it parses. A value such as `/%09/evil.com`
 * therefore survives every textual check below — it starts with a single `/`, contains
 * no scheme and no backslash — but the browser resolves it as `https://evil.com/`.
 * Rejecting control characters closes that parser-differential.
 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Validates whether an email string has a valid RFC-like format.
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  // Standard RFC 5322 simplified email regex pattern
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
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
 * - Must NOT contain ASCII control characters (the URL parser strips tab/newline/CR).
 * - Must NOT contain explicit protocols (`http:`, `https:`, `javascript:`, `data:`).
 * - Must still resolve to the probe origin once the URL parser has processed it, so a
 *   value can never be re-interpreted as an external origin.
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

  // Reject ASCII control characters. The URL parser strips tab / newline / carriage
  // return, which can turn an internal-looking path into an absolute external URL.
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
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

  // Final proof: after the URL parser has processed the value, it must still resolve to
  // the same origin. Anything that resolves elsewhere is an external redirect.
  try {
    const parsed = new URL(trimmed, URL_PROBE_ORIGIN);
    if (parsed.origin !== URL_PROBE_ORIGIN) {
      return defaultUrl;
    }
  } catch {
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
