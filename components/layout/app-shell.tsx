import React from 'react';
import { getCurrentUserAndProfile } from '@/utils/auth/server';
import { getUnreadNotificationCount } from '@/utils/notifications/dal';
import { AppShellClient } from './app-shell-client';
import { AuthenticatedUser } from '@/types/auth';

export interface AppShellProps {
  children: React.ReactNode;
  pageTitle?: string;
  user?: AuthenticatedUser | null;
}

/**
 * Server Component: Top-level application shell for authenticated CMIRS routes.
 * Retrieves the server-verified active user session and profile, then passes it
 * into the interactive client layout shell.
 *
 * Phase 4C: the unread notification badge is read here, on the server, from the signed-in
 * user's own unread rows. A failed read yields `null`, which renders no badge at all rather
 * than a fabricated count.
 */
export async function AppShell({
  children,
  pageTitle = 'Campus Operations',
  user,
}: AppShellProps) {
  const resolvedUser = user !== undefined ? user : await getCurrentUserAndProfile();
  const { count, available } = await getUnreadNotificationCount();

  return (
    <AppShellClient
      user={resolvedUser}
      pageTitle={pageTitle}
      unreadNotificationCount={available ? count : null}
    >
      {children}
    </AppShellClient>
  );
}
