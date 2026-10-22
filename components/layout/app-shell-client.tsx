'use client';

import React, { useState, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { MobileNav } from './mobile-nav';
import { AuthenticatedUser } from '@/types/auth';

interface AppShellClientProps {
  children: React.ReactNode;
  pageTitle?: string;
  user?: AuthenticatedUser | null;
  /**
   * Phase 4C: the genuine unread notification count for the signed-in user, read on the
   * server. `null` means the count could not be read, and no badge is rendered in that case.
   */
  unreadNotificationCount?: number | null;
}

export function AppShellClient({
  children,
  pageTitle = 'Campus Operations',
  user,
  unreadNotificationCount = null,
}: AppShellClientProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const handleOpenMobileNav = useCallback(() => setIsMobileNavOpen(true), []);
  const handleCloseMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  const handleToggleSidebar = useCallback(() => setIsSidebarCollapsed((prev) => !prev), []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Collapsible Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        user={user}
      />

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <Header
          title={pageTitle}
          onOpenMobileMenu={handleOpenMobileNav}
          user={user}
          unreadNotificationCount={unreadNotificationCount}
          isMobileNavOpen={isMobileNavOpen}
        />

        {/* Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-24 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation & Slide-out Drawer */}
      <MobileNav
        isOpen={isMobileNavOpen}
        onClose={handleCloseMobileNav}
        onOpen={handleOpenMobileNav}
        user={user}
      />
    </div>
  );
}
