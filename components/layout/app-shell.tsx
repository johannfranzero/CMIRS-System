import React from 'react';
import { getCurrentUserAndProfile } from '@/utils/auth/server';
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
 */
export async function AppShell({
  children,
  pageTitle = 'Campus Operations',
  user,
}: AppShellProps) {
  const resolvedUser = user !== undefined ? user : await getCurrentUserAndProfile();

  return (
    <AppShellClient user={resolvedUser} pageTitle={pageTitle}>
      {children}
    </AppShellClient>
  );
}
