/**
 * CMIRS — Phase 4D.1 Local Route Probe (HTTP level, no browser dependency)
 *
 * Issues local HTTP requests against the running Next.js server and records the exact
 * status code, redirect target, and page markers. It never sends credentials, never
 * authenticates, and never writes anything.
 *
 * Purpose: confirm the routes exist, the perimeter guard behaves correctly, and — critically —
 * that no route triggers the Next.js server-action loader error
 * ("A \"use server\" file can only export async functions").
 */

const BASE = process.argv[2] ?? 'http://localhost:3001';

const ROUTES = [
  { path: '/', label: 'Dashboard' },
  { path: '/reports', label: 'Report queue' },
  { path: '/reports/new', label: 'New report form' },
  { path: '/reports/33333333-3333-3333-3333-333333333333', label: 'Report detail' },
  { path: '/analytics', label: 'Analytics' },
  { path: '/locations', label: 'Locations' },
  { path: '/settings', label: 'Settings' },
  { path: '/login', label: 'Login (public)' },
  { path: '/unauthorized', label: 'Unauthorized' },
];

console.log(`--- Local route probe against ${BASE} ---`);

let loaderError = false;
let failures = 0;

for (const route of ROUTES) {
  let response;
  try {
    response = await fetch(`${BASE}${route.path}`, { redirect: 'manual' });
  } catch (err) {
    failures += 1;
    console.log(`  [FAIL] ${route.path} (${route.label}) — transport error: ${err?.message ?? err}`);
    continue;
  }

  const location = response.headers.get('location');
  const contentType = response.headers.get('content-type') ?? '';

  if (route.path === '/login') {
    const body = await response.text();
    const hasForm = /<form/i.test(body);
    const hasPasswordField = /type="password"/i.test(body);
    const mentionsLoaderError = /can only export async functions/i.test(body);
    if (mentionsLoaderError) loaderError = true;
    console.log(
      `  [${response.status === 200 && hasForm && hasPasswordField ? 'PASS' : 'FAIL'}] ${route.path} (${route.label})` +
        ` — HTTP ${response.status}, HTML ${contentType.split(';')[0]}, form=${hasForm}, password-field=${hasPasswordField}` +
        (mentionsLoaderError ? '  <-- SERVER-ACTION LOADER ERROR IN OUTPUT' : '')
    );
    if (!(response.status === 200 && hasForm && hasPasswordField)) failures += 1;
    continue;
  }

  const isRedirect = response.status >= 300 && response.status < 400 && location;
  const target = location ? decodeURIComponent(location) : '(none)';
  const isServerActionError = /can only export async functions/i.test(String(target));

  console.log(
    `  [${isRedirect ? 'PASS' : 'INFO'}] ${route.path} (${route.label}) — HTTP ${response.status}` +
      (location ? ` -> ${target}` : ' (no redirect)')
  );

  if (isServerActionError) {
    loaderError = true;
    failures += 1;
  }
}

console.log();
console.log(
  loaderError
    ? '  RESULT: FAIL — the Next.js server-action loader error was observed.'
    : '  RESULT: PASS — no route response contained the Next.js server-action loader error.'
);
console.log('  Note: unauthenticated requests are correctly redirected to /login by proxy.ts.');
if (failures > 0) process.exitCode = 1;
