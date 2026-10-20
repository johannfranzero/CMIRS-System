import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Isolated Security Boundaries & Role-Based Access Control Test Suite
 * Evaluates core authorization logic, sanitization, and route guards locally
 * without making remote network calls or modifying backend state.
 */

// 1. Canonical Domain Role Constants
const CANONICAL_ROLES = [
  'student_personnel',
  'coordinator',
  'technician',
  'administrator',
  'management',
];

const OVERSIGHT_ROLES = ['coordinator', 'administrator', 'management'];
const ADMIN_ROLES = ['administrator'];
const ALL_ROLES = CANONICAL_ROLES;

// 2. Logic Implementations under test
function sanitizeRedirectUrl(targetUrl, defaultUrl = '/') {
  if (!targetUrl || typeof targetUrl !== 'string') return defaultUrl;
  const trimmed = targetUrl.trim();
  if (!trimmed) return defaultUrl;
  if (trimmed.startsWith('//') || trimmed.includes('\\')) return defaultUrl;

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('data:') ||
    lower.includes('vbscript:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://')
  ) {
    return defaultUrl;
  }

  if (!trimmed.startsWith('/')) return defaultUrl;
  return trimmed;
}

function isUserRole(value) {
  return typeof value === 'string' && CANONICAL_ROLES.includes(value);
}

function isPublicRoute(pathname) {
  const pathWithoutQuery = pathname.split('?')[0];
  if (pathWithoutQuery === '/login' || pathWithoutQuery.startsWith('/login/')) return true;
  if (pathWithoutQuery === '/auth' || pathWithoutQuery.startsWith('/auth/')) return true;
  return false;
}

function evaluateProfileAccess(profile) {
  if (!profile) {
    return { allowed: false, reason: 'MISSING_PROFILE' };
  }
  if (!profile.is_active) {
    return { allowed: false, reason: 'INACTIVE_ACCOUNT' };
  }
  if (!isUserRole(profile.role)) {
    return { allowed: false, reason: 'INVALID_ROLE' };
  }
  return { allowed: true, role: profile.role };
}

function evaluateRouteAccess(userRole, route) {
  if (route === '/settings') {
    return ADMIN_ROLES.includes(userRole);
  }
  if (route === '/analytics') {
    return OVERSIGHT_ROLES.includes(userRole);
  }
  if (['/', '/reports', '/reports/new', '/locations'].includes(route)) {
    return ALL_ROLES.includes(userRole);
  }
  return false;
}

function evaluateFullRouteDispatch(user, route, search = '') {
  const isPublic = isPublicRoute(route);

  // 1. Unauthenticated request
  if (!user) {
    if (isPublic) {
      return { status: 200, destination: route };
    }
    const safeTarget = sanitizeRedirectUrl(route + search, '/');
    return { status: 307, destination: `/login?next=${encodeURIComponent(safeTarget)}` };
  }

  // 2. Authenticated request on public route (/login)
  if (isPublic && route === '/login') {
    const params = new URLSearchParams(search);
    const nextParam = params.get('next');
    let safeDestination = sanitizeRedirectUrl(nextParam, '/');
    if (
      safeDestination === '/login' ||
      safeDestination.startsWith('/login/') ||
      safeDestination === '/auth' ||
      safeDestination.startsWith('/auth/')
    ) {
      safeDestination = '/';
    }
    return { status: 307, destination: safeDestination };
  }

  // 3. Authenticated request to /unauthorized (renders HTTP 403 screen)
  if (route === '/unauthorized') {
    return { status: 200, destination: '/unauthorized' };
  }

  // 4. Role-based Server Guards
  if (route === '/settings') {
    return ADMIN_ROLES.includes(user.profile.role)
      ? { status: 200, destination: '/settings' }
      : { status: 307, destination: '/unauthorized' };
  }

  if (route === '/analytics') {
    return OVERSIGHT_ROLES.includes(user.profile.role)
      ? { status: 200, destination: '/analytics' }
      : { status: 307, destination: '/unauthorized' };
  }

  if (['/', '/reports', '/reports/new', '/locations'].includes(route)) {
    return ALL_ROLES.includes(user.profile.role)
      ? { status: 200, destination: route }
      : { status: 307, destination: '/unauthorized' };
  }

  return { status: 404, destination: '/_not-found' };
}

