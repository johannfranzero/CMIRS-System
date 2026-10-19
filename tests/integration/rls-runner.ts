/**
 * CMIRS Phase E.4B — Role-Based RLS Integration Test Runner
 *
 * File: tests/integration/rls-runner.ts
 * Target Project Reference: xyirfifvcntuzceivtho
 * Engine: PostgreSQL 17.11.0.003
 *
 * Scope: Automated end-to-end evaluation of all 55 role-based Row Level Security (RLS)
 * and Storage policies defined in docs/database-design/PHASE_5J_RLS_TEST_MATRIX.md.
 *
 * SAFETY PROTOCOLS:
 * 1. ZERO SUPERUSER TESTING: Uses dedicated authenticated client sessions for each role.
 *    Service-role key is NEVER used for policy assertions.
 * 2. DETERMINISTIC FIXTURE LEDGER: Every created database ID and storage path is logged
 *    to an on-disk ledger (tests/integration/.rls-run-ledger.json) for 100% recovery.
 * 3. EXPLICIT STORAGE CLEANUP: Purges binary storage objects via Storage API before database deletion.
 * 4. TARGETED RECORD PURGE: Deletes fixtures strictly by exact UUID (id IN (...)), never broad prefixes alone.
 * 5. EXECUTION GUARD: Requires explicit --execute CLI flag to prevent accidental remote invocation.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// 1. Types & Interfaces
// =============================================================================

export type UserRole =
  | 'student_personnel'
  | 'coordinator'
  | 'technician'
  | 'administrator'
  | 'management'
  | 'anon';

export type TestStatus = 'PASS' | 'FAIL' | 'HARNESS_ERROR' | 'SKIPPED';

export interface TestResult {
  id: string;
  name: string;
  domain: string;
  actingRole: UserRole;
  status: TestStatus;
  message: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface FixtureLedger {
  runId: string;
  startedAt: string;
  completedAt?: string;
  reports: Array<{ id: string; title: string; reporterId: string }>;
  assignments: Array<{ id: string; reportId: string }>;
  attachments: Array<{ id: string; reportId: string; filePath: string }>;
  storagePaths: string[];
  comments: Array<{ id: string; reportId: string }>;
  workLogs: Array<{ id: string; assignmentId: string }>;
  verifications: Array<{ id: string; reportId: string }>;
  notifications: Array<{ id: string; recipientId: string }>;
  profileRestores: Array<{ id: string; originalFullName: string }>;
}

export interface ClientPool {
  anon: SupabaseClient;
  student: SupabaseClient;
  coord: SupabaseClient;
  tech: SupabaseClient;
  admin: SupabaseClient;
  mgmt: SupabaseClient;
  adminTeardown?: SupabaseClient; // Strictly for post-test cleanup if service-role key is provided
}

export interface UserIdentities {
  studentId: string;
  coordId: string;
  techId: string;
  adminId: string;
  mgmtId: string;
}

export interface SeedReferences {
  categoryId: string;
  locationId: string;
}

// =============================================================================
// 2. Constants & Fixtures
// =============================================================================

const RUN_ID = `RUN-${Date.now()}`;
const FIXTURE_PREFIX = `[TEST-E4A-${RUN_ID}]`;
const LEDGER_FILE_PATH = path.join(process.cwd(), 'tests', 'integration', '.rls-run-ledger.json');
const CLEANUP_SQL_PATH = path.join(process.cwd(), 'tests', 'integration', `cleanup_${RUN_ID}.sql`);

// 1x1 transparent PNG byte buffer (68 bytes) for clean Storage API testing
const DUMMY_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// =============================================================================
// 3. Credential & Environment Loader
// =============================================================================

function loadEnvironment(): {
  supabaseUrl: string;
  publishableKey: string;
  testPassword: string;
  serviceRoleKey?: string;
} {
  // Check for local env files if process.env is missing values
  const envFiles = ['.env.test.local', '.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      }
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const testPassword = process.env.CMIRS_TEST_PASSWORD;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new Error(
      'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
    );
  }

  if (!testPassword) {
    throw new Error(
      'Missing CMIRS_TEST_PASSWORD. Set this variable in process.env or .env.test.local before running.'
    );
  }

  return { supabaseUrl, publishableKey, testPassword, serviceRoleKey };
}

// =============================================================================
// 4. Ledger Management (Failure-Proof Teardown)
// =============================================================================

function initializeLedger(): FixtureLedger {
  const ledger: FixtureLedger = {
    runId: RUN_ID,
    startedAt: new Date().toISOString(),
    reports: [],
    assignments: [],
    attachments: [],
    storagePaths: [],
    comments: [],
    workLogs: [],
    verifications: [],
    notifications: [],
    profileRestores: [],
  };
  saveLedger(ledger);
  return ledger;
}

function saveLedger(ledger: FixtureLedger): void {
  try {
    const dir = path.dirname(LEDGER_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LEDGER_FILE_PATH, JSON.stringify(ledger, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LEDGER ERROR] Failed to persist run ledger:', (err as Error).message);
  }
}

// =============================================================================
// 5. Client Session Initializer
// =============================================================================

async function createClientPool(
  url: string,
  anonKey: string,
  password: string,
  serviceRoleKey?: string
): Promise<{ pool: ClientPool; identities: UserIdentities }> {
  console.log('[INIT] Initializing multi-role Supabase client session pool...');

  const makeClient = () =>
    createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const anonClient = makeClient();
  const studentClient = makeClient();
  const coordClient = makeClient();
  const techClient = makeClient();
  const adminClient = makeClient();
  const mgmtClient = makeClient();

  // Authenticate the five designated test accounts
  const accounts = [
    { email: 'test-student@cmirs.internal', client: studentClient, role: 'student_personnel' },
    { email: 'test-coord@cmirs.internal', client: coordClient, role: 'coordinator' },
    { email: 'test-tech@cmirs.internal', client: techClient, role: 'technician' },
    { email: 'test-admin@cmirs.internal', client: adminClient, role: 'administrator' },
    { email: 'test-mgmt@cmirs.internal', client: mgmtClient, role: 'management' },
  ];

  const identities: Partial<UserIdentities> = {};

  for (const acc of accounts) {
    const { data, error } = await acc.client.auth.signInWithPassword({
      email: acc.email,
      password,
    });

    if (error || !data.user) {
      throw new Error(
        `Failed to authenticate test account ${acc.email} (${acc.role}): ${error?.message || 'No user'}`
      );
    }

    if (acc.role === 'student_personnel') identities.studentId = data.user.id;
    if (acc.role === 'coordinator') identities.coordId = data.user.id;
    if (acc.role === 'technician') identities.techId = data.user.id;
    if (acc.role === 'administrator') identities.adminId = data.user.id;
    if (acc.role === 'management') identities.mgmtId = data.user.id;
  }

  // Optional: Instantiate admin teardown client if service-role key is provided
  let adminTeardown: SupabaseClient | undefined;
  if (serviceRoleKey) {
    adminTeardown = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  const pool: ClientPool = {
    anon: anonClient,
    student: studentClient,
    coord: coordClient,
    tech: techClient,
    admin: adminClient,
    mgmt: mgmtClient,
    adminTeardown,
  };

  console.log('[INIT] All 5 role test accounts authenticated successfully.');
  return { pool, identities: identities as UserIdentities };
}

// =============================================================================
// 6. Seed Reference Data Discovery (Read-Only)
// =============================================================================

async function fetchSeedReferences(client: SupabaseClient): Promise<SeedReferences> {
  const { data: catData, error: catErr } = await client
    .from('categories')
    .select('id, name')
    .eq('is_active', true)
    .limit(1)
    .single();

  if (catErr || !catData) {
    throw new Error(`Failed to load active category from seed data: ${catErr?.message}`);
  }

  const { data: locData, error: locErr } = await client
    .from('locations')
    .select('id, building_name')
    .eq('is_active', true)
    .limit(1)
    .single();

  if (locErr || !locData) {
    throw new Error(`Failed to load active location from seed data: ${locErr?.message}`);
  }

  return { categoryId: catData.id, locationId: locData.id };
}

// =============================================================================
// 7. Error & Denial Discrimination Engine
// =============================================================================

interface DenialExpectation {
  expectedKind: 'RLS_VIOLATION' | 'TRIGGER_EXCEPTION' | 'CHECK_CONSTRAINT' | 'COLUMN_DENIAL' | 'EMPTY_SET';
  expectedCode?: string;
  expectedMessageSubstr?: string;
}

function evaluateDenial(
  response: { data: unknown; error: unknown; count?: number | null },
  expectation: DenialExpectation
): { pass: boolean; reason: string } {
  const err = response.error as { code?: string; message?: string; details?: string; hint?: string } | null;

  // Case 1: Empty Set (Row isolation on SELECT)
  if (expectation.expectedKind === 'EMPTY_SET') {
    if (err) {
      return { pass: false, reason: `Expected empty set, but query returned error: ${err.message}` };
    }
    const rows = Array.isArray(response.data) ? response.data : [];
    if (rows.length === 0) {
      return { pass: true, reason: 'Row successfully isolated by RLS (0 rows returned).' };
    }
    return {
      pass: false,
      reason: `PRIVILEGE LEAKAGE: Expected 0 rows, but received ${rows.length} rows.`,
    };
  }

  // For mutation tests, no error means the prohibited mutation unexpectedly succeeded
  if (!err) {
    return {
      pass: false,
      reason: 'CRITICAL SECURITY FAILURE: Prohibited action succeeded with zero errors.',
    };
  }

  // Distinguish session expiration and infrastructure errors
  if (err.code === '401' || err.message?.includes('JWT') || err.message?.includes('invalid claim')) {
    return { pass: false, reason: `HARNESS FAILURE: Authenticated session expired or invalid: ${err.message}` };
  }

  if (err.code === '500' || err.code === '502' || err.code === '503') {
    return { pass: false, reason: `INFRASTRUCTURE FAILURE: Remote database returned ${err.code}: ${err.message}` };
  }

  // Case 2: RLS Policy Violation (42501)
  if (expectation.expectedKind === 'RLS_VIOLATION') {
    if (err.code === '42501' || err.message?.includes('row-level security') || err.message?.includes('policy')) {
      return { pass: true, reason: `Properly denied by RLS policy check (code: ${err.code}).` };
    }
    return {
      pass: false,
      reason: `Expected RLS policy rejection, but received different error: ${err.code} - ${err.message}`,
    };
  }

  // Case 3: Trigger Exception (P0001)
  if (expectation.expectedKind === 'TRIGGER_EXCEPTION') {
    if (err.code === 'P0001' || (expectation.expectedMessageSubstr && err.message?.includes(expectation.expectedMessageSubstr))) {
      return { pass: true, reason: `Properly blocked by trigger guard (${err.message}).` };
    }
    return {
      pass: false,
      reason: `Expected trigger guard P0001, but received: ${err.code} - ${err.message}`,
    };
  }

  // Case 4: Check Constraint (23514)
  if (expectation.expectedKind === 'CHECK_CONSTRAINT') {
    if (err.code === '23514' || err.message?.includes('check constraint')) {
      return { pass: true, reason: `Properly blocked by database check constraint (${err.code}).` };
    }
    return {
      pass: false,
      reason: `Expected check constraint 23514, but received: ${err.code} - ${err.message}`,
    };
  }

  // Case 5: Column-Level Privilege Denial
  if (expectation.expectedKind === 'COLUMN_DENIAL') {
    if (err.code === '42501' && (err.message?.includes('permission denied for column') || err.message?.includes('column'))) {
      return { pass: true, reason: `Properly rejected by column-level privilege grant (${err.message}).` };
    }
    return {
      pass: false,
      reason: `Expected column privilege denial, but received: ${err.code} - ${err.message}`,
    };
  }

  return { pass: false, reason: `Unrecognized denial condition: ${err.code} - ${err.message}` };
}

// =============================================================================
// 8. The 55 RLS Test Suite Implementations
// =============================================================================

export class RlsTestSuite {
  private results: TestResult[] = [];
  private ledger: FixtureLedger;
  private pool: ClientPool;
  private ids: UserIdentities;
  private seed: SeedReferences;

  // Shared test fixture references
  private fixtureRpt1Id?: string;
  private fixtureRpt2Id?: string;
  private fixtureAsg1Id?: string;
  private fixtureAsgWorkId?: string;
  private fixtureAtt1Id?: string;
  private fixtureAtt1Path?: string;
  private fixtureCom1Id?: string;
  private fixtureNotif1Id?: string;

  constructor(pool: ClientPool, identities: UserIdentities, seed: SeedReferences, ledger: FixtureLedger) {
    this.pool = pool;
    this.ids = identities;
    this.seed = seed;
    this.ledger = ledger;
  }

  private record(result: TestResult): void {
    this.results.push(result);
    const badge = result.status === 'PASS' ? '[\x1b[32mPASS\x1b[0m]' : '[\x1b[31mFAIL\x1b[0m]';
    console.log(`  ${badge} ${result.id}: ${result.name} (${result.durationMs}ms) — ${result.message}`);
  }

  // ---------------------------------------------------------------------------
  // Domain 1: Authentication, Role Boundaries & Profiles (9 Tests)
  // ---------------------------------------------------------------------------
  async runDomain1(): Promise<void> {
    console.log('\n--- DOMAIN 1: Authentication, Role Boundaries & Profiles ---');

    // RLS-AUTH-01: anon SELECT public.profiles
    const t01 = Date.now();
    const res01 = await this.pool.anon.from('profiles').select('*');
    const eval01 = evaluateDenial(res01, { expectedKind: 'EMPTY_SET' });
    this.record({
      id: 'RLS-AUTH-01',
      name: 'Anon profile read isolation',
      domain: 'Domain 1: Profiles',
      actingRole: 'anon',
      status: eval01.pass ? 'PASS' : 'FAIL',
      message: eval01.reason,
      durationMs: Date.now() - t01,
    });

    // RLS-AUTH-02: student SELECT own profile
    const t02 = Date.now();
    const { data: data02, error: err02 } = await this.pool.student
      .from('profiles')
      .select('*')
      .eq('id', this.ids.studentId)
      .single();
    const pass02 = !err02 && data02 && data02.role === 'student_personnel';
    this.record({
      id: 'RLS-AUTH-02',
      name: 'Student read own profile',
      domain: 'Domain 1: Profiles',
      actingRole: 'student_personnel',
      status: pass02 ? 'PASS' : 'FAIL',
      message: pass02 ? 'Own profile record returned successfully.' : `Failed: ${err02?.message}`,
      durationMs: Date.now() - t02,
    });

    // RLS-AUTH-03: student SELECT coordinator profile (horizontal isolation)
    const t03 = Date.now();
    const res03 = await this.pool.student.from('profiles').select('*').eq('id', this.ids.coordId);
    const eval03 = evaluateDenial(res03, { expectedKind: 'EMPTY_SET' });
    this.record({
      id: 'RLS-AUTH-03',
      name: 'Student horizontal profile isolation',
      domain: 'Domain 1: Profiles',
      actingRole: 'student_personnel',
      status: eval03.pass ? 'PASS' : 'FAIL',
      message: eval03.reason,
      durationMs: Date.now() - t03,
    });

    // RLS-AUTH-04: coordinator SELECT all profiles (oversight)
    const t04 = Date.now();
    const { data: data04, error: err04 } = await this.pool.coord.from('profiles').select('*');
    const pass04 = !err04 && Array.isArray(data04) && data04.length >= 5;
    this.record({
      id: 'RLS-AUTH-04',
      name: 'Coordinator oversight profile visibility',
      domain: 'Domain 1: Profiles',
      actingRole: 'coordinator',
      status: pass04 ? 'PASS' : 'FAIL',
      message: pass04 ? `Returned ${data04.length} profile records.` : `Failed: ${err04?.message}`,
      durationMs: Date.now() - t04,
    });

    // RLS-AUTH-05: student UPDATE role = 'administrator' (vertical escalation attempt)
    const t05 = Date.now();
    const res05 = await this.pool.student
      .from('profiles')
      .update({ role: 'administrator' })
      .eq('id', this.ids.studentId);
    const eval05 = evaluateDenial(res05, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-AUTH-05',
      name: 'Student vertical role escalation rejection',
      domain: 'Domain 1: Profiles',
      actingRole: 'student_personnel',
      status: eval05.pass ? 'PASS' : 'FAIL',
      message: eval05.reason,
      durationMs: Date.now() - t05,
    });

    // RLS-AUTH-06: student UPDATE is_active = false (self-sabotage attempt)
    const t06 = Date.now();
    const res06 = await this.pool.student
      .from('profiles')
      .update({ is_active: false })
      .eq('id', this.ids.studentId);
    const eval06 = evaluateDenial(res06, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-AUTH-06',
      name: 'Student is_active immutability check',
      domain: 'Domain 1: Profiles',
      actingRole: 'student_personnel',
      status: eval06.pass ? 'PASS' : 'FAIL',
      message: eval06.reason,
      durationMs: Date.now() - t06,
    });

    // RLS-AUTH-07: admin UPDATE own role (admin self-demotion lockout prevention)
    const t07 = Date.now();
    const res07 = await this.pool.admin
      .from('profiles')
      .update({ role: 'coordinator' })
      .eq('id', this.ids.adminId);
    const eval07 = evaluateDenial(res07, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-AUTH-07',
      name: 'Admin self-demotion lockout check',
      domain: 'Domain 1: Profiles',
      actingRole: 'administrator',
      status: eval07.pass ? 'PASS' : 'FAIL',
      message: eval07.reason,
      durationMs: Date.now() - t07,
    });

    // RLS-AUTH-08: admin UPDATE student full_name (authorized administration + inline revert)
    const t08 = Date.now();
    const testName = 'Test Student E4B';
    const { error: err08 } = await this.pool.admin
      .from('profiles')
      .update({ full_name: testName })
      .eq('id', this.ids.studentId);

    // Immediately revert to preserve account baseline
    if (!err08) {
      await this.pool.admin.from('profiles').update({ full_name: 'Test Student' }).eq('id', this.ids.studentId);
    }
    const pass08 = !err08;
    this.record({
      id: 'RLS-AUTH-08',
      name: 'Admin profile update authorization',
      domain: 'Domain 1: Profiles',
      actingRole: 'administrator',
      status: pass08 ? 'PASS' : 'FAIL',
      message: pass08 ? 'Admin updated profile; successfully reverted.' : `Failed: ${err08?.message}`,
      durationMs: Date.now() - t08,
    });

    // RLS-AUTH-09: student direct INSERT into role_change_audit
    const t09 = Date.now();
    const res09 = await this.pool.student.from('role_change_audit').insert({
      user_id: this.ids.studentId,
      changed_by: this.ids.studentId,
      old_role: 'student_personnel',
      new_role: 'administrator',
    });
    const eval09 = evaluateDenial(res09, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-AUTH-09',
      name: 'Student audit log forgery rejection',
      domain: 'Domain 1: Profiles',
      actingRole: 'student_personnel',
      status: eval09.pass ? 'PASS' : 'FAIL',
      message: eval09.reason,
      durationMs: Date.now() - t09,
    });
  }

  // ---------------------------------------------------------------------------
  // Domain 2: Report Creation, Numbering & Visibility (11 Tests)
  // ---------------------------------------------------------------------------
  async runDomain2(): Promise<void> {
    console.log('\n--- DOMAIN 2: Report Creation, Numbering & Visibility ---');

    // RLS-RPT-01: student valid report insertion (Primary Fixture RPT-1)
    const t01 = Date.now();
    const rpt1Title = `${FIXTURE_PREFIX} Primary plumbing leak`;
    const { data: d01, error: err01 } = await this.pool.student
      .from('reports')
      .insert({
        title: rpt1Title,
        description: 'Water leak under main floor laboratory sink',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id, report_number, status, confirmed_priority')
      .single();

    if (d01) {
      this.fixtureRpt1Id = d01.id;
      this.ledger.reports.push({ id: d01.id, title: rpt1Title, reporterId: this.ids.studentId });
      saveLedger(this.ledger);
    }
    const pass01 = !err01 && d01 && d01.status === 'submitted' && d01.confirmed_priority === null;
    this.record({
      id: 'RLS-RPT-01',
      name: 'Student authorized report creation',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: pass01 ? 'PASS' : 'FAIL',
      message: pass01 ? `Report created with sequence ${d01?.report_number}.` : `Failed: ${err01?.message}`,
      durationMs: Date.now() - t01,
    });

    // RLS-RPT-02: student spoof reporter_id = coordId
    const t02 = Date.now();
    const res02 = await this.pool.student.from('reports').insert({
      title: `${FIXTURE_PREFIX} Spoofed reporter`,
      description: 'desc',
      category_id: this.seed.categoryId,
      location_id: this.seed.locationId,
      reporter_id: this.ids.coordId,
      status: 'submitted',
    });
    const eval02 = evaluateDenial(res02, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-RPT-02',
      name: 'Student reporter spoofing rejection',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: eval02.pass ? 'PASS' : 'FAIL',
      message: eval02.reason,
      durationMs: Date.now() - t02,
    });

    // RLS-RPT-03: student insert with status = 'verified'
    const t03 = Date.now();
    const res03 = await this.pool.student.from('reports').insert({
      title: `${FIXTURE_PREFIX} Premature status`,
      description: 'desc',
      category_id: this.seed.categoryId,
      location_id: this.seed.locationId,
      reporter_id: this.ids.studentId,
      status: 'verified',
    });
    const eval03 = evaluateDenial(res03, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-RPT-03',
      name: 'Student premature status bypass rejection',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: eval03.pass ? 'PASS' : 'FAIL',
      message: eval03.reason,
      durationMs: Date.now() - t03,
    });

    // RLS-RPT-04: student insert with confirmed_priority = 'critical'
    const t04 = Date.now();
    const res04 = await this.pool.student.from('reports').insert({
      title: `${FIXTURE_PREFIX} Forced priority`,
      description: 'desc',
      category_id: this.seed.categoryId,
      location_id: this.seed.locationId,
      reporter_id: this.ids.studentId,
      status: 'submitted',
      confirmed_priority: 'critical',
    });
    const eval04 = evaluateDenial(res04, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-RPT-04',
      name: 'Student confirmed priority bypass rejection',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: eval04.pass ? 'PASS' : 'FAIL',
      message: eval04.reason,
      durationMs: Date.now() - t04,
    });

    // RLS-RPT-05: student custom report_number overwrite test (Trigger T2, Fixture RPT-2)
    const t05 = Date.now();
    const rpt2Title = `${FIXTURE_PREFIX} Trigger T2 sequence overwrite`;
    const { data: d05, error: err05 } = await this.pool.student
      .from('reports')
      .insert({
        report_number: 'RPT-999999',
        title: rpt2Title,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id, report_number')
      .single();

    if (d05) {
      this.fixtureRpt2Id = d05.id;
      this.ledger.reports.push({ id: d05.id, title: rpt2Title, reporterId: this.ids.studentId });
      saveLedger(this.ledger);
    }
    const pass05 = !err05 && d05 && d05.report_number !== 'RPT-999999' && d05.report_number.startsWith('RPT-');
    this.record({
      id: 'RLS-RPT-05',
      name: 'Trigger T2 report number sequence override',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: pass05 ? 'PASS' : 'FAIL',
      message: pass05 ? `Sequence generated: ${d05?.report_number}.` : `Failed: ${err05?.message}`,
      durationMs: Date.now() - t05,
    });

    // RLS-RPT-06: student UPDATE report_number (immutability trigger)
    const t06 = Date.now();
    if (!this.fixtureRpt1Id) throw new Error('Missing fixture RPT-1');
    const res06 = await this.pool.student
      .from('reports')
      .update({ report_number: 'RPT-ALTERED' })
      .eq('id', this.fixtureRpt1Id);
    const eval06 = evaluateDenial(res06, {
      expectedKind: 'TRIGGER_EXCEPTION',
      expectedMessageSubstr: 'report_number is immutable',
    });
    this.record({
      id: 'RLS-RPT-06',
      name: 'Report number immutability trigger guard',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: eval06.pass ? 'PASS' : 'FAIL',
      message: eval06.reason,
      durationMs: Date.now() - t06,
    });

    // RLS-RPT-07: student UPDATE reporter_id (immutability trigger)
    const t07 = Date.now();
    const res07 = await this.pool.student
      .from('reports')
      .update({ reporter_id: this.ids.coordId })
      .eq('id', this.fixtureRpt1Id);
    const eval07 = evaluateDenial(res07, {
      expectedKind: 'TRIGGER_EXCEPTION',
      expectedMessageSubstr: 'reporter_id is immutable',
    });
    this.record({
      id: 'RLS-RPT-07',
      name: 'Reporter ID immutability trigger guard',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: eval07.pass ? 'PASS' : 'FAIL',
      message: eval07.reason,
      durationMs: Date.now() - t07,
    });

    // RLS-RPT-08: student SELECT own report
    const t08 = Date.now();
    const { data: d08, error: err08 } = await this.pool.student
      .from('reports')
      .select('*')
      .eq('id', this.fixtureRpt1Id)
      .single();
    const pass08 = !err08 && d08 && d08.id === this.fixtureRpt1Id;
    this.record({
      id: 'RLS-RPT-08',
      name: 'Student reporter report visibility',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: pass08 ? 'PASS' : 'FAIL',
      message: pass08 ? 'Own report visible via can_view_report().' : `Failed: ${err08?.message}`,
      durationMs: Date.now() - t08,
    });

    // RLS-RPT-09: student SELECT report authored by another user
    const t09 = Date.now();
    // Create a coordinator-authored report to test horizontal report isolation
    const coordRptTitle = `${FIXTURE_PREFIX} Coordinator report for isolation test`;
    const { data: coordRpt } = await this.pool.coord
      .from('reports')
      .insert({
        title: coordRptTitle,
        description: 'Coord desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.coordId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (coordRpt) {
      this.ledger.reports.push({ id: coordRpt.id, title: coordRptTitle, reporterId: this.ids.coordId });
      saveLedger(this.ledger);
    }

    const res09 = await this.pool.student.from('reports').select('*').eq('id', coordRpt?.id);
    const eval09 = evaluateDenial(res09, { expectedKind: 'EMPTY_SET' });
    this.record({
      id: 'RLS-RPT-09',
      name: 'Student horizontal report isolation',
      domain: 'Domain 2: Reports',
      actingRole: 'student_personnel',
      status: eval09.pass ? 'PASS' : 'FAIL',
      message: eval09.reason,
      durationMs: Date.now() - t09,
    });

    // RLS-RPT-10: coordinator SELECT all reports
    const t10 = Date.now();
    const { data: d10, error: err10 } = await this.pool.coord.from('reports').select('*');
    const pass10 = !err10 && Array.isArray(d10) && d10.length >= 2;
    this.record({
      id: 'RLS-RPT-10',
      name: 'Coordinator triage report visibility',
      domain: 'Domain 2: Reports',
      actingRole: 'coordinator',
      status: pass10 ? 'PASS' : 'FAIL',
      message: pass10 ? `Returned ${d10.length} reports across all reporters.` : `Failed: ${err10?.message}`,
      durationMs: Date.now() - t10,
    });

    // RLS-RPT-11: management SELECT all reports
    const t11 = Date.now();
    const { data: d11, error: err11 } = await this.pool.mgmt.from('reports').select('*');
    const pass11 = !err11 && Array.isArray(d11) && d11.length >= 2;
    this.record({
      id: 'RLS-RPT-11',
      name: 'Management oversight report visibility',
      domain: 'Domain 2: Reports',
      actingRole: 'management',
      status: pass11 ? 'PASS' : 'FAIL',
      message: pass11 ? `Returned ${d11.length} reports campus-wide.` : `Failed: ${err11?.message}`,
      durationMs: Date.now() - t11,
    });
  }

  // ---------------------------------------------------------------------------
  // Domain 3: Technician Assignment, Decline Flow & Work Logs (10 Tests)
  // ---------------------------------------------------------------------------
  async runDomain3(): Promise<void> {
    console.log('\n--- DOMAIN 3: Assignments, Decline Flow & Work Logs ---');

    if (!this.fixtureRpt1Id || !this.fixtureRpt2Id) throw new Error('Missing primary fixtures');

    // RLS-ASG-01: coordinator INSERT assignment (assign RPT-1 to Tech)
    const t01 = Date.now();
    const { data: d01, error: err01 } = await this.pool.coord
      .from('assignments')
      .insert({
        report_id: this.fixtureRpt1Id,
        technician_id: this.ids.techId,
        assigned_by: this.ids.coordId,
        status: 'assigned',
        notes: `${FIXTURE_PREFIX} Initial dispatch`,
      })
      .select('id, status')
      .single();

    if (d01) {
      this.fixtureAsg1Id = d01.id;
      this.ledger.assignments.push({ id: d01.id, reportId: this.fixtureRpt1Id });
      saveLedger(this.ledger);
    }
    const pass01 = !err01 && d01 && d01.status === 'assigned';
    this.record({
      id: 'RLS-ASG-01',
      name: 'Coordinator assignment dispatch',
      domain: 'Domain 3: Assignments',
      actingRole: 'coordinator',
      status: pass01 ? 'PASS' : 'FAIL',
      message: pass01 ? 'Assignment created in assigned status.' : `Failed: ${err01?.message}`,
      durationMs: Date.now() - t01,
    });

    // RLS-ASG-02: technician SELECT assigned report
    const t02 = Date.now();
    const { data: d02, error: err02 } = await this.pool.tech
      .from('reports')
      .select('*')
      .eq('id', this.fixtureRpt1Id)
      .single();
    const pass02 = !err02 && d02 && d02.id === this.fixtureRpt1Id;
    this.record({
      id: 'RLS-ASG-02',
      name: 'Technician visibility of assigned report',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: pass02 ? 'PASS' : 'FAIL',
      message: pass02 ? 'Assigned report visible via qualifying assignment.' : `Failed: ${err02?.message}`,
      durationMs: Date.now() - t02,
    });

    // RLS-ASG-03: technician SELECT unassigned report (RPT-2)
    const t03 = Date.now();
    const res03 = await this.pool.tech.from('reports').select('*').eq('id', this.fixtureRpt2Id);
    const eval03 = evaluateDenial(res03, { expectedKind: 'EMPTY_SET' });
    this.record({
      id: 'RLS-ASG-03',
      name: 'Technician unassigned report isolation',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: eval03.pass ? 'PASS' : 'FAIL',
      message: eval03.reason,
      durationMs: Date.now() - t03,
    });

    // Create a second assignment to test decline edge cases without losing active work assignment
    const { data: asgDecline } = await this.pool.coord
      .from('assignments')
      .insert({
        report_id: this.fixtureRpt2Id,
        technician_id: this.ids.techId,
        assigned_by: this.ids.coordId,
        status: 'assigned',
        notes: `${FIXTURE_PREFIX} Decline flow test`,
      })
      .select('id')
      .single();

    if (asgDecline) {
      this.ledger.assignments.push({ id: asgDecline.id, reportId: this.fixtureRpt2Id });
      saveLedger(this.ledger);
    }

    // RLS-ASG-06: technician decline with whitespace decline_reason = '   ' (chk_decline_reason / RPC check)
    const t06 = Date.now();
    const res06 = await this.pool.tech.rpc('decline_assignment', {
      target_assignment_id: asgDecline?.id,
      reason: '   ',
    });
    const eval06 = evaluateDenial(res06, {
      expectedKind: 'TRIGGER_EXCEPTION',
      expectedMessageSubstr: 'non-empty decline reason',
    });
    this.record({
      id: 'RLS-ASG-06',
      name: 'Whitespace decline reason rejection',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: eval06.pass ? 'PASS' : 'FAIL',
      message: eval06.reason,
      durationMs: Date.now() - t06,
    });

    // RLS-ASG-04: technician decline assignment with valid reason (RPC)
    const t04 = Date.now();
    const { error: err04 } = await this.pool.tech.rpc('decline_assignment', {
      target_assignment_id: asgDecline?.id,
      reason: `${FIXTURE_PREFIX} Conflict with emergency water line repair`,
    });
    const pass04 = !err04;
    this.record({
      id: 'RLS-ASG-04',
      name: 'Technician authorized assignment decline',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: pass04 ? 'PASS' : 'FAIL',
      message: pass04 ? 'Assignment declined via RPC successfully.' : `Failed: ${err04?.message}`,
      durationMs: Date.now() - t04,
    });

    // RLS-ASG-05: technician SELECT report after decline (post-decline isolation)
    const t05 = Date.now();
    const res05 = await this.pool.tech.from('reports').select('*').eq('id', this.fixtureRpt2Id);
    const eval05 = evaluateDenial(res05, { expectedKind: 'EMPTY_SET' });
    this.record({
      id: 'RLS-ASG-05',
      name: 'Technician post-decline report isolation',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: eval05.pass ? 'PASS' : 'FAIL',
      message: eval05.reason,
      durationMs: Date.now() - t05,
    });

    // Transition fixture ASG-1 to in_progress for work tests
    await this.pool.tech
      .from('assignments')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', this.fixtureAsg1Id);
    this.fixtureAsgWorkId = this.fixtureAsg1Id;

    // RLS-ASG-07: technician decline assignment in in_progress status (forbidden)
    const t07 = Date.now();
    const res07 = await this.pool.tech.rpc('decline_assignment', {
      target_assignment_id: this.fixtureAsgWorkId,
      reason: 'Attempt decline while in progress',
    });
    const eval07 = evaluateDenial(res07, {
      expectedKind: 'TRIGGER_EXCEPTION',
      expectedMessageSubstr: 'can only be declined from assigned status',
    });
    this.record({
      id: 'RLS-ASG-07',
      name: 'Technician decline in-progress rejection',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: eval07.pass ? 'PASS' : 'FAIL',
      message: eval07.reason,
      durationMs: Date.now() - t07,
    });

    // RLS-ASG-08: technician UPDATE modifying assigned_by or notes (metadata tampering check)
    const t08 = Date.now();
    const res08 = await this.pool.tech
      .from('assignments')
      .update({ notes: 'Tampered notes', assigned_by: this.ids.techId })
      .eq('id', this.fixtureAsgWorkId);
    const eval08 = evaluateDenial(res08, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-ASG-08',
      name: 'Technician assignment metadata tampering rejection',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: eval08.pass ? 'PASS' : 'FAIL',
      message: eval08.reason,
      durationMs: Date.now() - t08,
    });

    // RLS-ASG-09: technician INSERT valid work_log on in_progress assignment
    const t09 = Date.now();
    const { data: d09, error: err09 } = await this.pool.tech
      .from('work_logs')
      .insert({
        assignment_id: this.fixtureAsgWorkId,
        technician_id: this.ids.techId,
        description: `${FIXTURE_PREFIX} Replaced pipe valve seal and pressure tested`,
        hours_spent: 2.5,
      })
      .select('id')
      .single();

    if (d09) {
      this.ledger.workLogs.push({ id: d09.id, assignmentId: this.fixtureAsgWorkId });
      saveLedger(this.ledger);
    }
    const pass09 = !err09 && d09 !== null;
    this.record({
      id: 'RLS-ASG-09',
      name: 'Technician work log recording',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: pass09 ? 'PASS' : 'FAIL',
      message: pass09 ? 'Work log entry inserted successfully.' : `Failed: ${err09?.message}`,
      durationMs: Date.now() - t09,
    });

    // RLS-ASG-10: technician INSERT work_log on declined assignment
    const t10 = Date.now();
    const res10 = await this.pool.tech.from('work_logs').insert({
      assignment_id: asgDecline?.id,
      technician_id: this.ids.techId,
      description: `${FIXTURE_PREFIX} Phantom work log on declined task`,
      hours_spent: 1.0,
    });
    const eval10 = evaluateDenial(res10, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-ASG-10',
      name: 'Work log on declined assignment rejection',
      domain: 'Domain 3: Assignments',
      actingRole: 'technician',
      status: eval10.pass ? 'PASS' : 'FAIL',
      message: eval10.reason,
      durationMs: Date.now() - t10,
    });
  }

  // ---------------------------------------------------------------------------
  // Domain 4: Report Cancellation & Status Transitions (5 Tests)
  // ---------------------------------------------------------------------------
  async runDomain4(): Promise<void> {
    console.log('\n--- DOMAIN 4: Report Cancellation & Status Transitions ---');

    // Create a dedicated submitted report for cancellation tests
    const rptCancelTitle = `${FIXTURE_PREFIX} Report for cancel test`;
    const { data: rptCancel } = await this.pool.student
      .from('reports')
      .insert({
        title: rptCancelTitle,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (rptCancel) {
      this.ledger.reports.push({ id: rptCancel.id, title: rptCancelTitle, reporterId: this.ids.studentId });
      saveLedger(this.ledger);
    }

    // RLS-CAN-01: student cancel own report in submitted status
    const t01 = Date.now();
    const { error: err01 } = await this.pool.student
      .from('reports')
      .update({ status: 'cancelled' })
      .eq('id', rptCancel?.id);
    const pass01 = !err01;
    this.record({
      id: 'RLS-CAN-01',
      name: 'Student early cancellation of submitted report',
      domain: 'Domain 4: Cancellations',
      actingRole: 'student_personnel',
      status: pass01 ? 'PASS' : 'FAIL',
      message: pass01 ? 'Report status transitioned to cancelled.' : `Failed: ${err01?.message}`,
      durationMs: Date.now() - t01,
    });

    // Create a report transitioned to in_progress to test cancellation boundary
    const rptProgTitle = `${FIXTURE_PREFIX} Report in progress for cancel boundary`;
    const { data: rptProg } = await this.pool.student
      .from('reports')
      .insert({
        title: rptProgTitle,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (rptProg) {
      this.ledger.reports.push({ id: rptProg.id, title: rptProgTitle, reporterId: this.ids.studentId });
      saveLedger(this.ledger);
      // Coordinator updates status to in_progress
      await this.pool.coord.from('reports').update({ status: 'in_progress' }).eq('id', rptProg.id);
    }

    // RLS-CAN-02: student attempt cancellation of in_progress report (forbidden)
    const t02 = Date.now();
    const res02 = await this.pool.student
      .from('reports')
      .update({ status: 'cancelled' })
      .eq('id', rptProg?.id);
    const eval02 = evaluateDenial(res02, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-CAN-02',
      name: 'Student cancellation during repair rejection',
      domain: 'Domain 4: Cancellations',
      actingRole: 'student_personnel',
      status: eval02.pass ? 'PASS' : 'FAIL',
      message: eval02.reason,
      durationMs: Date.now() - t02,
    });

    // RLS-CAN-03: coordinator administrative cancellation of in_progress report
    const t03 = Date.now();
    const { error: err03 } = await this.pool.coord
      .from('reports')
      .update({ status: 'cancelled' })
      .eq('id', rptProg?.id);
    const pass03 = !err03;
    this.record({
      id: 'RLS-CAN-03',
      name: 'Coordinator administrative cancellation',
      domain: 'Domain 4: Cancellations',
      actingRole: 'coordinator',
      status: pass03 ? 'PASS' : 'FAIL',
      message: pass03 ? 'Coordinator cancelled report successfully.' : `Failed: ${err03?.message}`,
      durationMs: Date.now() - t03,
    });

    // RLS-CAN-04: coordinator cancels active assignments on cancelled report
    const t04 = Date.now();
    const { error: err04 } = await this.pool.coord
      .from('assignments')
      .update({ status: 'cancelled' })
      .eq('report_id', rptProg?.id);
    const pass04 = !err04;
    this.record({
      id: 'RLS-CAN-04',
      name: 'Coordinator active assignment cancellation',
      domain: 'Domain 4: Cancellations',
      actingRole: 'coordinator',
      status: pass04 ? 'PASS' : 'FAIL',
      message: pass04 ? 'Active assignments transitioned to cancelled.' : `Failed: ${err04?.message}`,
      durationMs: Date.now() - t04,
    });

    // RLS-AUD-01: Trigger T3 status history audit generation check
    const t05 = Date.now();
    const { data: histData, error: histErr } = await this.pool.coord
      .from('report_status_history')
      .select('*')
      .eq('report_id', rptProg?.id);
    const pass05 = !histErr && Array.isArray(histData) && histData.length >= 1;
    this.record({
      id: 'RLS-AUD-01',
      name: 'Trigger T3 automatic status history audit record',
      domain: 'Domain 4: Cancellations',
      actingRole: 'coordinator',
      status: pass05 ? 'PASS' : 'FAIL',
      message: pass05 ? `Trigger T3 recorded ${histData?.length} transitions automatically.` : `Failed: ${histErr?.message}`,
      durationMs: Date.now() - t05,
    });
  }

  // ---------------------------------------------------------------------------
  // Domain 5: Coordinator Verification Restrictions (5 Tests)
  // ---------------------------------------------------------------------------
  async runDomain5(): Promise<void> {
    console.log('\n--- DOMAIN 5: Coordinator Verification Restrictions ---');

    // Setup completed report authored by Student
    const rptCompleteTitle = `${FIXTURE_PREFIX} Completed report for verification`;
    const { data: rptComplete } = await this.pool.student
      .from('reports')
      .insert({
        title: rptCompleteTitle,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (rptComplete) {
      this.ledger.reports.push({ id: rptComplete.id, title: rptCompleteTitle, reporterId: this.ids.studentId });
      saveLedger(this.ledger);
      // Coordinator advances to completed
      await this.pool.coord.from('reports').update({ status: 'completed' }).eq('id', rptComplete.id);
    }

    // RLS-VER-01: coordinator INSERT verification on completed student report
    const t01 = Date.now();
    const { data: d01, error: err01 } = await this.pool.coord
      .from('verifications')
      .insert({
        report_id: rptComplete?.id,
        verified_by: this.ids.coordId,
        is_satisfactory: true,
        notes: `${FIXTURE_PREFIX} Inspected and verified by Coordinator`,
      })
      .select('id')
      .single();

    if (d01) {
      this.ledger.verifications.push({ id: d01.id, reportId: rptComplete?.id });
      saveLedger(this.ledger);
    }
    const pass01 = !err01 && d01 !== null;
    this.record({
      id: 'RLS-VER-01',
      name: 'Coordinator authorized verification sign-off',
      domain: 'Domain 5: Verifications',
      actingRole: 'coordinator',
      status: pass01 ? 'PASS' : 'FAIL',
      message: pass01 ? 'Verification row inserted successfully.' : `Failed: ${err01?.message}`,
      durationMs: Date.now() - t01,
    });

    // RLS-VER-02: coordinator attempts verification on report authored by coordinator (self-dealing check)
    const t02 = Date.now();
    const rptCoordOwnTitle = `${FIXTURE_PREFIX} Coordinator self-authored report`;
    const { data: rptCoordOwn } = await this.pool.coord
      .from('reports')
      .insert({
        title: rptCoordOwnTitle,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.coordId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (rptCoordOwn) {
      this.ledger.reports.push({ id: rptCoordOwn.id, title: rptCoordOwnTitle, reporterId: this.ids.coordId });
      saveLedger(this.ledger);
      await this.pool.coord.from('reports').update({ status: 'completed' }).eq('id', rptCoordOwn.id);
    }

    const res02 = await this.pool.coord.from('verifications').insert({
      report_id: rptCoordOwn?.id,
      verified_by: this.ids.coordId,
      is_satisfactory: true,
      notes: 'Attempt self-verification of own report',
    });
    const eval02 = evaluateDenial(res02, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-VER-02',
      name: 'Coordinator self-authored verification rejection',
      domain: 'Domain 5: Verifications',
      actingRole: 'coordinator',
      status: eval02.pass ? 'PASS' : 'FAIL',
      message: eval02.reason,
      durationMs: Date.now() - t02,
    });

    // RLS-VER-03: coordinator attempts verification on report where coordinator was technician (self-repair check)
    const t03 = Date.now();
    const rptSelfRepairTitle = `${FIXTURE_PREFIX} Coordinator self-repair report`;
    const { data: rptSelfRepair } = await this.pool.student
      .from('reports')
      .insert({
        title: rptSelfRepairTitle,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (rptSelfRepair) {
      this.ledger.reports.push({ id: rptSelfRepair.id, title: rptSelfRepairTitle, reporterId: this.ids.studentId });
      // Assign coordinator as technician on this report
      const { data: asgSelf } = await this.pool.coord
        .from('assignments')
        .insert({
          report_id: rptSelfRepair.id,
          technician_id: this.ids.coordId,
          assigned_by: this.ids.coordId,
          status: 'assigned',
        })
        .select('id')
        .single();
      if (asgSelf) this.ledger.assignments.push({ id: asgSelf.id, reportId: rptSelfRepair.id });
      await this.pool.coord.from('reports').update({ status: 'completed' }).eq('id', rptSelfRepair.id);
      saveLedger(this.ledger);
    }

    const res03 = await this.pool.coord.from('verifications').insert({
      report_id: rptSelfRepair?.id,
      verified_by: this.ids.coordId,
      is_satisfactory: true,
      notes: 'Attempt verify own technician repair work',
    });
    const eval03 = evaluateDenial(res03, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-VER-03',
      name: 'Coordinator self-repair verification rejection',
      domain: 'Domain 5: Verifications',
      actingRole: 'coordinator',
      status: eval03.pass ? 'PASS' : 'FAIL',
      message: eval03.reason,
      durationMs: Date.now() - t03,
    });

    // RLS-VER-04: coordinator verification on in_progress report (premature verification rejection)
    const t04 = Date.now();
    const rptPremTitle = `${FIXTURE_PREFIX} Premature report for verification`;
    const { data: rptPrem } = await this.pool.student
      .from('reports')
      .insert({
        title: rptPremTitle,
        description: 'desc',
        category_id: this.seed.categoryId,
        location_id: this.seed.locationId,
        reporter_id: this.ids.studentId,
        status: 'submitted',
      })
      .select('id')
      .single();

    if (rptPrem) {
      this.ledger.reports.push({ id: rptPrem.id, title: rptPremTitle, reporterId: this.ids.studentId });
      saveLedger(this.ledger);
      await this.pool.coord.from('reports').update({ status: 'in_progress' }).eq('id', rptPrem.id);
    }

    const res04 = await this.pool.coord.from('verifications').insert({
      report_id: rptPrem?.id,
      verified_by: this.ids.coordId,
      is_satisfactory: true,
      notes: 'Premature verification attempt',
    });
    const eval04 = evaluateDenial(res04, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-VER-04',
      name: 'Coordinator premature verification rejection',
      domain: 'Domain 5: Verifications',
      actingRole: 'coordinator',
      status: eval04.pass ? 'PASS' : 'FAIL',
      message: eval04.reason,
      durationMs: Date.now() - t04,
    });

    // RLS-VER-05: technician attempts verification sign-off (unauthorized role)
    const t05 = Date.now();
    const res05 = await this.pool.tech.from('verifications').insert({
      report_id: rptComplete?.id,
      verified_by: this.ids.techId,
      is_satisfactory: true,
      notes: 'Technician unauthorized sign-off',
    });
    const eval05 = evaluateDenial(res05, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-VER-05',
      name: 'Technician unauthorized verification rejection',
      domain: 'Domain 5: Verifications',
      actingRole: 'technician',
      status: eval05.pass ? 'PASS' : 'FAIL',
      message: eval05.reason,
      durationMs: Date.now() - t05,
    });
  }

  // ---------------------------------------------------------------------------
  // Domain 6: Comments & Notification Immutability (6 Tests)
  // ---------------------------------------------------------------------------
  async runDomain6(): Promise<void> {
    console.log('\n--- DOMAIN 6: Comments & Notification Immutability ---');

    if (!this.fixtureRpt1Id) throw new Error('Missing primary report fixture');

    // RLS-COM-01: student INSERT comment on own report
    const t01 = Date.now();
    const { data: d01, error: err01 } = await this.pool.student
      .from('report_comments')
      .insert({
        report_id: this.fixtureRpt1Id,
        author_id: this.ids.studentId,
        content: `${FIXTURE_PREFIX} Plumber has arrived and shut off the main valve`,
      })
      .select('id')
      .single();

    if (d01) {
      this.fixtureCom1Id = d01.id;
      this.ledger.comments.push({ id: d01.id, reportId: this.fixtureRpt1Id });
      saveLedger(this.ledger);
    }
    const pass01 = !err01 && d01 !== null;
    this.record({
      id: 'RLS-COM-01',
      name: 'Student report comment insertion',
      domain: 'Domain 6: Comments',
      actingRole: 'student_personnel',
      status: pass01 ? 'PASS' : 'FAIL',
      message: pass01 ? 'Comment created successfully.' : `Failed: ${err01?.message}`,
      durationMs: Date.now() - t01,
    });

    // RLS-COM-02: student UPDATE comment content (comment immutability check)
    const t02 = Date.now();
    const res02 = await this.pool.student
      .from('report_comments')
      .update({ content: 'Altered comment content' })
      .eq('id', this.fixtureCom1Id);
    const eval02 = evaluateDenial(res02, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-COM-02',
      name: 'Report comment immutability check',
      domain: 'Domain 6: Comments',
      actingRole: 'student_personnel',
      status: eval02.pass ? 'PASS' : 'FAIL',
      message: eval02.reason,
      durationMs: Date.now() - t02,
    });

    // RLS-COM-03: coordinator DELETE comment (comment deletion check)
    const t03 = Date.now();
    const res03 = await this.pool.coord.from('report_comments').delete().eq('id', this.fixtureCom1Id);
    const eval03 = evaluateDenial(res03, { expectedKind: 'RLS_VIOLATION' });
    this.record({
      id: 'RLS-COM-03',
      name: 'Report comment deletion prevention check',
      domain: 'Domain 6: Comments',
      actingRole: 'coordinator',
      status: eval03.pass ? 'PASS' : 'FAIL',
      message: eval03.reason,
      durationMs: Date.now() - t03,
    });

    // Setup notification fixture for student
    const notifTitle = `${FIXTURE_PREFIX} Your report status updated`;
    const { data: dNotif } = await this.pool.coord
      .from('notifications')
      .insert({
        recipient_id: this.ids.studentId,
        type: 'status_changed',
        title: notifTitle,
        message: 'Your report has been assigned to a technician.',
        report_id: this.fixtureRpt1Id,
        is_read: false,
      })
      .select('id')
      .single();

    if (dNotif) {
      this.fixtureNotif1Id = dNotif.id;
      this.ledger.notifications.push({ id: dNotif.id, recipientId: this.ids.studentId });
      saveLedger(this.ledger);
    }

    // RLS-NOT-01: student UPDATE notification is_read = true (authorized acknowledgment)
    const t04 = Date.now();
    const { error: err04 } = await this.pool.student
      .from('notifications')
      .update({ is_read: true })
      .eq('id', this.fixtureNotif1Id);
    const pass04 = !err04;
    this.record({
      id: 'RLS-NOT-01',
      name: 'Student notification acknowledgment',
      domain: 'Domain 6: Notifications',
      actingRole: 'student_personnel',
      status: pass04 ? 'PASS' : 'FAIL',
      message: pass04 ? 'Notification is_read set to true.' : `Failed: ${err04?.message}`,
      durationMs: Date.now() - t04,
    });

    // RLS-NOT-02: student UPDATE notification title (column-level privilege check)
    const t05 = Date.now();
    const res05 = await this.pool.student
      .from('notifications')
      .update({ title: 'Spoofed Notification Title' })
      .eq('id', this.fixtureNotif1Id);
    const eval05 = evaluateDenial(res05, { expectedKind: 'COLUMN_DENIAL' });
    this.record({
      id: 'RLS-NOT-02',
      name: 'Notification column grant restriction check',
      domain: 'Domain 6: Notifications',
      actingRole: 'student_personnel',
      status: eval05.pass ? 'PASS' : 'FAIL',
      message: eval05.reason,
      durationMs: Date.now() - t05,
    });

    // RLS-NOT-03: student SELECT coordinator notification (cross-user notification isolation)
    const t06 = Date.now();
    const { data: coordNotif } = await this.pool.coord
      .from('notifications')
      .insert({
        recipient_id: this.ids.coordId,
        type: 'assignment_created',
        title: `${FIXTURE_PREFIX} Coordinator task alert`,
        message: 'Coord notif msg',
        is_read: false,
      })
      .select('id')
      .single();

    if (coordNotif) {
      this.ledger.notifications.push({ id: coordNotif.id, recipientId: this.ids.coordId });
      saveLedger(this.ledger);
    }

    const res06 = await this.pool.student.from('notifications').select('*').eq('id', coordNotif?.id);
    const eval06 = evaluateDenial(res06, { expectedKind: 'EMPTY_SET' });
    this.record({
      id: 'RLS-NOT-03',
      name: 'Cross-user notification isolation',
      domain: 'Domain 6: Notifications',
      actingRole: 'student_personnel',
      status: eval06.pass ? 'PASS' : 'FAIL',
      message: eval06.reason,
      durationMs: Date.now() - t06,
    });
  }

  // ---------------------------------------------------------------------------
  // Domain 7: Storage & File Attachment Security (9 Tests)
  // ---------------------------------------------------------------------------
  async runDomain7(): Promise<void> {
    console.log('\n--- DOMAIN 7: Storage & File Attachment Security ---');

    if (!this.fixtureRpt1Id) throw new Error('Missing primary report fixture');

    const attachmentId = crypto.randomUUID();
    const canonicalStoragePath = `reports/${this.fixtureRpt1Id}/${attachmentId}.png`;

    // RLS-ATT-01: student upload valid image to canonical path
    const t01 = Date.now();
    const { error: errUpload01 } = await this.pool.student.storage
      .from('report-attachments')
      .upload(canonicalStoragePath, DUMMY_PNG_BUFFER, {
        contentType: 'image/png',
        upsert: false,
      });

    // If file uploaded, record path in ledger immediately
    if (!errUpload01) {
      this.fixtureAtt1Path = canonicalStoragePath;
      this.ledger.storagePaths.push(canonicalStoragePath);
      saveLedger(this.ledger);

      // Also record metadata in report_attachments table
      const { data: dAtt } = await this.pool.student
        .from('report_attachments')
        .insert({
          id: attachmentId,
          report_id: this.fixtureRpt1Id,
          file_path: canonicalStoragePath,
          file_name: 'test_photo.png',
          file_size: DUMMY_PNG_BUFFER.length,
          mime_type: 'image/png',
          uploaded_by: this.ids.studentId,
        })
        .select('id')
        .single();

      if (dAtt) {
        this.fixtureAtt1Id = dAtt.id;
        this.ledger.attachments.push({ id: dAtt.id, reportId: this.fixtureRpt1Id, filePath: canonicalStoragePath });
        saveLedger(this.ledger);
      }
    }

    const pass01 = !errUpload01;
    this.record({
      id: 'RLS-ATT-01',
      name: 'Student authorized attachment upload',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: pass01 ? 'PASS' : 'FAIL',
      message: pass01 ? 'Image uploaded and metadata recorded.' : `Failed: ${errUpload01?.message}`,
      durationMs: Date.now() - t01,
    });

    // RLS-ATT-02: student upload to non-canonical / invalid path (regex guard check)
    const t02 = Date.now();
    const invalidPath = `reports/invalid-path/${crypto.randomUUID()}.png`;
    const { error: err02 } = await this.pool.student.storage
      .from('report-attachments')
      .upload(invalidPath, DUMMY_PNG_BUFFER, { contentType: 'image/png' });
    const pass02 = !!err02;
    this.record({
      id: 'RLS-ATT-02',
      name: 'Storage path regex validation guard check',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: pass02 ? 'PASS' : 'FAIL',
      message: pass02 ? `Rejected by path regex: ${err02?.message}` : 'SECURITY FAIL: Non-canonical upload succeeded.',
      durationMs: Date.now() - t02,
    });

    // RLS-ATT-03: student upload forbidden MIME type (.exe / .pdf)
    const t03 = Date.now();
    const badMimePath = `reports/${this.fixtureRpt1Id}/${crypto.randomUUID()}.exe`;
    const { error: err03 } = await this.pool.student.storage
      .from('report-attachments')
      .upload(badMimePath, DUMMY_PNG_BUFFER, { contentType: 'application/x-msdownload' });
    const pass03 = !!err03;
    this.record({
      id: 'RLS-ATT-03',
      name: 'Storage MIME whitelist rejection check',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: pass03 ? 'PASS' : 'FAIL',
      message: pass03 ? `Rejected by MIME whitelist: ${err03?.message}` : 'SECURITY FAIL: Malicious MIME upload succeeded.',
      durationMs: Date.now() - t03,
    });

    // RLS-ATT-04: student upload exceeding 10 MB limit (bucket size boundary)
    const t04 = Date.now();
    // Simulate oversized upload attempt via 10.1 MB buffer header or size check
    // Using a synthetic 10.1 MB buffer
    const oversizedBuffer = Buffer.alloc(10485760 + 1024);
    const oversizedPath = `reports/${this.fixtureRpt1Id}/${crypto.randomUUID()}.png`;
    const { error: err04 } = await this.pool.student.storage
      .from('report-attachments')
      .upload(oversizedPath, oversizedBuffer, { contentType: 'image/png' });
    const pass04 = !!err04;
    this.record({
      id: 'RLS-ATT-04',
      name: 'Storage file size boundary enforcement check',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: pass04 ? 'PASS' : 'FAIL',
      message: pass04 ? `Rejected by size boundary: ${err04?.message}` : 'SECURITY FAIL: Oversized upload succeeded.',
      durationMs: Date.now() - t04,
    });

    // Setup 4 additional active attachments to reach 5 total (for Trigger T5 limit test)
    const extraAttIds: string[] = [];
    for (let i = 2; i <= 5; i++) {
      const extraId = crypto.randomUUID();
      const extraPath = `reports/${this.fixtureRpt1Id}/${extraId}.png`;
      const { error: extraErr } = await this.pool.student
        .from('report_attachments')
        .insert({
          id: extraId,
          report_id: this.fixtureRpt1Id,
          file_path: extraPath,
          file_name: `photo_${i}.png`,
          file_size: 1024,
          mime_type: 'image/png',
          uploaded_by: this.ids.studentId,
        });
      if (!extraErr) {
        extraAttIds.push(extraId);
        this.ledger.attachments.push({ id: extraId, reportId: this.fixtureRpt1Id, filePath: extraPath });
      }
    }
    saveLedger(this.ledger);

    // RLS-ATT-05: insert 6th active attachment (Trigger T5 max 5 active attachments limit)
    const t05 = Date.now();
    const res05 = await this.pool.student.from('report_attachments').insert({
      id: crypto.randomUUID(),
      report_id: this.fixtureRpt1Id,
      file_path: `reports/${this.fixtureRpt1Id}/${crypto.randomUUID()}.png`,
      file_name: 'photo_6_overflow.png',
      file_size: 1024,
      mime_type: 'image/png',
      uploaded_by: this.ids.studentId,
    });
    const eval05 = evaluateDenial(res05, {
      expectedKind: 'TRIGGER_EXCEPTION',
      expectedMessageSubstr: 'Maximum 5 active attachments allowed',
    });
    this.record({
      id: 'RLS-ATT-05',
      name: 'Trigger T5 attachment count concurrency limit check',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: eval05.pass ? 'PASS' : 'FAIL',
      message: eval05.reason,
      durationMs: Date.now() - t05,
    });

    // RLS-ATT-06: coordinator soft-delete attachment via RPC soft_delete_attachment
    const t06 = Date.now();
    const { error: err06 } = await this.pool.coord.rpc('soft_delete_attachment', {
      attachment_id: this.fixtureAtt1Id,
    });
    const pass06 = !err06;
    this.record({
      id: 'RLS-ATT-06',
      name: 'Coordinator authorized attachment soft-deletion',
      domain: 'Domain 7: Storage',
      actingRole: 'coordinator',
      status: pass06 ? 'PASS' : 'FAIL',
      message: pass06 ? 'Attachment soft-deleted via RPC.' : `Failed: ${err06?.message}`,
      durationMs: Date.now() - t06,
    });

    // RLS-ATT-07: student download soft-deleted attachment (moderation download isolation)
    const t07 = Date.now();
    if (!this.fixtureAtt1Path) throw new Error('Missing attachment file path');
    const { data: d07, error: err07 } = await this.pool.student.storage
      .from('report-attachments')
      .download(this.fixtureAtt1Path);
    const pass07 = !!err07 || !d07;
    this.record({
      id: 'RLS-ATT-07',
      name: 'Student soft-deleted attachment download isolation',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: pass07 ? 'PASS' : 'FAIL',
      message: pass07 ? 'Download properly denied for soft-deleted file.' : 'SECURITY FAIL: Soft-deleted file downloaded.',
      durationMs: Date.now() - t07,
    });

    // RLS-ATT-08: coordinator download soft-deleted attachment (moderation audit oversight)
    const t08 = Date.now();
    const { data: d08, error: err08 } = await this.pool.coord.storage
      .from('report-attachments')
      .download(this.fixtureAtt1Path);
    const pass08 = !err08 && !!d08;
    this.record({
      id: 'RLS-ATT-08',
      name: 'Coordinator soft-deleted attachment audit access',
      domain: 'Domain 7: Storage',
      actingRole: 'coordinator',
      status: pass08 ? 'PASS' : 'FAIL',
      message: pass08 ? 'Coordinator downloaded soft-deleted file for moderation audit.' : `Failed: ${err08?.message}`,
      durationMs: Date.now() - t08,
    });

    // RLS-ATT-09: attempt in-place file replacement (UPDATE storage.objects)
    const t09 = Date.now();
    const { error: err09 } = await this.pool.student.storage
      .from('report-attachments')
      .update(this.fixtureAtt1Path, DUMMY_PNG_BUFFER);
    const pass09 = !!err09;
    this.record({
      id: 'RLS-ATT-09',
      name: 'Storage object in-place mutation prevention check',
      domain: 'Domain 7: Storage',
      actingRole: 'student_personnel',
      status: pass09 ? 'PASS' : 'FAIL',
      message: pass09 ? `In-place update properly denied: ${err09?.message}` : 'SECURITY FAIL: Storage in-place update succeeded.',
      durationMs: Date.now() - t09,
    });
  }

  // ---------------------------------------------------------------------------
  // Suite Execution Runner
  // ---------------------------------------------------------------------------
  async runAll(): Promise<{ passed: number; failed: number; total: number }> {
    console.log(`\n================================================================================`);
    console.log(`STARTING CMIRS 55-TEST RLS INTEGRATION SUITE [${RUN_ID}]`);
    console.log(`================================================================================`);

    await this.runDomain1();
    await this.runDomain2();
    await this.runDomain3();
    await this.runDomain4();
    await this.runDomain5();
    await this.runDomain6();
    await this.runDomain7();

    const passed = this.results.filter((r) => r.status === 'PASS').length;
    const failed = this.results.filter((r) => r.status === 'FAIL' || r.status === 'HARNESS_ERROR').length;
    const total = this.results.length;

    console.log(`\n================================================================================`);
    console.log(`TEST SUITE EXECUTION SUMMARY`);
    console.log(`================================================================================`);
    console.log(`Total Specifications: ${total} / 55`);
    console.log(`Passed:               ${passed}`);
    console.log(`Failed:               ${failed}`);
    console.log(`================================================================================\n`);

    return { passed, failed, total };
  }

  getResults(): TestResult[] {
    return this.results;
  }
}

// =============================================================================
// 9. Deterministic Cleanup & Teardown Protocol
// =============================================================================

export async function performTeardown(
  ledger: FixtureLedger,
  pool: ClientPool,
  verbose = true
): Promise<{ success: boolean; purgedStorage: number; purgedReports: number }> {
  if (verbose) {
    console.log('\n[TEARDOWN] Initiating deterministic fixture cleanup...');
    console.log(`[TEARDOWN] Tracked storage paths: ${ledger.storagePaths.length}`);
    console.log(`[TEARDOWN] Tracked report fixtures: ${ledger.reports.length}`);
  }

  let purgedStorage = 0;
  let purgedReports = 0;

  // Step 1: Storage API Cleanup
  if (ledger.storagePaths.length > 0) {
    if (pool.adminTeardown) {
      if (verbose) console.log('[TEARDOWN] Purging storage objects via admin teardown client...');
      const { data, error } = await pool.adminTeardown.storage
        .from('report-attachments')
        .remove(ledger.storagePaths);
      if (error) {
        console.error('[TEARDOWN WARNING] Storage purge returned error:', error.message);
      } else {
        purgedStorage = data?.length || ledger.storagePaths.length;
        if (verbose) console.log(`[TEARDOWN] Purged ${purgedStorage} storage objects.`);
      }
    } else {
      // Attempt removal via student client (may be denied by RLS default deny)
      const { data, error } = await pool.student.storage
        .from('report-attachments')
        .remove(ledger.storagePaths);
      if (error) {
        if (verbose) {
          console.log(
            '[TEARDOWN INFO] Storage deletion denied by client RLS (expected). Generating targeted SQL.'
          );
        }
      } else {
        purgedStorage = data?.length || 0;
      }
    }
  }

  // Step 2: Database Record Cleanup by Exact UUID
  const reportIds = ledger.reports.map((r) => r.id);
  if (reportIds.length > 0) {
    if (pool.adminTeardown) {
      if (verbose) console.log('[TEARDOWN] Purging report fixtures via admin teardown client...');
      const { error } = await pool.adminTeardown.from('reports').delete().in('id', reportIds);
      if (error) {
        console.error('[TEARDOWN WARNING] Report delete returned error:', error.message);
      } else {
        purgedReports = reportIds.length;
        if (verbose) {
          console.log(`[TEARDOWN] Purged ${purgedReports} reports (cascaded to child tables).`);
        }
      }
    } else {
      // Generate exact targeted SQL script for operator execution
      const sqlLines = [
        `-- CMIRS Gate E.4B Deterministic Cleanup Script for ${ledger.runId}`,
        `-- Generated at: ${new Date().toISOString()}`,
        `BEGIN;`,
        ``,
        `-- 1. Purge exact storage objects created during run`,
      ];

      if (ledger.storagePaths.length > 0) {
        const pathList = ledger.storagePaths.map((p) => `'${p}'`).join(', ');
        sqlLines.push(
          `DELETE FROM storage.objects WHERE bucket_id = 'report-attachments' AND name IN (${pathList});`
        );
      } else {
        sqlLines.push(`-- No storage objects were tracked.`);
      }

      sqlLines.push(``, `-- 2. Purge exact reports (cascades to all 6 child tables)`);
      const idList = reportIds.map((id) => `'${id}'`).join(', ');
      sqlLines.push(`DELETE FROM public.reports WHERE id IN (${idList});`);
      sqlLines.push(``, `COMMIT;`);

      fs.writeFileSync(CLEANUP_SQL_PATH, sqlLines.join('\n'), 'utf-8');
      if (verbose) {
        console.log(`[TEARDOWN] Exact targeted SQL cleanup script written to: ${CLEANUP_SQL_PATH}`);
        console.log(`[TEARDOWN] Run via: npx supabase db query --linked --file ${CLEANUP_SQL_PATH}`);
      }
    }
  }

  // Step 3: Mark ledger completed
  ledger.completedAt = new Date().toISOString();
  saveLedger(ledger);

  return { success: true, purgedStorage, purgedReports };
}

// =============================================================================
// 10. CLI Entry Point & Guard
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isCleanupOnly = args.includes('--cleanup-only');
  const isDryRun = args.includes('--dry-run') || (!isExecute && !isCleanupOnly);

  console.log(`================================================================================`);
  console.log(`CMIRS Role-Based RLS Integration Test Runner`);
  console.log(`Target Reference: xyirfifvcntuzceivtho`);
  console.log(`Mode: ${isExecute ? 'EXECUTE (CLOUD)' : isCleanupOnly ? 'CLEANUP ONLY' : 'SAFE DRY RUN / PREFLIGHT'}`);
  console.log(`================================================================================`);

  // Load environment credentials securely
  const env = loadEnvironment();

  // Mode A: Cleanup Only
  if (isCleanupOnly) {
    if (!fs.existsSync(LEDGER_FILE_PATH)) {
      console.log('[CLEANUP] No active run ledger found at .rls-run-ledger.json. Nothing to clean.');
      process.exit(0);
    }
    const raw = fs.readFileSync(LEDGER_FILE_PATH, 'utf-8');
    const ledger: FixtureLedger = JSON.parse(raw);
    const { pool } = await createClientPool(env.supabaseUrl, env.publishableKey, env.testPassword, env.serviceRoleKey);
    await performTeardown(ledger, pool, true);
    console.log('[CLEANUP] Teardown complete.');
    process.exit(0);
  }

  // Mode B: Safe Dry Run / Verification (Default without --execute)
  if (isDryRun) {
    console.log('\n[SAFE PREFLIGHT CHECK]');
    console.log('1. Configuration & environment: OK');
    console.log('2. Supabase endpoint:          ', env.supabaseUrl);
    console.log('3. Publishable key configured:  YES (length: ' + env.publishableKey.length + ')');
    console.log('4. CMIRS_TEST_PASSWORD present: YES (protected, not printed)');
    console.log('5. Service-role key optional:  ', env.serviceRoleKey ? 'Configured (teardown only)' : 'Not set (will write SQL)');
    console.log('6. Total planned specifications: 55 across 7 domains');
    console.log('\n[NOTICE] Remote execution was NOT requested.');
    console.log('To run tests against Supabase Cloud, provide explicit owner authorization and pass:');
    console.log('  npx tsx tests/integration/rls-runner.ts --execute');
    process.exit(0);
  }

  // Mode C: Full Execution (Only when --execute is explicitly supplied)
  const ledger = initializeLedger();
  const { pool, identities } = await createClientPool(
    env.supabaseUrl,
    env.publishableKey,
    env.testPassword,
    env.serviceRoleKey
  );
  const seed = await fetchSeedReferences(pool.student);

  const suite = new RlsTestSuite(pool, identities, seed, ledger);

  try {
    const summary = await suite.runAll();
    await performTeardown(ledger, pool, true);
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n[FATAL RUNNER EXCEPTION]:', (err as Error).message);
    console.log('[RECOVERY] Executing emergency teardown of tracked fixtures...');
    await performTeardown(ledger, pool, true);
    process.exit(1);
  }
}

// Only invoke main when run directly as CLI
if (require.main === module || process.argv[1]?.includes('rls-runner')) {
  main().catch((err) => {
    console.error('[UNHANDLED FATAL ERROR]:', err);
    process.exit(1);
  });
}
