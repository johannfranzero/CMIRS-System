'use client';

import React, { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  INITIAL_NOTIFICATION_ACTION_STATE,
} from '@/actions/notifications';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BellIcon, CheckCircleIcon, ClockIcon } from '@/components/ui/icons';
import type { AppNotification, NotificationType } from '@/types/notifications';

interface NotificationInboxProps {
  notifications: AppNotification[];
}

/**
 * Presentation metadata for each approved notification type.
 * The label describes the event; it never invents a count or a state.
 */
const TYPE_PRESENTATION: Record<NotificationType, { label: string; tone: string }> = {
  report_submitted: { label: 'New report', tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  report_assigned: { label: 'Assigned', tone: 'bg-blue-50 text-blue-700 border-blue-100' },
  report_reassigned: { label: 'Reassigned', tone: 'bg-blue-50 text-blue-700 border-blue-100' },
  status_changed: { label: 'Status changed', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  priority_changed: { label: 'Priority changed', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  comment_added: { label: 'Comment', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  verification_required: { label: 'Verification needed', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
  verification_complete: { label: 'Verified', tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  verification_failed: { label: 'Rework needed', tone: 'bg-rose-50 text-rose-700 border-rose-100' },
  report_cancelled: { label: 'Cancelled', tone: 'bg-rose-50 text-rose-700 border-rose-100' },
};

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotificationInbox({ notifications }: NotificationInboxProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    markNotificationReadAction,
    INITIAL_NOTIFICATION_ACTION_STATE
  );
  const [markAllPending, startMarkAll] = useTransition();
  const [localReadIds, setLocalReadIds] = useState<string[]>([]);

  useEffect(() => {
    if (state.status === 'success') {
      router.refresh();
    }
  }, [state, router]);

  const unreadCount = notifications.filter(
    (notification) => !notification.isRead && !localReadIds.includes(notification.id)
  ).length;

  function handleMarkAll() {
    startMarkAll(() => {
      void markAllNotificationsReadAction().then(() => {
        router.refresh();
      });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
            : 'No unread notifications'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleMarkAll}
          disabled={markAllPending || unreadCount === 0}
        >
          {markAllPending ? 'Marking read...' : 'Mark all as read'}
        </Button>
      </div>

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center text-center py-12">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mb-3">
              <BellIcon size={24} className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">No notifications yet</h3>
            <p className="mt-1 text-sm text-slate-500 max-w-sm">
              You will be notified here when a report you submitted is triaged, assigned, worked on,
              or verified.
            </p>
            <Link href="/reports" className="mt-4">
              <Button variant="primary" size="sm">
                View the report queue
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label="Notifications">
          {notifications.map((notification) => {
            const presentation = TYPE_PRESENTATION[notification.type] ?? {
              label: 'Update',
              tone: 'bg-slate-100 text-slate-700 border-slate-200',
            };
            const isUnread = !notification.isRead && !localReadIds.includes(notification.id);

            return (
              <li key={notification.id}>
                <Card
                  className={`transition-colors ${
                    isUnread ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200/90'
                  }`}
                >
                  <CardContent className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div
                      className={`shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center ${
                        isUnread ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}
                      aria-hidden="true"
                    >
                      {isUnread ? (
                        <BellIcon size={18} className="w-4.5 h-4.5" />
                      ) : (
                        <CheckCircleIcon size={18} className="w-4.5 h-4.5" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${presentation.tone}`}
                        >
                          {presentation.label}
                        </span>
                        {isUnread && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                            New
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <ClockIcon size={12} className="w-3 h-3" />
                          {formatTimestamp(notification.createdAt)}
                        </span>
                      </div>

                      <p className="mt-1 text-sm font-semibold text-slate-800">{notification.title}</p>
                      <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                        {notification.message}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {notification.reportId && (
                          <Link
                            href={`/reports/${notification.reportId}`}
                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                          >
                            Open the report
                          </Link>
                        )}
                        {isUnread && (
                          <form action={formAction}>
                            <input type="hidden" name="notificationId" value={notification.id} />
                            <button
                              type="submit"
                              disabled={isPending}
                              onClick={() => setLocalReadIds((ids) => [...ids, notification.id])}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
                            >
                              Mark as read
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
