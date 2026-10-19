'use client';

import React from 'react';
import Link from 'next/link';
import { MenuIcon, BellIcon, PlusCircleIcon, CmirsLogo } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  title?: string;
}

export function Header({ onOpenMobileMenu, title = 'Campus Operations' }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4">
      {/* Left: Mobile hamburger & Logo / Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-colors"
          aria-label="Open navigation menu"
        >
          <MenuIcon className="w-5 h-5" />
        </button>

        <div className="lg:hidden flex items-center gap-2">
          <CmirsLogo className="w-7 h-7" />
          <span className="font-bold text-slate-900 text-sm">CMIRS</span>
        </div>

        <div className="hidden sm:block">
          <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
            {title}
          </h1>
          <p className="text-xs text-slate-500 hidden md:block">
            Campus Maintenance & Incident Reporting Platform
          </p>
        </div>
      </div>

      {/* Right: Quick Actions, Notifications, User Persona */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Quick Report CTA */}
        <Link href="/reports/new">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlusCircleIcon className="w-4 h-4" />}
            className="hidden sm:inline-flex"
          >
            New Report
          </Button>
        </Link>

        {/* Notifications Icon Placeholder */}
        <button
          type="button"
          className="relative p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-colors"
          aria-label="View notifications (3 unread)"
          title="3 unread notifications"
        >
          <BellIcon className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
        </button>

        {/* Separator */}
        <div className="h-6 w-px bg-slate-200 hidden sm:block" />

        {/* User Persona Profile Placeholder */}
        <div className="flex items-center gap-2.5 pl-1">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white flex items-center justify-center font-bold text-xs shadow-xs">
            JM
          </div>
          <div className="hidden md:flex flex-col text-left">
            <span className="text-xs font-semibold text-slate-900 leading-tight">
              Jordan Miller
            </span>
            <span className="text-[10px] font-medium text-indigo-700 bg-indigo-50 px-1 rounded w-fit">
              Coordinator
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
