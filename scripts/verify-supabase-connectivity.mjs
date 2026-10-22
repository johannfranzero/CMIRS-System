/**
 * CMIRS — Phase 4D.1 Supabase Connectivity Verification (READ-ONLY)
 *
 * Usage:
 *   node scripts/verify-supabase-connectivity.mjs
 *
 * What it does:
 *  1. Validates the Supabase environment configuration WITHOUT printing any secret value.
 *  2. Asserts the configured key is a *publishable* (client-safe) key and explicitly rejects
 *     service-role / secret keys.
 *  3. Verifies the application's server client factory (`utils/supabase/server.ts`) accepts the
 *     configuration and proceeds to the cookie/session step.
 *  4. Verifies the reference-catalog DAL helpers target the intended Supabase tables.
 *  5. Performs MINIMAL READ-ONLY SELECT probes against the configured project and classifies
 *     the outcome.
 *
 * Safety: this script never writes, inserts, updates, deletes, or truncates. It issues only
 * `SELECT` requests with `limit(1)`. It never prints a key, URL host credential, or token.
 * Values are only ever reported as booleans, lengths, and coarse shapes.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

// Allow the unmodified application module `utils/supabase/server.ts` (which imports the
// extensionless `next/headers` subpath) to be imported outside the Next.js bundler.
register('./next-headers-resolve-hook.mjs', import.meta.url);

// ---------------------------------------------------------------------------
// Output helpers (never print secret material)
// ---------------------------------------------------------------------------

const lines = [];
const log = (line = '') => {
  lines.push(line);
  console.log(line);
};
const section = (title) => {
  log();
  log(`--- ${title} ---`);
};
const verdict = (ok, label, detail = '') =>
  log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);

// ---------------------------------------------------------------------------
// 1. Environment configuration
// ---------------------------------------------------------------------------

section('1. Environment configuration (values redacted)');

const envPath = path.join(appRoot, '.env.local');
if (!existsSync(envPath)) {
  log('  [FAIL] .env.local is missing — configuration failure.');
  process.exit(1);
}

const envMap = new Map();
for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  envMap.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
}

const supabaseUrl = envMap.get('NEXT_PUBLIC_SUPABASE_URL') ?? '';
const supabaseKey = envMap.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? '';

const urlPresent = supabaseUrl.length > 0;
const keyPresent = supabaseKey.length > 0;

let urlWellFormed = false;
let projectHostShape = 'invalid';
let projectRef = '';
try {
  const parsed = new URL(supabaseUrl);
  urlWellFormed = parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co');
  const parts = parsed.hostname.split('.');
  projectRef = parts.length >= 2 ? parts[0] : 'unknown';
  projectHostShape = `${parsed.protocol}//<project>.supabase.co`;
} catch {
  urlWellFormed = false;
}

const isNewStylePublishable = /^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseKey);
const isLegacyJwtKey = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(supabaseKey);
const looksLikeSecretKey = /^sb_secret_/.test(supabaseKey) || supabaseKey.includes('service_role');

verdict(urlPresent, 'NEXT_PUBLIC_SUPABASE_URL is defined');
verdict(keyPresent, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is defined');
verdict(urlWellFormed, 'URL is a well-formed https Supabase project URL', projectHostShape);
verdict(
  isNewStylePublishable || isLegacyJwtKey,
  'Key is a client-safe publishable/anon key',
  isNewStylePublishable ? 'sb_publishable_* form' : 'legacy JWT anon form'
);
verdict(
  !looksLikeSecretKey,
  'Key is NOT a service-role/secret key (server-side privilege check)'
);
log(`  project reference: ${projectRef} (host only, no credentials)`);

// ---------------------------------------------------------------------------
// 2. Application server client factory
// ---------------------------------------------------------------------------

section('2. Application server client factory (utils/supabase/server.ts)');

process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = supabaseKey;

const serverModule = await import('../utils/supabase/server.ts');
verdict(typeof serverModule.createClient === 'function', 'createClient() factory is exported');

try {
  await serverModule.createClient();
  // Reached only if cookies() resolved — i.e. we are inside a Next.js request scope.
  verdict(true, 'createClient() resolved inside a request scope');
} catch (err) {
  const message = String(err?.message ?? err);
  if (/Missing Supabase environment variables/i.test(message)) {
    verdict(false, 'createClient() rejected the configuration', message);
  } else if (/cookies|request scope|async storage|outside a request/i.test(message)) {
    verdict(
      true,
      'createClient() accepted the configuration and advanced to the cookie/session adapter',
      'cookies() is unavailable outside a Next.js request scope (expected outside the runtime)'
    );
  } else {
    verdict(false, 'createClient() failed for an unexpected reason', message.split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// 3. Reference-catalog DAL table targeting (mocked client, no network)
// ---------------------------------------------------------------------------

section('3. Reference-catalog DAL table targeting (mocked client, no network)');

const { getActiveCategoriesFromClient, getActiveLocationsFromClient, getActiveTechniciansFromClient, getCampusFacilityBreakdownFromClient } =
  await import('../utils/reports/reference-catalogs.ts');

function createRecordingClient(responses = {}) {
  const tables = [];
  return {
    tables,
    from(table) {
      tables.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        order() { return query; },
        range() { return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null }); },
        limit() { return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null }); },
        then(resolve, reject) {
          return Promise.resolve(responses[table] ?? { data: [], count: 0, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const catalogClient = createRecordingClient({
  categories: { data: [{ id: 'c1', name: 'Probe' }], count: 1, error: null },
  locations: { data: [{ id: 'l1', building_name: 'Probe' }], count: 1, error: null },
  profiles: { data: [{ id: 't1', full_name: 'Probe' }], count: 1, error: null },
  reports: { data: [], count: 0, error: null },
});

await getActiveCategoriesFromClient(catalogClient);
await getActiveLocationsFromClient(catalogClient);
await getActiveTechniciansFromClient(catalogClient);
await getCampusFacilityBreakdownFromClient(catalogClient);

verdict(catalogClient.tables.includes('categories'), "catalog loader targets 'categories'");
verdict(catalogClient.tables.includes('locations'), "catalog loader targets 'locations'");
verdict(catalogClient.tables.includes('profiles'), "technician loader targets 'profiles'");
verdict(catalogClient.tables.includes('reports'), "facility breakdown targets 'reports'");

// ---------------------------------------------------------------------------
// 4. Minimal read-only probes against the configured project
// ---------------------------------------------------------------------------

section('4. Minimal READ-ONLY probes against the configured project');

const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');

const probeClient = createSupabaseClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/**
 * Classifies a Supabase read result into the required taxonomy.
 */