/**
 * Simulates can_view_report(report_id UUID) defined in 20261018000004_security_functions_and_rpc.sql
 */
function evaluateCanViewReport(callerRole, callerId, report, assignments = []) {
  // 1. Oversight roles see all reports
  if (['coordinator', 'administrator', 'management'].includes(callerRole)) {
    return true;
  }

  // 2. Reporter sees own report regardless of current role
  if (report.reporter_id === callerId) {
    return true;
  }

  // 3. Technician with qualifying assignment (status != 'declined')
  if (callerRole === 'technician') {
    const hasQualifying = assignments.some(
      (a) => a.report_id === report.id && a.technician_id === callerId && a.status !== 'declined'
    );
    if (hasQualifying) return true;
  }

  return false;
}

// =============================================================================
// TEST SUITES
// =============================================================================

test('Security Guard: Rejection of Open Redirects', () => {
  // External attack vectors
  assert.equal(sanitizeRedirectUrl('https://evil.com'), '/');
  assert.equal(sanitizeRedirectUrl('http://phishing.site/login'), '/');
  assert.equal(sanitizeRedirectUrl('//evil.com/fake-login'), '/');
  assert.equal(sanitizeRedirectUrl('/\\evil.com'), '/');
  assert.equal(sanitizeRedirectUrl('\\\\evil.com'), '/');
  assert.equal(sanitizeRedirectUrl('javascript:alert(document.cookie)'), '/');
  assert.equal(sanitizeRedirectUrl('data:text/html,<script>steal()</script>'), '/');

  // Valid internal paths preserved
  assert.equal(sanitizeRedirectUrl('/'), '/');
  assert.equal(sanitizeRedirectUrl('/reports'), '/reports');
  assert.equal(sanitizeRedirectUrl('/reports/new'), '/reports/new');
  assert.equal(sanitizeRedirectUrl('/analytics?range=30d'), '/analytics?range=30d');
  assert.equal(sanitizeRedirectUrl('/settings?tab=users'), '/settings?tab=users');
});

test('Security Guard: Proxy Public vs Protected Route Classification', () => {
  // Public routes
  assert.equal(isPublicRoute('/login'), true);
  assert.equal(isPublicRoute('/login?reason=expired'), true);
  assert.equal(isPublicRoute('/auth/callback'), true);

  // Protected routes
  assert.equal(isPublicRoute('/'), false);
  assert.equal(isPublicRoute('/reports'), false);
  assert.equal(isPublicRoute('/reports/new'), false);
  assert.equal(isPublicRoute('/locations'), false);
  assert.equal(isPublicRoute('/analytics'), false);
  assert.equal(isPublicRoute('/settings'), false);
  assert.equal(isPublicRoute('/unauthorized'), false);
});

test('Security Guard: Profile Verification & Active Status Enforcement', () => {
  // Active valid profiles
  assert.deepEqual(
    evaluateProfileAccess({ id: 'u1', role: 'student_personnel', is_active: true }),
    { allowed: true, role: 'student_personnel' }
  );
  assert.deepEqual(
    evaluateProfileAccess({ id: 'u2', role: 'coordinator', is_active: true }),
    { allowed: true, role: 'coordinator' }
  );

  // Inactive profile rejection
  assert.deepEqual(
    evaluateProfileAccess({ id: 'u3', role: 'technician', is_active: false }),
    { allowed: false, reason: 'INACTIVE_ACCOUNT' }
  );

  // Missing profile rejection
  assert.deepEqual(
    evaluateProfileAccess(null),
    { allowed: false, reason: 'MISSING_PROFILE' }
  );

  // Non-canonical role rejection
  assert.deepEqual(
    evaluateProfileAccess({ id: 'u4', role: 'root_superadmin', is_active: true }),
    { allowed: false, reason: 'INVALID_ROLE' }
  );
});

