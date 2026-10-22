/**
 * Registers the Next.js subpath resolve hook for the current Node process.
 *
 * The installed `next` package ships without an `exports` map, so bare Node ESM cannot
 * resolve the extensionless `next/headers`, `next/cache` and `next/navigation` specifiers
 * that the application source uses. The hook maps each of them onto the shipped
 * `<subpath>.js` entry point.
 *
 * It only affects the verification process. No application file is modified.
 *
 * Usage:
 *   node --import ./scripts/register-next-subpath-hook.mjs <script>
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./next-subpath-resolve-hook.mjs', pathToFileURL(`${import.meta.dirname}/`));
