'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { LoginFormState } from '@/types/auth';
import { isValidEmail, sanitizeRedirectUrl } from '@/utils/auth/validation';

/**
 * Server Action: Authenticates a user with email and password via Supabase Auth,
 * validates their active profile in `public.profiles`, and redirects on success.
 */
export async function loginAction(
  prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const email = formData.get('email')?.toString().trim().toLowerCase() ?? '';
  const password = formData.get('password')?.toString() ?? '';
  const nextParam = formData.get('next')?.toString();

  const fieldErrors: { email?: string; password?: string } = {};

  if (!email) {
    fieldErrors.email = 'Email address is required.';
  } else if (!isValidEmail(email)) {
    fieldErrors.email = 'Please enter a valid email address.';
  }

  if (!password) {
    fieldErrors.password = 'Password is required.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      error: 'Please correct the highlighted errors.',
      fieldErrors,
    };
  }

  let destinationUrl: string | null = null;

  try {
    const supabase = await createClient();

    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return {
        success: false,
        error: 'Invalid email or password. Please verify your credentials and try again.',
      };
    }

    // 2. Fetch user profile from public.profiles to check active status and role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_active')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      // In case of unexpected profile mismatch, sign out immediately
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'Unable to load your user profile. Please contact campus IT support.',
      };
    }

    // 3. Verify account is active
    if (!profile.is_active) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'This account has been deactivated. Please contact campus administration.',
      };
    }

    // 4. Determine sanitized destination URL
    const safeTarget = sanitizeRedirectUrl(nextParam, '/');
    const isPublic =
      safeTarget === '/login' ||
      safeTarget.startsWith('/login/') ||
      safeTarget === '/auth' ||
      safeTarget.startsWith('/auth/');
    destinationUrl = isPublic ? '/' : safeTarget;
  } catch (error) {
    console.error('Authentication server error:', error);
    return {
      success: false,
      error: 'An unexpected system error occurred during sign-in. Please try again later.',
    };
  }

  // Next.js redirect must be called outside try/catch to allow Next.js redirect exception to propagate
  if (destinationUrl) {
    redirect(destinationUrl);
  }

  return { success: true };
}

/**
 * Server Action: Terminates the current Supabase session, clears cookies,
 * and redirects the user to the login screen with a logged_out notice.
 */
export async function logoutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Sign out error:', error);
  }

  redirect('/login?reason=logged_out');
}