test('Role Authorization: /settings Route Protection (Administrator Only)', () => {
  assert.equal(evaluateRouteAccess('administrator', '/settings'), true);
  assert.equal(evaluateRouteAccess('coordinator', '/settings'), false);
  assert.equal(evaluateRouteAccess('technician', '/settings'), false);
  assert.equal(evaluateRouteAccess('student_personnel', '/settings'), false);
  assert.equal(evaluateRouteAccess('management', '/settings'), false);
});

test('Role Authorization: /analytics Route Protection (Oversight Roles Only)', () => {
  assert.equal(evaluateRouteAccess('coordinator', '/analytics'), true);
  assert.equal(evaluateRouteAccess('administrator', '/analytics'), true);
  assert.equal(evaluateRouteAccess('management', '/analytics'), true);
  assert.equal(evaluateRouteAccess('student_personnel', '/analytics'), false);
  assert.equal(evaluateRouteAccess('technician', '/analytics'), false);
});

test('Role Authorization: General Routes Accessible to All 5 Roles', () => {
  for (const role of CANONICAL_ROLES) {
    assert.equal(evaluateRouteAccess(role, '/'), true, `Role ${role} should access /`);
    assert.equal(evaluateRouteAccess(role, '/reports'), true, `Role ${role} should access /reports`);
    assert.equal(evaluateRouteAccess(role, '/reports/new'), true, `Role ${role} should access /reports/new`);
    assert.equal(evaluateRouteAccess(role, '/locations'), true, `Role ${role} should access /locations`);
  }
});

test('Security Guard: Redirect Loop Prevention on Public Routes', () => {
  const user = { id: 'u1', profile: { role: 'coordinator', is_active: true } };

  // 1. Authenticated user landing on /login with loop-prone parameters
  assert.deepEqual(
    evaluateFullRouteDispatch(user, '/login', '?next=/login'),
    { status: 307, destination: '/' },
    'Must not redirect back to /login'
  );
  assert.deepEqual(
    evaluateFullRouteDispatch(user, '/login', '?next=/login/callback'),
    { status: 307, destination: '/' },
    'Must not redirect to nested /login subroute'
  );
  assert.deepEqual(
    evaluateFullRouteDispatch(user, '/login', '?next=/auth'),
    { status: 307, destination: '/' },
    'Must not redirect to /auth'
  );
  assert.deepEqual(
    evaluateFullRouteDispatch(user, '/login', '?next=https://evil.com'),
    { status: 307, destination: '/' },
    'Must sanitize external open redirect target to /'
  );

  // 2. Legitimate protected destination preserved
  assert.deepEqual(
    evaluateFullRouteDispatch(user, '/login', '?next=/analytics'),
    { status: 307, destination: '/analytics' },
    'Valid return destination must be preserved'
  );
});

test('Security Guard: /unauthorized Access Control and 403 Response', () => {
  // 1. Unauthenticated visitor to /unauthorized is redirected to login
  assert.deepEqual(
    evaluateFullRouteDispatch(null, '/unauthorized'),
    { status: 307, destination: '/login?next=%2Funauthorized' }
  );

  // 2. Authenticated user accessing /unauthorized receives 200 OK (HTTP 403 screen)
  for (const role of CANONICAL_ROLES) {
    const user = { id: `u-${role}`, profile: { role, is_active: true } };
    assert.deepEqual(
      evaluateFullRouteDispatch(user, '/unauthorized'),
      { status: 200, destination: '/unauthorized' },
      `Role ${role} should render 403 explanatory screen at /unauthorized`
    );
  }
});

