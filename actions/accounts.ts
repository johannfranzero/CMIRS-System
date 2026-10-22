'use server';

/**
 * CMIRS — Administrator Account Management Server Actions
 *
 * Phase 4E: an administrator may change the operational state of another institutional
 * account (its role and/or whether it may sign in). The change and its audit record are
 * written by the hardened database command
 * `public.admin_update_profile_operational_state(...)` in a single transaction.
 *
 * Guarantees enforced here and in the database:
 *   * the caller must be an active administrator (checked server-side, never from the client);
 *   * an administrator may never alter their own account;
 *   * a role change requires a written reason;
 *   * a client-supplied role is validated against the canonical role list.
 */

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/utils/auth/server';
import { createClient } from '@/utils/supabase/server';
import { describeLifecycleRpcError } from '@/utils/reports/lifecycle-rpc';
import { USER_ROLES, type UserRole } from '@/types/auth';

export interface AccountManagementActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  profileId?: string;
}

export const INITIAL_ACCOUNT_MANAGEMENT_STATE: AccountManagementActionState = { status: 'idle' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Changes the role and/or activation state of another institutional account.
 */
export async function updateInstitutionalAccountAction(
  _prevState: AccountManagementActionState,
  payload: FormData
): Promise<AccountManagementActionState> {
  const profileId = payload.get('profileId')?.toString()?.trim() ?? '';
  const role = payload.get('role')?.toString()?.trim() ?? '';
  const isActiveRaw = payload.get('isActive')?.toString();
  const reason = payload.get('reason')?.toString()?.trim() ?? '';

  if (!UUID_PATTERN.test(profileId)) {
    return { status: 'error', message: 'A valid account identifier is required.' };
  }

  if (!USER_ROLES.includes(role as UserRole)) {
    return { status: 'error', message: 'A valid institutional role is required.' };
  }

  const isActive = isActiveRaw === 'true' || isActiveRaw === 'on';

  // Server-side role gate. The client cannot influence this.
  const administrator = await requireRole(['administrator'], '/settings');

  if (administrator.id === profileId) {
    return {
      status: 'error',
      message: 'An administrator may not alter their own account.',
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_update_profile_operational_state', {
      p_profile_id: profileId,
      p_role: role,
      p_is_active: isActive,
      p_reason: reason || null,
    });

    if (error) {
      console.error('[admin] admin_update_profile_operational_state failed:', error.message);
      return {
        status: 'error',
        message: describeLifecycleRpcError(error, 'The account could not be updated.'),
        profileId,
      };
    }

    revalidatePath('/settings');
    revalidatePath('/', 'layout');

    const result = data as { role_changed?: boolean } | null;
    return {
      status: 'success',
      profileId,
      message: result?.role_changed
        ? 'The account role was updated and the change was recorded in the audit trail.'
        : 'The account status was updated.',
    };
  } catch (err) {
    console.error('[admin] account update unexpected exception:', err);
    return {
      status: 'error',
      message: 'An unexpected error occurred while updating the account.',
      profileId,
    };
  }
}
