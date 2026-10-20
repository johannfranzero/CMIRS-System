'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CmirsLogo,
  DashboardIcon,
  ReportsIcon,
  PlusCircleIcon,
  LocationsIcon,
  CloseIcon,
  MenuIcon,
} from '@/components/ui/icons';
import { AuthenticatedUser } from '@/types/auth';
import { getNavigationItemsForRole } from '@/config/navigation';
import { getInitials, getUserDisplayName, getUserRoleTitle } from '@/utils/auth/user';
import { LogoutButton } from '@/components/auth/logout-button';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
  user?: AuthenticatedUser | null;
}

export function MobileNav({ isOpen, onClose, onOpen, user }: MobileNavProps) {
  const pathname = usePathname();

  const navLinks = getNavigationItemsForRole(user?.profile?.role);
  const initials = getInitials(user?.profile?.full_name, user?.email);
  const displayName = getUserDisplayName(user?.profile, user?.email);
  const roleTitle = getUserRoleTitle(user?.profile?.role);

  // Close drawer on path change
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Handle Escape key to dismiss drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <>
      {/* 1. Mobile Bottom Navigation Bar (thumb-accessible app layout) */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-1 sm:px-3 py-1.5 flex items-center justify-around shadow-lg"
        aria-label="Mobile Bottom Navigation"
      >
        <Link
          href="/"
          className={`flex flex-col items-center py-1 px-1.5 sm:px-2 rounded-lg text-[10px] sm:text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
            pathname === '/'
              ? 'text-indigo-600 font-semibold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <DashboardIcon size={20} className="w-5 h-5 mb-0.5 shrink-0" />
          <span>Dashboard</span>
        </Link>

        <Link
          href="/reports"
          className={`flex flex-col items-center py-1 px-1.5 sm:px-2 rounded-lg text-[10px] sm:text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
            pathname === '/reports'
              ? 'text-indigo-600 font-semibold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <ReportsIcon size={20} className="w-5 h-5 mb-0.5 shrink-0" />
          <span>Reports</span>
        </Link>

        {/* Elevated Quick Submit Action */}
        <Link
          href="/reports/new"
          className="flex flex-col items-center -mt-4 group focus-visible:outline-none"
          aria-label="Submit new report"
        >
          <div className="w-11 h-11 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md group-hover:bg-indigo-700 transition-transform group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-indigo-600 group-focus-visible:ring-offset-2">
            <PlusCircleIcon size={22} className="w-5.5 h-5.5" />
          </div>
          <span className="text-[10px] font-medium text-slate-600 mt-0.5">Submit</span>
        </Link>

        <Link
          href="/locations"
          className={`flex flex-col items-center py-1 px-1.5 sm:px-2 rounded-lg text-[10px] sm:text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
            pathname === '/locations'
              ? 'text-indigo-600 font-semibold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <LocationsIcon size={20} className="w-5 h-5 mb-0.5 shrink-0" />
          <span>Locations</span>
        </Link>

        {/* More Menu Trigger (Drawer) */}
        <button
          type="button"
          onClick={onOpen}
          className="flex flex-col items-center py-1 px-1.5 sm:px-2 rounded-lg text-[10px] sm:text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
          aria-label="Open full campus menu"
        >
          <MenuIcon size={20} className="w-5 h-5 mb-0.5 shrink-0" />
          <span>More</span>
        </button>
      </nav>

      {/* 2. Slide-out Drawer Navigation */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation drawer"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-2xs transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer content */}
          <div className="relative flex-1 flex flex-col max-w-[280px] sm:max-w-xs w-4/5 bg-white shadow-2xl z-10 animate-in slide-in-from-left duration-200 overflow-x-hidden">
            {/* Header */}
            <div className="h-16 px-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <CmirsLogo size={28} className="w-7 h-7 shrink-0" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">CMIRS</h2>
                  <p className="text-[10px] text-slate-500">Campus Maintenance</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                aria-label="Close navigation drawer"
              >
                <CloseIcon size={20} className="w-5 h-5 shrink-0" />
              </button>
            </div>

            {/* Role-Filtered Navigation Links */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-none">
              <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Campus Navigation
              </p>

              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                const Icon = link.icon;

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={onClose}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                        <Icon
                          size={20}
                          className={`w-5 h-5 shrink-0 ${
                            isActive ? 'text-indigo-600' : 'text-slate-400'
                          }`}
                        />
                      </div>
                      <span className="truncate">{link.name}</span>
                    </div>

                    {link.isPlaceholder && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 shrink-0">
                        Preview
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Verified Profile & Sign Out footer in drawer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs shrink-0"
                  title={`${displayName} (${roleTitle})`}
                >
                  {initials}
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-semibold text-slate-900 truncate" title={displayName}>
                    {displayName}
                  </span>
                  <span className="text-[11px] text-indigo-700 font-medium truncate" title={roleTitle}>
                    {roleTitle}
                  </span>
                </div>
              </div>

              {/* Dedicated drawer logout button */}
              <LogoutButton variant="button" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