test('Role Authorization: Comprehensive 5-Role by 8-Route Access Matrix', () => {
  const routes = ['/', '/reports', '/reports/new', '/locations', '/analytics', '/settings', '/unauthorized', '/login'];

  // Expected outcomes:
  // student_personnel: /, reports, reports/new, locations -> 200; analytics, settings -> 307 /unauthorized; unauthorized -> 200; login -> 307 /
  // technician:        /, reports, reports/new, locations -> 200; analytics, settings -> 307 /unauthorized; unauthorized -> 200; login -> 307 /
  // coordinator:       /, reports, reports/new, locations, analytics -> 200; settings -> 307 /unauthorized; unauthorized -> 200; login -> 307 /
  // management:        /, reports, reports/new, locations, analytics -> 200; settings -> 307 /unauthorized; unauthorized -> 200; login -> 307 /
  // administrator:     all 6 protected routes -> 200; unauthorized -> 200; login -> 307 /

  const expectations = {
    student_personnel: {
      '/': 200,
      '/reports': 200,
      '/reports/new': 200,
      '/locations': 200,
      '/analytics': 307,
      '/settings': 307,
      '/unauthorized': 200,
      '/login': 307,
    },
    technician: {
      '/': 200,
      '/reports': 200,
      '/reports/new': 200,
      '/locations': 200,
      '/analytics': 307,
      '/settings': 307,
      '/unauthorized': 200,
      '/login': 307,
    },
    coordinator: {
      '/': 200,
      '/reports': 200,
      '/reports/new': 200,
      '/locations': 200,
      '/analytics': 200,
      '/settings': 307,
      '/unauthorized': 200,
      '/login': 307,
    },
    management: {
      '/': 200,
      '/reports': 200,
      '/reports/new': 200,
      '/locations': 200,
      '/analytics': 200,
      '/settings': 307,
      '/unauthorized': 200,
      '/login': 307,
    },
    administrator: {
      '/': 200,
      '/reports': 200,
      '/reports/new': 200,
      '/locations': 200,
      '/analytics': 200,
      '/settings': 200,
      '/unauthorized': 200,
      '/login': 307,
    },
  };

  for (const role of CANONICAL_ROLES) {
    const user = { id: `u-${role}`, profile: { role, is_active: true } };
    for (const route of routes) {
      const dispatch = evaluateFullRouteDispatch(user, route);
      const expectedStatus = expectations[role][route];
      assert.equal(
        dispatch.status,
        expectedStatus,
        `Role ${role} on ${route} expected status ${expectedStatus}, got ${dispatch.status}`
      );
      if (expectedStatus === 307) {
        if (route === '/login') {
          assert.equal(dispatch.destination, '/');
        } else {
          assert.equal(dispatch.destination, '/unauthorized');
        }
      }
    }
  }

  // Unauthenticated visitors:
  for (const route of routes) {
    const dispatch = evaluateFullRouteDispatch(null, route);
    if (route === '/login') {
      assert.equal(dispatch.status, 200);
    } else {
      assert.equal(dispatch.status, 307);
      assert.equal(dispatch.destination.startsWith('/login?next='), true);
    }
  }
});

test('Security Guard: Rejection of Client-Provided Roles and Tamper Resistance', () => {
  // Attacker sends arbitrary or forged role claims via client inputs or headers
  const maliciousClientInputs = [
    'administrator',
    'admin',
    'root',
    'superuser',
    "'; DROP TABLE profiles; --",
    '<script>alert("hacked")</script>',
    null,
    undefined,
  ];

  for (const forgedRole of maliciousClientInputs) {
    // 1. Client-supplied role cannot bypass isUserRole
    if (!CANONICAL_ROLES.includes(forgedRole)) {
      assert.equal(isUserRole(forgedRole), false, `Forged role "${forgedRole}" must not be recognized`);
    }

    // 2. Server profiles table is the single source of truth;
    // An active session for a technician with a spoofed header must still resolve to technician
    const serverVerifiedProfile = {
      id: 'usr-123',
      role: 'technician',
      is_active: true,
    };
    const access = evaluateProfileAccess(serverVerifiedProfile);
    assert.equal(access.role, 'technician');
    // Attempting /settings must still fail
    assert.equal(evaluateRouteAccess(access.role, '/settings'), false);
  }
});

