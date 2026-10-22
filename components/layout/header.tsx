'use client';

import React from 'react';
import Link from 'next/link';
import { MenuIcon, BellIcon, PlusCircleIcon, CmirsLogo } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { AuthenticatedUser } from '@/types/auth';
import { getInitials, getUserDisplayName, getUserRoleTitle } from '@/utils/auth/user';
import { LogoutButton } from '@/components/auth/logout-button';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  title?: string;
  user?: AuthenticatedUser | null;
  /**
   * Phase 4C: the genuine unread notification count for the signed-in user, derived
   * server-side from that user's own unread rows. `null` means the count could not be read.
   */
  unreadNotificationCount?: number | null;
}

export function Header({
  onOpenMobileMenu,
  title = 'Campus Operations',
  user,
  unreadNotificationCount = null,
}: HeaderProps) {
  const initials = getInitials(user?.profile?.full_name, user?.email);
  const displayName = getUserDisplayName(user?.profile, user?.email);
  const roleTitle = getUserRoleTitle(user?.profile?.role);
  // `null` means the unread count could not be read; no badge is rendered in that case.
  const unreadCount = unreadNotificationCount ?? 0;

  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
      {/* Left: Mobile hamburger & Logo / Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-colors shrink-0"
          aria-label="Open navigation menu"
        >
          <MenuIcon size={20} className="w-5 h-5 shrink-0" />
        </button>

        <div className="lg:hidden flex items-center gap-2 shrink-0">
          <CmirsLogo size={28} className="w-7 h-7 shrink-0" />
          <span className="font-bold text-slate-900 text-sm">CMIRS</span>
        </div>

        <div className="hidden sm:block min-w-0">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight truncate">
            {title}
          </h1>
          <p className="text-xs text-slate-500 hidden md:block truncate">
            Campus Maintenance & Incident Reporting Platform
          </p>
        </div>
      </div>

      {/* Right: Quick Actions, Notifications, Verified User Persona & Logout */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Quick Report CTA (All authenticated roles can submit reports) */}
        <Link href="/reports/new">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusCircleIcon size={16} className="w-4 h-4 shrink-0" />}
            className="hidden sm:inline-flex"
          >
            New Report
          </Button>
        </Link>

        {/* Notifications control.
            Phase 4D.1 removed the decorative red "unread" dot because it implied a live
            notification count that no backend provided.
            Phase 4C: the backend now persists real notifications, so the badge shows the
            genuine unread count that the server derived from the recipient's own unread rows.
            When the count could not be read, no badge is rendered at all rather than a
            fabricated zero. */}
        <Link
          href="/notifications"
          className="relative p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-colors"
          aria-label={
            unreadCount > 0
              ? `Notifications (${unreadNotificationCount} unread)`
              : 'Notifications'
          }
          title="Campus Notifications"
        >
          <BellIcon size={20} className="w-5 h-5 shrink-0" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        {/* Separator */}
        <div className="h-6 w-px bg-slate-200 hidden sm:block" />

        {/* Verified User Persona Profile Display */}
        <div className="flex items-center gap-2.5 pl-1">
          <div
            className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white flex items-center justify-center font-bold text-xs shadow-2xs shrink-0"
            title={`${displayName} (${roleTitle})`}
          >
            {initials}
          </div>

          <div className="hidden md:flex flex-col text-left max-w-[140px]">
            <span className="text-xs font-semibold text-slate-900 leading-tight truncate" title={displayName}>
              {displayName}
            </span>
            <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 px-1 rounded w-fit truncate mt-0.5" title={roleTitle}>
              {roleTitle}
            </span>
          </div>
        </div>

        {/* Header Logout Control */}
        <div className="pl-1 border-l border-slate-200/80 hidden sm:block">
          <LogoutButton variant="compact" showLabel={true} />
        </div>
      </div>
    </header>
  );
}
