'use server';

/**
 * CMIRS — Notification Server Actions
 *
 * Phase 4C implementation support. These actions only ever mark the signed-in user's own
 * notifications as read; the RLS policy `notifications_update_recipient` is the authority and
 * forbids changing anything except the read flag.
 */

import { revalidatePath } from 'next/cache';
import {
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from '@/utils/notifications/dal';
import type { NotificationActionState } from '@/utils/notifications/action-state';

export type { NotificationActionState };

/**
 * Marks a single notification as read.
 */
export async function markNotificationReadAction(
  prevState: NotificationActionState,
  payload: FormData | string
): Promise<NotificationActionState> {
  void prevState;

  const notificationId =
    typeof payload === 'string'
      ? payload
      : (payload.get('notificationId')?.toString() ?? '');

  if (!notificationId || notificationId.trim().length === 0) {
    return { status: 'error', message: 'A notification identifier is required.' };
  }

  const result = await markNotificationAsRead(notificationId.trim());
  if (!result.success) {
    return { status: 'error', message: result.error ?? 'The notification could not be updated.' };
  }

  revalidatePath('/notifications');
  revalidatePath('/', 'layout');

  return { status: 'success' };
}

/**
 * Marks every unread notification of the signed-in user as read.
 */
export async function markAllNotificationsReadAction(): Promise<NotificationActionState> {
  const result = await markAllNotificationsAsRead();
  if (!result.success) {
    return { status: 'error', message: result.error ?? 'Notifications could not be updated.' };
  }

  revalidatePath('/notifications');
  revalidatePath('/', 'layout');

  return { status: 'success' };
}
