import React from 'react';
import { UserRole, USER_ROLES, REPORT_SUBMITTER_ROLES } from '@/types/auth';
import {
  DashboardIcon,
  ReportsIcon,
  PlusCircleIcon,
  LocationsIcon,
  AnalyticsIcon,
  SettingsIcon,
  BellIcon,
  IconProps,
} from '@/components/ui/icons';

/**
 * Type definition for a navigation item in the CMIRS application shell.
 */
export interface NavigationItem {
  name: string;
  href: string;
  icon: (props: IconProps) => React.JSX.Element;
  allowedRoles: readonly UserRole[];
  badge?: string;
  isPlaceholder?: boolean;
}

/**
 * Centralized navigation configuration mapping routes to permitted canonical roles.
 * Source of truth: docs/frontend/PHASE_2_AUTH_RBAC_PLAN.md
 */
export const MAIN_NAVIGATION: readonly NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/',
    icon: DashboardIcon,
    allowedRoles: USER_ROLES,
    badge: 'Active',
    isPlaceholder: false,
  },
  {
    name: 'All Reports',
    href: '/reports',
    icon: ReportsIcon,
    allowedRoles: USER_ROLES,
    badge: 'Active',
    isPlaceholder: false,
  },
  {
    name: 'Submit Report',
    href: '/reports/new',
    icon: PlusCircleIcon,
    allowedRoles: REPORT_SUBMITTER_ROLES, // Only the reporter roles may file a report
    badge: 'Active',
    isPlaceholder: false,
  },
  {
    name: 'Notifications',
    href: '/notifications',
    icon: BellIcon,
    allowedRoles: USER_ROLES, // Phase 4C: every authenticated role has its own recipient-scoped inbox
    badge: 'Active',
    isPlaceholder: false,
  },
  {
    name: 'Campus Locations',
    href: '/locations',
    icon: LocationsIcon,
    allowedRoles: USER_ROLES,
    badge: 'Active',
    isPlaceholder: false,
  },
  {
    name: 'Operations Analytics',
    href: '/analytics',
    icon: AnalyticsIcon,
    allowedRoles: ['coordinator', 'administrator', 'management'],
    badge: 'Active',
    isPlaceholder: false,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: SettingsIcon,
    allowedRoles: ['administrator'],
    badge: 'Active',
    isPlaceholder: false,
  },
] as const;

/**
 * Development-time invariant.
 *
 * The navigation is rendered with a key derived from the destination. Two entries pointing at
 * the same destination therefore produced the React warning
 * "Encountered two children with the same key" and could make the application shell drop or
 * duplicate links. The invariant is checked here so that the mistake surfaces immediately
 * during development instead of in the browser console.
 */
if (process.env.NODE_ENV !== 'production') {
  const seenDestinations = new Set<string>();
  for (const item of MAIN_NAVIGATION) {
    if (seenDestinations.has(item.href)) {
      console.error(
        `[CMIRS] Duplicate navigation destination "${item.href}" (entry "${item.name}"). ` +
          'Each navigation entry must point at a distinct destination.'
      );
    }
    seenDestinations.add(item.href);
  }
}

/**
 * Filters the centralized navigation list to include only routes
 * authorized for the specified role.
 *
 * If no role is provided, only safe baseline routes are returned.
 */
export function getNavigationItemsForRole(role?: UserRole | null): NavigationItem[] {
  if (!role) {
    // Unauthenticated/fallback: return only items that are accessible to all roles excluding admin
    return MAIN_NAVIGATION.filter(
      (item) => item.allowedRoles.length === USER_ROLES.length && item.href !== '/settings'
    );
  }

  return MAIN_NAVIGATION.filter((item) => item.allowedRoles.includes(role));
}
