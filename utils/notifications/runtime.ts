/**
 * CMIRS — Notification Read Runtime (Client-Injectable)
 *
 * Phase 4C implementation support.
 *
 * Notifications are created exclusively by the notification-bearing lifecycle command RPCs
 * (approved decision S-04: there is no generic insert path). This module is therefore
 * READ-ONLY apart from the recipient-scoped `is_read` flag, which the
 * `notifications_update_recipient` RLS policy explicitly permits and which it also constrains
 * (the id, type, title, message and recipient may not be altered).
 *
 * Every read is scoped by RLS to `recipient_id = auth.uid()`, so a user can never observe
 * another user's notifications.
 *
 * This module uses only relative imports so that it can be imported directly by the Node test
 * runner, exactly like `utils/reports/reference-catalogs.ts`.
 */

import { describeDatabaseError } from '../reports/transform.ts';
import type {
  AppNotification,
  NotificationInboxResult,
  NotificationType,
} from '../../types/notifications';

export interface RawNotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  report_id: string | null;
  is_read: boolean;
  created_at: string;
}

export const SELECT_NOTIFICATION_FIELDS =
  'id, type, title, message, report_id, is_read, created_at';

export interface NotificationReadClient {
  from(table: 'notifications'): {
    select(columns: string, options?: { count?: string; head?: boolean }): {
      order(column: string, options?: { ascending?: boolean }): {
        limit(count: number): PromiseLike<{
          data: RawNotificationRow[] | null;
          count?: number | null;
          error: unknown;
        }>;
      };
      eq(column: string, value: boolean): {
        select(
          columns: string,
          options?: { count?: string; head?: boolean }
        ): PromiseLike<{ count?: number | null; error: unknown }>;
        then(
          onfulfilled: (value: { count?: number | null; error: unknown }) => unknown,
          onrejected?: (reason: unknown) => unknown
        ): PromiseLike<unknown>;
      };
    };
  };
}

/**
 * Loads a user's notifications and the exact unread count.
 *
 * A failed query returns an empty list plus an error message. It never returns a fabricated
 * count, and it never reports "no notifications" for a failed read.
 */
export async function getNotificationsFromClient(
  client: NotificationReadClient,
  limit = 50
): Promise<NotificationInboxResult> {
  try {
    const { data, error } = await client
      .from('notifications')
      .select(SELECT_NOTIFICATION_FIELDS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[notifications-dal] getNotifications query error:', error);
      return {
        notifications: [],
        unreadCount: 0,
        error:
          describeDatabaseError(error) ??
          'Notifications could not be loaded right now. Please try again shortly.',
      };
    }

    const rows = (data ?? []) as RawNotificationRow[];
    const notifications: AppNotification[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      reportId: row.report_id,
      isRead: row.is_read,
      createdAt: row.created_at,
    }));

    // The unread count is derived from the same real rows that the inbox renders.
    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return { notifications, unreadCount, error: null };
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
export async function getUnreadNotificationCountFromClient(
  client: NotificationReadClient
): Promise<{ count: number; available: boolean }> {
  try {
    const headQuery = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);

    const { count, error } = headQuery as { count?: number | null; error: unknown };

    if (error) {
      console.error('[notifications-dal] getUnreadNotificationCount query error:', error);
      return { count: 0, available: false };
    }

    return { count: count ?? 0, available: true };
  } catch (err) {
    console.error('[notifications-dal] getUnreadNotificationCount unexpected exception:', err);
    return { count: 0, available: false };
  }
}