function classify(result) {
  if (result.transportError) {
    const message = result.transportError.message ?? String(result.transportError);
    return { category: 'NETWORK / API FAILURE', detail: message.split('\n')[0] };
  }

  const { error, data, status } = result;

  if (!error) {
    const count = Array.isArray(data) ? data.length : 0;
    return {
      category: count > 0 ? 'SUCCESSFUL QUERY WITH RECORDS' : 'SUCCESSFUL QUERY WITH ZERO RECORDS',
      detail: `HTTP ${status}, ${count} row(s) returned`,
      count,
    };
  }

  const code = error.code ?? 'unknown';
  const name = error.name ?? 'Error';
  const message = error.message ?? '';
  const httpStatus = error.status ?? status ?? 0;

  // Supabase reports a missing browser session as AuthSessionMissingError (HTTP 400).
  if (name === 'AuthSessionMissingError' || /auth session missing/i.test(message)) {
    return {
      category: 'AUTHENTICATION FAILURE (no session available)',
      detail: `HTTP ${httpStatus}, ${name}`,
    };
  }
  if (httpStatus === 401 || code === 'PGRST301' || /JWT|invalid.*token|expired/i.test(message)) {
    return { category: 'AUTHENTICATION FAILURE', detail: `HTTP ${httpStatus}, code ${code}` };
  }
  if (httpStatus === 403 || code === '42501' || /permission denied|row-level security/i.test(message)) {
    return { category: 'RLS / PERMISSION DENIAL', detail: `HTTP ${httpStatus}, code ${code}` };
  }
  if (httpStatus >= 500) {
    return { category: 'NETWORK / API FAILURE', detail: `HTTP ${httpStatus}, code ${code}` };
  }
  return { category: 'API FAILURE (non-2xx, not classified)', detail: `HTTP ${httpStatus}, code ${code}, ${name}` };
}

async function probe(label, run) {
  const started = Date.now();
  try {
    const { data, error, status } = await run();
    const outcome = classify({ data, error, status });
    log(`  ${label}`);
    log(`      classification : ${outcome.category}`);
    log(`      detail         : ${outcome.detail}`);
    log(`      latency        : ${Date.now() - started} ms`);
    return outcome;
  } catch (transportError) {
    const outcome = classify({ transportError });
    log(`  ${label}`);
    log(`      classification : ${outcome.category}`);
    log(`      detail         : ${outcome.detail}`);
    return outcome;
  }
}