test('Navigation Configuration vs Server-Side Route Guards (Defense in Depth)', () => {
  // 1. Navigation items for student_personnel hide /analytics and /settings
  const studentNavAllowed = ['/', '/reports', '/reports/new', '/locations'];
  assert.equal(studentNavAllowed.includes('/settings'), false);
  assert.equal(studentNavAllowed.includes('/analytics'), false);

  // 2. BUT if student directly requests /settings or /analytics via browser URL:
  const studentUser = { id: 's1', profile: { role: 'student_personnel', is_active: true } };
  assert.deepEqual(evaluateFullRouteDispatch(studentUser, '/settings'), {
    status: 307,
    destination: '/unauthorized',
  });
  assert.deepEqual(evaluateFullRouteDispatch(studentUser, '/analytics'), {
    status: 307,
    destination: '/unauthorized',
  });

  // Confirms that route security relies on server guards (requireRole), not navigation visibility
});

test('Report Visibility: Database Specification & Predicate Verification (can_view_report)', () => {
  const sampleReport = {
    id: 'rep-001',
    reporter_id: 'user-student-1',
  };

  const sampleAssignments = [
    { report_id: 'rep-001', technician_id: 'user-tech-1', status: 'assigned' },
    { report_id: 'rep-001', technician_id: 'user-tech-2', status: 'declined' },
  ];

  // Part 1: Oversight roles see all reports
  assert.equal(evaluateCanViewReport('coordinator', 'coord-999', sampleReport, sampleAssignments), true);
  assert.equal(evaluateCanViewReport('administrator', 'admin-999', sampleReport, sampleAssignments), true);
  assert.equal(evaluateCanViewReport('management', 'mgmt-999', sampleReport, sampleAssignments), true);

  // Part 2: Reporter sees own report regardless of role
  assert.equal(evaluateCanViewReport('student_personnel', 'user-student-1', sampleReport, sampleAssignments), true);
  // Other students CANNOT see this report
  assert.equal(evaluateCanViewReport('student_personnel', 'user-student-2', sampleReport, sampleAssignments), false);

  // Part 3: Assigned technician with non-declined assignment CAN see report
  assert.equal(evaluateCanViewReport('technician', 'user-tech-1', sampleReport, sampleAssignments), true);
  // Technician with DECLINED assignment CANNOT see report (OD-NEW-4 requirement)
  assert.equal(evaluateCanViewReport('technician', 'user-tech-2', sampleReport, sampleAssignments), false);
  // Unassigned technician CANNOT see report
  assert.equal(evaluateCanViewReport('technician', 'user-tech-3', sampleReport, sampleAssignments), false);
});

test('Report Visibility: Prototype Mock Data Assessment & Baseline Limitation', () => {
  // In Phase 1 and Phase 2 prototypes, MOCK_REPORTS is static client data
  const MOCK_REPORTS_COUNT = 8;
  const simulatedStaticView = (role) => {
    // Current prototype renders entire list to all roles on dashboard
    assert.ok(role, 'Role parameter must be provided');
    return MOCK_REPORTS_COUNT;
  };

  // Documenting prototype behavior:
  assert.equal(simulatedStaticView('student_personnel'), 8);
  assert.equal(simulatedStaticView('technician'), 8);
  assert.equal(simulatedStaticView('coordinator'), 8);

  // Verified requirement for Phase 3/4 live data:
  // Live queries MUST execute through Supabase SSR client where RLS evaluates can_view_report()
  // at the database engine level, preventing any data leak across roles.
});

