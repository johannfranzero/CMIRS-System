/**
 * CMIRS Gate E.4C-R — Local Safety Unit Tests
 * File: tests/integration/rls-runner-safety.test.ts
 *
 * Scope: 100% LOCAL verification of Patches 1-4.
 * Zero network requests, zero database calls, zero cloud interactions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  EXPECTED_PROJECT_REF,
  EXPECTED_HOSTNAME,
  validateTargetSupabaseUrl,
  isValidUuid,
  isValidStoragePath,
  loadAndValidateLedger,
  performTeardown,
} from './rls-runner.ts';
import type { FixtureLedger, ClientPool } from './rls-runner.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, errorDetail?: string) {
  if (condition) {
    passed++;
    console.log(`  [\x1b[32mPASS\x1b[0m] ${testName}`);
  } else {
    failed++;
    console.error(`  [\x1b[31mFAIL\x1b[0m] ${testName}: ${errorDetail || 'Assertion failed'}`);
  }
}

function expectThrows(fn: () => void, testName: string, expectedSubstr?: string) {
  try {
    fn();
    failed++;
    console.error(`  [\x1b[31mFAIL\x1b[0m] ${testName}: Expected function to throw, but it succeeded`);
  } catch (err) {
    const msg = (err as Error).message;
    if (expectedSubstr && !msg.includes(expectedSubstr)) {
      failed++;
      console.error(`  [\x1b[31mFAIL\x1b[0m] ${testName}: Threw '${msg}', expected substring '${expectedSubstr}'`);
    } else {
      passed++;
      console.log(`  [\x1b[32mPASS\x1b[0m] ${testName} (Threw: ${msg})`);
    }
  }
}

async function runLocalSafetyTests() {
  console.log('\n================================================================================');
  console.log('RUNNING LOCAL SAFETY TESTS FOR GATE E.4C-R PATCHES (OFFLINE)');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Patch 1: Target Project Validation Tests
  // ---------------------------------------------------------------------------
  console.log('--- 1. Patch 1: Target Project Validation ---');

  // Valid targets
  assert(
    validateTargetSupabaseUrl(`https://${EXPECTED_HOSTNAME}`) === `https://${EXPECTED_HOSTNAME}`,
    'Accepts canonical target URL'
  );
  assert(
    validateTargetSupabaseUrl(`https://${EXPECTED_HOSTNAME}/rest/v1`) === `https://${EXPECTED_HOSTNAME}`,
    'Accepts canonical target URL with path suffix'
  );

  // Rejected targets
  expectThrows(
    () => validateTargetSupabaseUrl(`http://${EXPECTED_HOSTNAME}`),
    'Rejects non-HTTPS protocol',
    'Expected \'https:\''
  );
  expectThrows(
    () => validateTargetSupabaseUrl('https://different-project.supabase.co'),
    'Rejects different Supabase project reference',
    'SAFETY VIOLATION'
  );
  expectThrows(
    () => validateTargetSupabaseUrl('http://localhost:54321'),
    'Rejects localhost / local Supabase endpoint',
    'Expected \'https:\''
  );
  expectThrows(
    () => validateTargetSupabaseUrl('http://127.0.0.1:54321'),
    'Rejects loopback IP endpoint',
    'Expected \'https:\''
  );
  expectThrows(
    () => validateTargetSupabaseUrl(`https://attacker.com/${EXPECTED_PROJECT_REF}`),
    'Rejects path-based spoofing attempt',
    'SAFETY VIOLATION'
  );
  expectThrows(
    () => validateTargetSupabaseUrl(`https://${EXPECTED_PROJECT_REF}.attacker.com`),
    'Rejects subdomain spoofing attempt',
    'SAFETY VIOLATION'
  );
  expectThrows(
    () => validateTargetSupabaseUrl('not-a-valid-url'),
    'Rejects non-URL string',
    'Invalid Supabase URL format'
  );
  expectThrows(
    () => validateTargetSupabaseUrl(''),
    'Rejects empty string',
    'non-empty string'
  );

  // ---------------------------------------------------------------------------
  // 2. Patch 3: Canonical UUID & Path Validation Tests
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Patch 3: Canonical UUID & Path Regex Validation ---');

  // UUIDs
  assert(isValidUuid('b2c91834-58a1-42ec-a0f1-e3db78901234'), 'Valid canonical UUID');
  assert(isValidUuid('B2C91834-58A1-42EC-A0F1-E3DB78901234'), 'Valid uppercase UUID');
  assert(!isValidUuid("b2c91834-58a1-42ec-a0f1-e3db78901234'; DROP TABLE reports; --"), 'Rejects SQL injection in UUID');
  assert(!isValidUuid('not-a-uuid'), 'Rejects non-UUID string');
  assert(!isValidUuid(''), 'Rejects empty string UUID');
  assert(!isValidUuid(null), 'Rejects null UUID');
  assert(!isValidUuid(undefined), 'Rejects undefined UUID');

  // Storage Paths
  const sampleRptId = 'b2c91834-58a1-42ec-a0f1-e3db78901234';
  const sampleAttId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
  assert(isValidStoragePath(`reports/${sampleRptId}/${sampleAttId}.png`), 'Valid canonical PNG path');
  assert(isValidStoragePath(`reports/${sampleRptId}/${sampleAttId}.jpeg`), 'Valid canonical JPEG path');
  assert(isValidStoragePath(`reports/${sampleRptId}/${sampleAttId}.jpg`), 'Valid canonical JPG path');
  assert(isValidStoragePath(`reports/${sampleRptId}/${sampleAttId}.webp`), 'Valid canonical WEBP path');

  // Invalid Storage Paths
  assert(!isValidStoragePath(`reports/${sampleRptId}/${sampleAttId}.exe`), 'Rejects forbidden .exe extension');
  assert(!isValidStoragePath(`reports/${sampleRptId}/${sampleAttId}.pdf`), 'Rejects forbidden .pdf extension');
  assert(!isValidStoragePath(`reports/../../etc/passwd`), 'Rejects path traversal');
  assert(!isValidStoragePath(`uploads/${sampleRptId}/${sampleAttId}.png`), 'Rejects non-reports root folder');
  assert(!isValidStoragePath(`reports/invalid-uuid/${sampleAttId}.png`), 'Rejects invalid report UUID in path');
  assert(!isValidStoragePath(''), 'Rejects empty storage path');

  // ---------------------------------------------------------------------------
  // 3. Patch 3: Guarded Ledger Parsing & Malformed Ledger Handling
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Patch 3: Guarded Ledger Parsing & Recovery ---');

  const testScratchDir = path.join(process.cwd(), 'tests', 'integration', '.scratch-test');
  if (!fs.existsSync(testScratchDir)) {
    fs.mkdirSync(testScratchDir, { recursive: true });
  }

  // Missing ledger
  const missingPath = path.join(testScratchDir, 'missing-ledger.json');
  expectThrows(
    () => loadAndValidateLedger(missingPath),
    'Handles missing ledger file gracefully',
    'does not exist'
  );

  // Corrupted / malformed JSON
  const corruptPath = path.join(testScratchDir, 'corrupt-ledger.json');
  fs.writeFileSync(corruptPath, '{ "runId": "RUN-1", "reports": [ { "id": "trun', 'utf-8');
  expectThrows(
    () => loadAndValidateLedger(corruptPath),
    'Rejects malformed / truncated JSON ledger',
    'invalid JSON'
  );

  // Empty file
  const emptyPath = path.join(testScratchDir, 'empty-ledger.json');
  fs.writeFileSync(emptyPath, '   \n  ', 'utf-8');
  expectThrows(
    () => loadAndValidateLedger(emptyPath),
    'Rejects empty ledger file',
    'is empty'
  );

  // Non-object JSON (array)
  const arrayPath = path.join(testScratchDir, 'array-ledger.json');
  fs.writeFileSync(arrayPath, '[]', 'utf-8');
  expectThrows(
    () => loadAndValidateLedger(arrayPath),
    'Rejects non-object root JSON',
    'must be a JSON object'
  );

  // Ledger with mixed valid and malicious/malformed IDs
  const mixedPath = path.join(testScratchDir, 'mixed-ledger.json');
  const validRptId = 'b2c91834-58a1-42ec-a0f1-e3db78901234';
  const maliciousRptId = "malicious'; DROP TABLE reports; --";
  const validPath = `reports/${validRptId}/${sampleAttId}.png`;
  const invalidPath = 'reports/bad-path.exe';

  fs.writeFileSync(
    mixedPath,
    JSON.stringify({
      runId: 'RUN-TEST-001',
      startedAt: new Date().toISOString(),
      reports: [
        { id: validRptId, title: '[TEST] Valid' },
        { id: maliciousRptId, title: '[TEST] Injection' },
        { id: 'not-a-uuid', title: '[TEST] Invalid' },
      ],
      storagePaths: [validPath, invalidPath],
    }),
    'utf-8'
  );

  const sanitizedLedger = loadAndValidateLedger(mixedPath);
  assert(sanitizedLedger.reports.length === 1, 'Sanitized reports filtered out malformed and injection IDs');
  assert(sanitizedLedger.reports[0].id === validRptId, 'Retained exact valid report UUID');
  assert(sanitizedLedger.storagePaths.length === 1, 'Sanitized storage paths filtered out invalid extensions');
  assert(sanitizedLedger.storagePaths[0] === validPath, 'Retained exact valid canonical storage path');

  // ---------------------------------------------------------------------------
  // 4. Patch 2: Truthful Teardown Results (Without Service-Role Key)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Patch 2: Truthful Teardown & SQL Generation ---');

  // Mock a ClientPool without adminTeardown
  const mockPool: ClientPool = {
    anon: {} as unknown as SupabaseClient,
    student: {
      storage: {
        from: () => ({
          remove: async () => ({ data: null, error: { message: 'AccessDenied' } }),
        }),
      },
    } as unknown as SupabaseClient,
    coord: {} as unknown as SupabaseClient,
    tech: {} as unknown as SupabaseClient,
    admin: {} as unknown as SupabaseClient,
    mgmt: {} as unknown as SupabaseClient,
    adminTeardown: undefined, // Simulates standard environment without service-role key
  };

  const testFixtureLedger: FixtureLedger = {
    runId: 'RUN-UNIT-TEST',
    startedAt: new Date().toISOString(),
    reports: [{ id: validRptId, title: '[TEST] Unit Report', reporterId: 'reporter-1' }],
    assignments: [],
    attachments: [],
    storagePaths: [validPath],
    comments: [],
    workLogs: [],
    verifications: [],
    notifications: [],
    profileRestores: [],
  };

  const teardownResult = await performTeardown(testFixtureLedger, mockPool, false);

  assert(!teardownResult.success, 'Reports success = false when manual SQL is required');
  assert(teardownResult.requiresManualSql === true, 'Sets requiresManualSql = true');
  assert(typeof teardownResult.cleanupSqlPath === 'string', 'Returns cleanupSqlPath');
  assert(fs.existsSync(teardownResult.cleanupSqlPath!), 'Generated SQL script exists on disk');

  // Check generated SQL content
  const generatedSql = fs.readFileSync(teardownResult.cleanupSqlPath!, 'utf-8');
  assert(generatedSql.includes(`WHERE bucket_id = 'report-attachments'`), 'SQL contains storage deletion target');
  assert(
    generatedSql.includes('DELETE FROM public.reports') && generatedSql.includes(`WHERE id IN ('${validRptId}')`),
    'SQL includes validated report UUID'
  );
  assert(!generatedSql.includes('DROP TABLE'), 'SQL contains zero unvalidated injected commands');

  // Clean up scratch directory
  try {
    fs.rmSync(testScratchDir, { recursive: true, force: true });
    if (teardownResult.cleanupSqlPath && fs.existsSync(teardownResult.cleanupSqlPath)) {
      fs.unlinkSync(teardownResult.cleanupSqlPath);
    }
  } catch {}

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log(`LOCAL SAFETY TESTS SUMMARY`);
  console.log(`Total:  ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLocalSafetyTests().catch((err) => {
  console.error('[FATAL TEST RUN ERROR]:', err);
  process.exit(1);
});
