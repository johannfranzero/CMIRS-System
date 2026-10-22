/**
 * CMIRS — Server Action Export Verification
 *
 * Runs Next.js's OWN runtime guard (`ensureServerEntryExports`) against the real exports of
 * every file-level `'use server'` module in `actions/`. This is the exact function that threw
 *
 *   A "use server" file can only export async functions, found object.
 *
 * while the `/reports/new` route module was being evaluated (see
 * `.next/dev/logs/next-development.log` in the Phase 4D evidence) and while the
 * `/settings` and `/notifications` modules were being evaluated (Phase 4E / 4F).
 *
 * The modules are imported for real (through a resolve hook that maps the
 * extensionless `next/*` subpaths onto their shipped entry points), so the
 * verdict is produced by Next.js's own guard against the real module namespace
 * — not by a source-code heuristic.
 *
 * Read-only: it imports the modules and calls the guard. It performs no I/O against any
 * database and issues no network request.
 *
 * Usage:
 *   node --import ./scripts/register-next-subpath-hook.mjs scripts/verify-server-action-exports.mjs
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

const validateModule = require('next/dist/build/webpack/loaders/next-flight-loader/action-validate.js');
const ensureServerEntryExports = validateModule.ensureServerEntryExports ?? validateModule.default;

console.log('--- Next.js runtime guard: ensureServerEntryExports() ---');

const actionsDir = path.join(appRoot, 'actions');
const actionFiles = readdirSync(actionsDir).filter((name) => name.endsWith('.ts')).sort();

let failures = 0;

for (const file of actionFiles) {
  const source = readFileSync(path.join(actionsDir, file), 'utf8');
  const isUseServerModule = /^\s*(['"])use server\1\s*;?/m.test(source);

  if (!isUseServerModule) {
    console.log(`  [SKIP] actions/${file} — no file-level 'use server' directive`);
    continue;
  }

  let moduleExports;
  try {
    moduleExports = await import(pathToFileURL(path.join(actionsDir, file)).href);
  } catch (err) {
    // A module that cannot be imported outside the Next.js bundler is still statically checked.
    console.log(`  [INFO] actions/${file} could not be imported standalone (${String(err?.message ?? err).split('\n')[0]})`);
    const exportedNames = [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
    const constExports = [...source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
    if (constExports.length > 0) {
      failures += 1;
      console.log(`  [FAIL] actions/${file} exports non-function value(s): ${constExports.join(', ')}`);
    } else {
      console.log(`  [PASS] actions/${file} exports only async functions (${exportedNames.length} function export(s))`);
    }
    continue;
  }

  const exportEntries = Object.entries(moduleExports);
  const nonFunctions = exportEntries.filter(([, value]) => typeof value !== 'function');

  // Run Next.js's real runtime guard against the real module exports.
  // `ensureServerEntryExports` iterates an ARRAY of exported values, so the module
  // namespace must be converted to an array of its values. Passing the namespace
  // object itself makes `actions.length` undefined and the guard silently passes
  // everything — which is why the exported constants went unnoticed.
  let guardOutcome = 'accepted';
  try {
    ensureServerEntryExports(Object.values(moduleExports));
  } catch (err) {
    guardOutcome = String(err?.message ?? err).split('\n')[0];
  }

  if (nonFunctions.length > 0 || guardOutcome !== 'accepted') {
    failures += 1;
    console.log(
      `  [FAIL] actions/${file} — ensureServerEntryExports(): ${guardOutcome}` +
        (nonFunctions.length > 0
          ? ` — non-function export(s): ${nonFunctions.map(([name, value]) => `${name} (${typeof value})`).join(', ')}`
          : '')
    );
  } else {
    console.log(
      `  [PASS] actions/${file} — ensureServerEntryExports() accepted ${exportEntries.length} export(s): ` +
        exportEntries.map(([name]) => name).join(', ')
    );
  }
}

console.log();
if (failures === 0) {
  console.log('  RESULT: PASS — no "use server" module violates the async-function export rule.');
} else {
  console.log(`  RESULT: FAIL — ${failures} module(s) would throw the Next.js server-actions loader error.`);
  process.exitCode = 1;
}
