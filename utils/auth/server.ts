import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { AuthenticatedUser, UserProfile, UserRole } from '@/types/auth';
import { isUserRole, sanitizeRedirectUrl } from '@/utils/auth/validation';

/**
 * Retrieves the currently authenticated user and their corresponding
 * active `public.profiles` record from Supabase.
 *
 * This function is wrapped in React `cache()` to deduplicate database
 * queries within a single server rendering pass. It is NOT persistent
 * cross-request storage; each incoming HTTP request executes its own
 * isolated lookup.
 *
 * Security guarantees:
 * - Uses `supabase.auth.getUser()`, which cryptographically validates
 *   the JWT with Supabase Auth (never trusting client claims).
 * - Queries `public.profiles` for active status (`is_active === true`).
 * - Validates role against canonical `UserRole` enum values.
 * - Fails closed: returns `null` if user is missing, profile is missing,
 *   account is inactive, or role is invalid.
 */
export const getCurrentUserAndProfile = cache(
  async (): Promise<AuthenticatedUser | null> => {
    try {
      const supabase = await createClient();

      // 1. Authenticate session with Supabase Auth server
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return null;
      }

      // 2. Fetch profile from database
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, phone, is_active, created_at, updated_at')
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        return null;
      }

      // 3. Enforce active account status
      if (!profile.is_active) {
        return null;
      }

      // 4. Validate canonical role enum
      if (!isUserRole(profile.role)) {
        console.error(`Invalid role "${profile.role}" encountered for user ${user.id}`);
        return null;
      }

      return {
        id: user.id,
        email: user.email ?? profile.email,
        profile: profile as UserProfile,
      };
    } catch {
      // In case of unconfigured env vars or network failure, fail closed
      return null;
    }
  }
);

/**
 * Server Component Guard: Asserts that the caller is authenticated with an active profile.
 * Redirects to `/login` if unauthenticated or inactive, preserving the return destination safely.
 */
export async function requireAuth(nextPath?: string): Promise<AuthenticatedUser> {
  const user = await getCurrentUserAndProfile();

  if (!user) {
    const safeNext = nextPath ? sanitizeRedirectUrl(nextPath, '/') : null;
    const loginTarget = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : '/login';
    redirect(loginTarget);
  }

  return user;
}

/**
 * Server Component Guard: Asserts that the caller is authenticated, active,
 * and possesses one of the authorized canonical roles.
 *
 * If the user is unauthenticated, redirects to `/login`.
 * If the user is authenticated but lacks required role permissions, redirects to `/unauthorized`.
 */
export async function requireRole(
  allowedRoles: UserRole[],
  nextPath?: string
): Promise<AuthenticatedUser> {
  const user = await requireAuth(nextPath);

  if (!allowedRoles.includes(user.profile.role)) {
    redirect('/unauthorized');
  }

  return user;
}
