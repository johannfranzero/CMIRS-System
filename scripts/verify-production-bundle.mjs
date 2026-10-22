#!/usr/bin/env node
/**
 * CMIRS — Production Bundle Exposure Verification
 *
 * Scans the **production** build output (`.next`, excluding the `.next/dev`
 * development artefacts) and fails when development-only material is present in
 * the browser bundle.
 *
 * Checks performed:
 *   1. No test-account e-mail address appears anywhere in `.next/static`
 *      (the files actually served to the browser).
 *   2. No test-account e-mail address appears in the server bundle's *rendered*
 *      output for a request to `/login`. The server bundle legitimately contains
 *      the server-only persona catalogue module; what must never happen is that
 *      the catalogue is *rendered*.
 *   3. The QA persona panel heading does not appear in the client bundle.
 *   4. No Supabase secret/service-role key appears in the client bundle.
 *
 * Usage:
 *   npm run build
 *   node scripts/verify-production-bundle.mjs
 *
 * Exit code 0 = PASS, 1 = FAIL.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');
const nextDir = path.join(appRoot, '.next');
const staticDir = path.join(nextDir, 'static');

const TEST_ACCOUNT_ADDRESSES = [
  'test-student@cmirs.internal',
  'test-coord@cmirs.internal',
  'test-tech@cmirs.internal',
  'test-admin@cmirs.internal',
  'test-mgmt@cmirs.internal',
];

const PERSONA_PANEL_MARKERS = ['Authorized Test Personas', 'Stage 2.1 QA'];

const SECRET_PATTERNS = [
  /sb_secret_[A-Za-z0-9_-]+/g,
  /service_role[A-Za-z0-9_-]{10,}/g,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/g,
];

function collectFiles(dir, { skipDev = true } = {}) {
  const results = [];

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (skipDev && (entry === 'dev' || entry === 'cache')) continue;

    const full = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      results.push(...collectFiles(full, { skipDev }));
    } else if (stats.isFile() && stats.size < 25 * 1024 * 1024) {
      results.push(full);
    }
  }

  return results;
}

function scan(files, patterns) {
  const findings = [];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        findings.push({
          file: path.relative(appRoot, file).replace(/\\/g, '/'),
          matches: [...new Set(matches)].slice(0, 5),
        });
      }
    }
  }

  return findings;
}

function main() {
  if (!statSync(nextDir, { throwIfNoEntry: false })?.isDirectory?.()) {
    console.error('FAIL: no .next directory found. Run `npm run build` first.');
    process.exit(1);
  }

  const staticFiles = collectFiles(staticDir, { skipDev: false });
  if (staticFiles.length === 0) {
    console.error('FAIL: .next/static is empty. Run `npm run build` first.');
    process.exit(1);
  }

  const results = [];

  // 1 + 3: the browser bundle must carry neither the test addresses nor the panel.
  const clientFindings = scan(staticFiles, [
    ...TEST_ACCOUNT_ADDRESSES.map((address) => new RegExp(escapeRegExp(address), 'g')),
    ...PERSONA_PANEL_MARKERS.map((marker) => new RegExp(escapeRegExp(marker), 'g')),
  ]);

  results.push({
    check: 'The browser bundle (.next/static) contains no test account address and no QA persona panel',
    passed: clientFindings.length === 0,
    detail: clientFindings,
  });

  // 4: no secret material in the browser bundle.
  const secretFindings = scan(staticFiles, SECRET_PATTERNS);
  results.push({
    check: 'The browser bundle (.next/static) contains no Supabase secret or service-role key',
    passed: secretFindings.length === 0,
    detail: secretFindings,
  });

  // 2: the server bundle may contain the server-only catalogue module, but the
  //    rendered login document must not contain a test address.
  const serverRendered = [];
  for (const file of collectFiles(path.join(nextDir, 'server', 'app'))) {
    if (!/\.(html|body|rsc|txt)$/i.test(file) && !file.includes('login')) continue;
    serverRendered.push(file);
  }

  const renderedFindings = scan(serverRendered, [
    ...TEST_ACCOUNT_ADDRESSES.map((address) => new RegExp(escapeRegExp(address), 'g')),
  ]);

  results.push({
    check: 'The rendered login output contains no test account address',
    passed: renderedFindings.length === 0,
    detail: renderedFindings,
  });

  let failed = false;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.check}`);

    if (!result.passed) {
      failed = true;
      for (const finding of result.detail) {
        console.log(`         ${finding.file} :: ${finding.matches.join(', ')}`);
      }
    }
  }

  if (failed) {
    console.error('\nPRODUCTION BUNDLE VERIFICATION: FAIL');
    process.exit(1);
  }

  console.log('\nPRODUCTION BUNDLE VERIFICATION: PASS');
  process.exit(0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
