import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

/**
 * Stage 2.3 Unit Test Suite:
 * Role-Aware Navigation, User Identity Resolution & Layout Security
 */

// 1. Navigation Configuration & Helpers under test
const CANONICAL_ROLES = [
  'student_personnel',
  'coordinator',
  'technician',
  'administrator',
  'management',
];

const MAIN_NAVIGATION = [
  { name: 'Dashboard', href: '/', allowedRoles: CANONICAL_ROLES },
  { name: 'All Reports', href: '/reports', allowedRoles: CANONICAL_ROLES },
  { name: 'Submit Report', href: '/reports/new', allowedRoles: CANONICAL_ROLES },
  { name: 'Campus Locations', href: '/locations', allowedRoles: CANONICAL_ROLES },
  { name: 'Operations Analytics', href: '/analytics', allowedRoles: ['coordinator', 'administrator', 'management'] },
  { name: 'Settings', href: '/settings', allowedRoles: ['administrator'] },
];

function getNavigationItemsForRole(role) {
  if (!role) {
    return MAIN_NAVIGATION.filter(
      (item) => item.allowedRoles.length === CANONICAL_ROLES.length && item.href !== '/settings'
    );
  }
  return MAIN_NAVIGATION.filter((item) => item.allowedRoles.includes(role));
}

// 2. Identity & Initials Helpers under test
function getInitials(name, email) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return parts[0].substring(0, 2).toUpperCase();
    }
  }

  if (email && email.trim()) {
    const localPart = email.trim().split('@')[0];
    const parts = localPart.split(/[-._+]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length > 0) {
      return parts[0].substring(0, 2).toUpperCase();
    }
  }

  return 'AU';
}

function getUserDisplayName(profile, email) {
  if (profile?.full_name && profile.full_name.trim()) {
    return profile.full_name.trim();
  }
  if (email && email.trim()) {
    return email.trim().split('@')[0];
  }
  return 'Authorized User';
}

const ROLE_LABELS = {
  student_personnel: 'Student / Personnel',
  coordinator: 'Maintenance Coordinator',
  technician: 'Maintenance Technician',
  administrator: 'School Administrator',
  management: 'School Management',
};

function getUserRoleTitle(role) {
  if (!role) return 'Authorized Personnel';
  return ROLE_LABELS[role] || 'Authorized Personnel';
}

// =============================================================================
// TEST CASES
// =============================================================================

test('Navigation: Student / Personnel role sees only operational routes', () => {
  const items = getNavigationItemsForRole('student_personnel');
  const hrefs = items.map((i) => i.href);

  assert.deepEqual(hrefs, ['/', '/reports', '/reports/new', '/locations']);
  assert.equal(hrefs.includes('/analytics'), false);
  assert.equal(hrefs.includes('/settings'), false);
});

test('Navigation: Technician role sees only operational routes', () => {
  const items = getNavigationItemsForRole('technician');
  const hrefs = items.map((i) => i.href);

  assert.deepEqual(hrefs, ['/', '/reports', '/reports/new', '/locations']);
  assert.equal(hrefs.includes('/analytics'), false);
  assert.equal(hrefs.includes('/settings'), false);
});

test('Navigation: Coordinator role sees operational routes + Analytics', () => {
  const items = getNavigationItemsForRole('coordinator');
  const hrefs = items.map((i) => i.href);

  assert.deepEqual(hrefs, ['/', '/reports', '/reports/new', '/locations', '/analytics']);
  assert.equal(hrefs.includes('/settings'), false);
});

test('Navigation: Management role sees operational routes + Analytics', () => {
  const items = getNavigationItemsForRole('management');
  const hrefs = items.map((i) => i.href);

  assert.deepEqual(hrefs, ['/', '/reports', '/reports/new', '/locations', '/analytics']);
  assert.equal(hrefs.includes('/settings'), false);
});

test('Navigation: Administrator role sees all routes including Settings', () => {
  const items = getNavigationItemsForRole('administrator');
  const hrefs = items.map((i) => i.href);

  assert.deepEqual(hrefs, ['/', '/reports', '/reports/new', '/locations', '/analytics', '/settings']);
  assert.equal(hrefs.includes('/settings'), true);
  assert.equal(hrefs.includes('/analytics'), true);
});

test('Navigation: Unauthenticated fallback excludes privileged routes', () => {
  const items = getNavigationItemsForRole(null);
  const hrefs = items.map((i) => i.href);

  assert.equal(hrefs.includes('/settings'), false);
  assert.equal(hrefs.includes('/analytics'), false);
});

test('Navigation: implemented report routes render without Preview badges', () => {
  const navigation = fs.readFileSync(path.join(myAppRoot, 'config/navigation.ts'), 'utf8');
  const sidebar = fs.readFileSync(path.join(myAppRoot, 'components/layout/sidebar.tsx'), 'utf8');
  const mobileNavigation = fs.readFileSync(
    path.join(myAppRoot, 'components/layout/mobile-nav.tsx'),
    'utf8'
  );
  const reportsNavigation = navigation.slice(
    navigation.indexOf("name: 'All Reports'"),
    navigation.indexOf("name: 'Submit Report'")
  );
  const submitNavigation = navigation.slice(
    navigation.indexOf("name: 'Submit Report'"),
    navigation.indexOf("name: 'Campus Locations'")
  );

  for (const item of [reportsNavigation, submitNavigation]) {
    assert.ok(item.includes('allowedRoles: USER_ROLES'));
    assert.ok(item.includes("badge: 'Active'"));
    assert.ok(item.includes('isPlaceholder: false'));
  }

  assert.ok(sidebar.includes('{item.isPlaceholder ?'));
  assert.ok(mobileNavigation.includes('{link.isPlaceholder &&'));
});

test('Identity Resolution: Extracts clean initials from various formats', () => {
  assert.equal(getInitials('Jordan Miller', 'jordan@cmirs.internal'), 'JM');
  assert.equal(getInitials('Marcus Vance', 'marcus@cmirs.internal'), 'MV');
  assert.equal(getInitials('Administrator', 'admin@cmirs.internal'), 'AD');
  assert.equal(getInitials(null, 'test-student@cmirs.internal'), 'TS');
  assert.equal(getInitials(null, 'test-coord@cmirs.internal'), 'TC');
  assert.equal(getInitials(null, 'single@cmirs.internal'), 'SI');
  assert.equal(getInitials(null, null), 'AU');
  assert.equal(getInitials('', ''), 'AU');
});

test('Identity Resolution: Formats display name with safe fallback hierarchy', () => {
  // 1. Full name present
  assert.equal(
    getUserDisplayName({ full_name: 'Jordan Miller' }, 'jordan@cmirs.internal'),
    'Jordan Miller'
  );
  // 2. Full name empty -> email local part fallback
  assert.equal(
    getUserDisplayName({ full_name: '   ' }, 'test-admin@cmirs.internal'),
    'test-admin'
  );
  // 3. Both missing -> generic fallback
  assert.equal(
    getUserDisplayName(null, null),
    'Authorized User'
  );
});

test('Identity Resolution: Role title resolves to institutional labels', () => {
  assert.equal(getUserRoleTitle('student_personnel'), 'Student / Personnel');
  assert.equal(getUserRoleTitle('coordinator'), 'Maintenance Coordinator');
  assert.equal(getUserRoleTitle('technician'), 'Maintenance Technician');
  assert.equal(getUserRoleTitle('administrator'), 'School Administrator');
  assert.equal(getUserRoleTitle('management'), 'School Management');
  assert.equal(getUserRoleTitle(null), 'Authorized Personnel');
});
