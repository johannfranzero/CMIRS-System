/**
 * CMIRS — Notification Types
 *
 * Phase 4C: the in-app notification contract. A notification is created by the
 * notification-bearing lifecycle command RPCs and is readable ONLY by its recipient
 * (RLS `notifications_select`: `recipient_id = auth.uid()`).
 */

export type NotificationType =
  | 'report_submitted'
  | 'report_assigned'
  | 'status_changed'
  | 'priority_changed'
  | 'comment_added'
  | 'verification_required'
  | 'verification_complete'
  | 'verification_failed'
  | 'report_reassigned'
  | 'report_cancelled';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  reportId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationInboxResult {
  notifications: AppNotification[];
  unreadCount: number;
  error: string | null;
}
