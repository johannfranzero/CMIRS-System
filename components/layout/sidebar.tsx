'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CmirsLogo,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@/components/ui/icons';
import { AuthenticatedUser } from '@/types/auth';
import { getNavigationItemsForRole } from '@/config/navigation';
import { getInitials, getUserDisplayName, getUserRoleTitle } from '@/utils/auth/user';
import { LogoutButton } from '@/components/auth/logout-button';

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  user?: AuthenticatedUser | null;
}

export function Sidebar({ isCollapsed, onToggleCollapse, user }: SidebarProps) {
  const pathname = usePathname();

  const navigationItems = getNavigationItemsForRole(user?.profile?.role);
  const initials = getInitials(user?.profile?.full_name, user?.email);
  const displayName = getUserDisplayName(user?.profile, user?.email);
  const roleTitle = getUserRoleTitle(user?.profile?.role);

  return (
    <aside
      className={`hidden lg:flex flex-col border-r border-slate-200/90 bg-white transition-all duration-200 ease-in-out shrink-0 sticky top-0 h-screen z-20 overflow-x-hidden ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
      aria-label="Main Navigation"
    >
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
        <Link
          href="/"
          className={`flex items-center gap-3 overflow-hidden transition-opacity ${
            isCollapsed ? 'justify-center w-full' : ''
          }`}
          title="CMIRS - Campus Operations"
        >
          <CmirsLogo className="w-8 h-8 shrink-0 shadow-2xs rounded-lg" size={32} />
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-base font-bold text-slate-900 tracking-tight leading-none">
                CMIRS
              </span>
              <span className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                Campus Maintenance
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Role-Filtered Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-none">
        <div className="mb-2">
          {!isCollapsed && (
            <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Operations Menu
            </p>
          )}
        </div>

        {navigationItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative w-full overflow-hidden ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              } ${isCollapsed ? 'justify-center px-2' : ''}`}
              title={isCollapsed ? `${item.name} (${item.badge ?? ''})` : undefined}
            >
              <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                <Icon
                  size={20}
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    isActive
                      ? 'text-indigo-600'
                      : 'text-slate-400 group-hover:text-slate-600'
                  }`}
                />
              </div>

              {!isCollapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="truncate">{item.name}</span>
                  {item.isPlaceholder ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 shrink-0">
                      Preview
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                  )}
                </div>
              )}

              {/* Active pill indicator */}
              {isActive && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-indigo-600 rounded-r-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Verified Role & Persona in Sidebar Footer with Logout Integration */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/70 shrink-0">
        {!isCollapsed ? (
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs"
                title={`${displayName} (${roleTitle})`}
              >
                {initials}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-slate-800 truncate" title={displayName}>
                  {displayName}
                </span>
                <span className="text-[10px] text-indigo-700 font-medium truncate" title={roleTitle}>
                  {roleTitle}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {/* Logout button */}
              <LogoutButton variant="icon" />

              {/* Collapse toggle button */}
              <button
                onClick={onToggleCollapse}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <ChevronLeftIcon size={16} className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs cursor-default"
              title={`${displayName} (${roleTitle})`}
            >
              {initials}
            </div>

            {/* Logout button in collapsed mode */}
            <LogoutButton variant="icon" />

            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronRightIcon size={16} className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
