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
  AnalyticsIcon,
  SettingsIcon,
  CloseIcon,
  MenuIcon,
} from '@/components/ui/icons';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}

export function MobileNav({ isOpen, onClose, onOpen }: MobileNavProps) {
  const pathname = usePathname();

  // Close drawer on path change or Esc key
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const navLinks = [
    {
      name: 'Dashboard',
      href: '/',
      icon: DashboardIcon,
      isPlaceholder: false,
    },
    {
      name: 'All Reports',
      href: '/reports',
      icon: ReportsIcon,
      isPlaceholder: true,
    },
    {
      name: 'Submit New Report',
      href: '/reports/new',
      icon: PlusCircleIcon,
      isPlaceholder: true,
    },
    {
      name: 'Campus Locations',
      href: '/locations',
      icon: LocationsIcon,
      isPlaceholder: true,
    },
    {
      name: 'Operations Analytics',
      href: '/analytics',
      icon: AnalyticsIcon,
      isPlaceholder: true,
    },
    {
      name: 'System Settings',
      href: '/settings',
      icon: SettingsIcon,
      isPlaceholder: true,
    },
  ];

  return (
    <>
      {/* 1. Mobile Bottom Navigation Bar (app-like experience) */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-1.5 flex items-center justify-around shadow-lg safe-bottom"
        aria-label="Mobile Bottom Navigation"
      >
        <Link
          href="/"
          className={`flex flex-col items-center py-1 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
            pathname === '/'
              ? 'text-indigo-600 font-semibold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <DashboardIcon className="w-5 h-5 mb-0.5" />
          <span>Dashboard</span>
        </Link>

        <Link
          href="/reports"
          className={`flex flex-col items-center py-1 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
            pathname.startsWith('/reports') && pathname !== '/reports/new'
              ? 'text-indigo-600 font-semibold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <ReportsIcon className="w-5 h-5 mb-0.5" />
          <span>Reports</span>
        </Link>

        <Link
          href="/reports/new"
          className="flex flex-col items-center -mt-4 group"
          title="Submit Report"
        >
          <div className="w-11 h-11 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md group-active:scale-95 transition-transform">
            <PlusCircleIcon className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-semibold text-indigo-700 mt-1">Submit</span>
        </Link>

        <Link
          href="/locations"
          className={`flex flex-col items-center py-1 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
            pathname === '/locations'
              ? 'text-indigo-600 font-semibold'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <LocationsIcon className="w-5 h-5 mb-0.5" />
          <span>Locations</span>
        </Link>

        <button
          type="button"
          onClick={onOpen}
          className="flex flex-col items-center py-1 px-2.5 rounded-lg text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
          aria-label="Open more navigation options"
        >
          <MenuIcon className="w-5 h-5 mb-0.5" />
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
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer content */}
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {/* Header */}
            <div className="h-16 px-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CmirsLogo className="w-7 h-7" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">CMIRS</h2>
                  <p className="text-[10px] text-slate-500">Campus Maintenance</p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close navigation drawer"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Nav list */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        className={
                          isActive ? 'text-indigo-600' : 'text-slate-400'
                        }
                      />
                      <span>{link.name}</span>
                    </div>

                    {link.isPlaceholder && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500">
                        Preview
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Profile footer in drawer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                JM
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-slate-900 truncate">
                  Jordan Miller
                </span>
                <span className="text-[11px] text-indigo-700 font-medium">
                  Maintenance Coordinator
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
