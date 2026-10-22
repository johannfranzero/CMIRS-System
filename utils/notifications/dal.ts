/**
 * CMIRS — Notification Read Data Access Layer
 *
 * Phase 4C implementation support.
 *
 * Notifications are created exclusively by the notification-bearing lifecycle command RPCs
 * (approved decision S-04: there is no generic insert path). This DAL is therefore READ-ONLY
 * apart from the recipient-scoped `is_read` flag, which the `notifications_update_recipient`
 * RLS policy explicitly permits and which it also constrains (the id, type, title, message and
 * recipient may not be altered).
 *
 * Every read is scoped by RLS to `recipient_id = auth.uid()`, so a user can never observe
 * another user's notifications.
 */

import { createClient } from '@/utils/supabase/server';
import { getCurrentUserAndProfile } from '@/utils/auth/server';
import type { NotificationInboxResult } from '@/types/notifications';
import {
  getNotificationsFromClient,
  getUnreadNotificationCountFromClient,
  type NotificationReadClient,
} from './runtime';

export { getNotificationsFromClient, getUnreadNotificationCountFromClient } from './runtime';
export type { NotificationReadClient } from './runtime';

/**
 * Loads the signed-in user's notifications and the exact unread count.
 */
export async function getNotifications(limit = 50): Promise<NotificationInboxResult> {
  const user = await getCurrentUserAndProfile();
  if (!user || !user.profile?.is_active) {
    return { notifications: [], unreadCount: 0, error: 'Authentication required.' };
  }

  try {
    const supabase = await createClient();
    return await getNotificationsFromClient(supabase as unknown as NotificationReadClient, limit);
  } catch (err) {
    console.error('[notifications-dal] getNotifications unexpected exception:', err);
    return {
      notifications: [],
      unreadCount: 0,
      error: 'Notifications could not be loaded right now. Please try again shortly.',
    };
  }
}

/**
 * Loads only the unread count for the header badge.
 *
 * Returns `available: false` when the query fails; the caller then renders no badge at all
 * rather than presenting a failure as "there is nothing new".
 */
export async function getUnreadNotificationCount(): Promise<{ count: number; available: boolean }> {
  const user = await getCurrentUserAndProfile();
  if (!user || !user.profile?.is_active) {
    return { count: 0, available: false };
  }

  try {
    const supabase = await createClient();
    return await getUnreadNotificationCountFromClient(
      supabase as unknown as NotificationReadClient
    );
  } catch (err) {
    console.error('[notifications-dal] getUnreadNotificationCount unexpected exception:', err);
    return { count: 0, available: false };
  }
}

/**
 * Marks one notification as read for its recipient.
 *
 * The `notifications_update_recipient` RLS policy restricts the update to the recipient and
 * forbids changing anything except the read flag.
 */
export async function markNotificationAsRead(
  notificationId: string
): Promise<{ success: boolean; error: string | null }> {
  const user = await getCurrentUserAndProfile();
  if (!user || !user.profile?.is_active) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('is_read', false);

    if (error) {
      console.error('[notifications-dal] markNotificationAsRead error:', error.message);
      return {
        success: false,
        error: 'The notification could not be marked as read.',
      };
    }

    return { success: true, error: null };
  } catch (err) {
    console.error('[notifications-dal] markNotificationAsRead unexpected exception:', err);
    return { success: false, error: 'The notification could not be marked as read.' };
  }
}

/**
 * Marks every unread notification of the recipient as read.
 */
export async function markAllNotificationsAsRead(): Promise<{
  success: boolean;
  error: string | null;
}> {
  const user = await getCurrentUserAndProfile();
  if (!user || !user.profile?.is_active) {
    return { success: false, error: 'Authentication required.' };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false);

    if (error) {
      console.error('[notifications-dal] markAllNotificationsAsRead error:', error.message);
      return {
        success: false,
        error: 'Notifications could not be updated.',
      };
    }

    return { success: true, error: null };
  } catch (err) {
    console.error('[notifications-dal] markAllNotificationsAsRead unexpected exception:', err);
    return { success: false, error: 'Notifications could not be updated.' };
  }
}