const sessionOutcome = await probe('auth.getSession() (no user cookie in this context)', async () => {
  const { data, error } = await probeClient.auth.getSession();
  return { data: data?.session ? [data.session] : [], error, status: error ? error.status : 200 };
});

const userOutcome = await probe('auth.getUser() (no user cookie in this context)', async () => {
  const { data, error } = await probeClient.auth.getUser();
  return { data: data?.user ? [data.user] : [], error, status: error ? error.status : 200 };
});
const categoriesOutcome = await probe("SELECT id FROM categories LIMIT 1", async () => {
  const { data, error, status } = await probeClient
    .from('categories')
    .select('id')
    .limit(1);
  return { data, error, status };
});

const locationsOutcome = await probe("SELECT id FROM locations LIMIT 1", async () => {
  const { data, error, status } = await probeClient
    .from('locations')
    .select('id')
    .limit(1);
  return { data, error, status };
});

const reportsOutcome = await probe("SELECT id FROM reports LIMIT 1", async () => {
  const { data, error, status } = await probeClient
    .from('reports')
    .select('id')
    .limit(1);
  return { data, error, status };
});

// ---------------------------------------------------------------------------
// 4b. Schema-object existence probe (read-only, no RPC execution)
// ---------------------------------------------------------------------------

section('4b. Schema object existence probe (read-only SELECT only)');

/**
 * Probes whether a table exists by issuing a `SELECT ... LIMIT 1` against it.
 * A missing relation produces a PostgREST error; an existing relation answers HTTP 200.
 * No RPC endpoint is ever invoked, so no state-changing function can run.
 */
async function probeTableExistence(table) {
  try {
    const { data, error, status } = await probeClient.from(table).select('*').limit(1);
    if (!error) {
      return { exists: true, detail: `HTTP ${status}, ${Array.isArray(data) ? data.length : 0} row(s) visible to the unauthenticated probe` };
    }
    return {
      exists: false,
      detail: `HTTP ${error.status ?? status ?? 'unknown'}, code ${error.code ?? 'unknown'} — relation not exposed to this role`,
    };
  } catch (err) {
    return { exists: false, detail: `transport error: ${String(err?.message ?? err).split('\n')[0]}` };
  }
}

for (const table of ['notifications', 'notification_command_receipts']) {
  const result = await probeTableExistence(table);
  log(`  ${table}: ${result.exists ? 'EXISTS' : 'NOT AVAILABLE'} — ${result.detail}`);
}

// ---------------------------------------------------------------------------
// 5. Summary
// ---------------------------------------------------------------------------

section('5. Connectivity summary');

log(`  session probe : ${sessionOutcome.category} (${sessionOutcome.detail})`);
log(`  user probe    : ${userOutcome.category} (${userOutcome.detail})`);
log(`  categories    : ${categoriesOutcome.category} (${categoriesOutcome.detail})`);
log(`  locations     : ${locationsOutcome.category} (${locationsOutcome.detail})`);
log(`  reports       : ${reportsOutcome.category} (${reportsOutcome.detail})`);
log();
log('  OVERALL: ' + overallClassification({
  sessionOutcome,
  userOutcome,
  categoriesOutcome,
  locationsOutcome,
  reportsOutcome,
}));
log('  No write, insert, update, delete, or truncate operation was issued by this script.');

function overallClassification(outcomes) {
  const categories = [outcomes.categoriesOutcome, outcomes.locationsOutcome, outcomes.reportsOutcome];

  if (categories.some((o) => o.category === 'NETWORK / API FAILURE')) {
    return 'NETWORK / API FAILURE — the project endpoint did not answer the probes.';
  }
  if (categories.some((o) => o.category === 'RLS / PERMISSION DENIAL')) {
    return 'RLS / PERMISSION DENIAL — the API answered, but the read was refused by policy.';
  }
  if (categories.every((o) => o.category === 'SUCCESSFUL QUERY WITH RECORDS')) {
    return 'SUCCESSFUL QUERY WITH RECORDS — the API answered and returned rows.';
  }
  if (categories.every((o) => o.category === 'SUCCESSFUL QUERY WITH ZERO RECORDS')) {
    return 'SUCCESSFUL QUERY WITH ZERO RECORDS — the API answered correctly but no rows are visible to the unauthenticated probe.';
  }
  if (outcomes.userOutcome.category === 'AUTHENTICATION FAILURE') {
    return 'AUTHENTICATION FAILURE — no authenticated session is available in this context, so an authenticated read could not be executed.';
  }
  return 'MIXED — see per-probe classification above.';
}
