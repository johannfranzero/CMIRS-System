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
    name: 'Report Issue',
    href: '/reports/new',
    icon: PlusCircleIcon,
    allowedRoles: REPORT_SUBMITTER_ROLES, // Only the reporter roles may file a report
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
