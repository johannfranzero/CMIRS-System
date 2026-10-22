import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExclamationTriangleIcon } from '@/components/ui/icons';
import { getNotifications } from '@/utils/notifications/dal';
import { NotificationInbox } from '@/components/notifications/notification-inbox';
import type { AppNotification } from '@/types/notifications';

export const metadata: Metadata = {
  title: 'Notifications — CMIRS',
  description: 'Your campus maintenance and incident notifications.',
};

export const instant = false;

/**
 * Notification Inbox.
 *
 * Every row is a real notification row created by the notification-bearing lifecycle command
 * RPCs and readable only by its recipient (RLS `notifications_select`). A failed read renders
 * an error state — it is never presented as an empty inbox.
 */
export default async function NotificationsPage() {
  const result = await getNotifications();

  return (
    <AppShell pageTitle="Notifications">
      <div className="max-w-4xl mx-auto py-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Your notifications</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {result.error
                ? 'Notification delivery status is currently unavailable.'
                : `${result.unreadCount} unread of ${result.notifications.length} shown`}
            </p>
          </div>
          <Link href="/reports">
            <Button variant="outline" size="sm">
              Back to reports
            </Button>
          </Link>
        </div>

        {result.error ? (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="flex flex-col items-center text-center py-10">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-600 mb-3">
                <ExclamationTriangleIcon size={24} className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-slate-800">Notifications could not be loaded</h3>
              <p className="mt-1 text-sm text-amber-800 max-w-md">{result.error}</p>
              <p className="mt-2 text-xs text-slate-500 max-w-md">
                This is a database read failure, not an empty inbox.
              </p>
            </CardContent>
          </Card>
        ) : (
          <NotificationInbox notifications={result.notifications as AppNotification[]} />
        )}
      </div>
    </AppShell>
  );
}
