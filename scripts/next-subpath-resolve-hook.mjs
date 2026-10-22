/**
 * Node ESM resolve hook used by the local verification scripts.
 *
 * Two resolution gaps exist when the application source is imported outside the Next.js
 * bundler:
 *
 *   1. The application source imports Next.js subpaths without a file extension
 *      (`next/headers`, `next/cache`, `next/navigation`). The installed `next` package ships
 *      without an `exports` map, so bare Node ESM resolves them to `node_modules/next/<subpath>`
 *      — a path that does not exist — and the import fails with ERR_MODULE_NOT_FOUND.
 *
 *   2. The application source uses the `@/*` TypeScript path alias (see `tsconfig.json`).
 *      Bare Node ESM does not read `tsconfig.json`, so `@/utils/...` is treated as a bare
 *      package specifier and fails with ERR_MODULE_NOT_FOUND.
 *
 * This hook resolves both forms so the *unmodified* application module can be imported and
 * executed for verification purposes.
 *
 * It only affects the verification process. No application file is modified.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const SUBPATH_ENTRIES = new Map([
  ['next/headers', 'next/headers.js'],
  ['next/cache', 'next/cache.js'],
  ['next/navigation', 'next/navigation.js'],
  ['next/server', 'next/server.js'],
]);

const EXTENSION_CANDIDATES = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx'];

function resolveAliasTarget(specifier) {
  const relative = specifier.slice(2);

  for (const extension of EXTENSION_CANDIDATES) {
    const candidate = path.join(appRoot, `${relative}${extension}`);
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        // `existsSync` also matches directories; only accept real files.
        if (existsSync(candidate) && path.extname(candidate) !== '') {
          return candidate;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const entry = SUBPATH_ENTRIES.get(specifier);
  if (entry) {
    return nextResolve(entry, context);
  }

  if (specifier.startsWith('@/')) {
    const target = resolveAliasTarget(specifier);
    if (target) {
      return nextResolve(pathToFileURL(target).href, context);
    }
  }

  return nextResolve(specifier, context);
}
