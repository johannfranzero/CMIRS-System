/**
 * Node ESM resolve hook used only by `scripts/verify-supabase-connectivity.mjs`.
 *
 * The application source imports `next/headers` (extensionless). The Next.js bundler resolves
 * that subpath, but bare Node ESM does not, so the import fails with ERR_MODULE_NOT_FOUND
 * before any application code runs. This hook maps the specifier onto the real
 * `next/headers.js` entry point so the *unmodified* application module can be imported and
 * executed for verification purposes.
 *
 * It only affects the verification process. No application file is modified.
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return nextResolve('next/headers.js', context);
  }
  return nextResolve(specifier, context);
}
