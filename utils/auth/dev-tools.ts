/**
 * CMIRS — Development-Only Tooling Switch
 *
 * This module is the single gate for every development-only affordance in the
 * application (currently: the QA test-persona quick-fill panel on the login page).
 *
 * ## Production safety contract
 *
 * The switch is enabled only when **both** conditions hold:
 *
 *   1. `process.env.NODE_ENV === 'development'`
 *   2. `CMIRS_ENABLE_TEST_PERSONAS === 'true'`
 *
 * `process.env.NODE_ENV` is a **build-time constant** in Next.js: `next build`
 * replaces every occurrence with the literal `"production"`, and `next start`
 * additionally runs with `NODE_ENV=production`. A production build therefore
 * evaluates `isDevelopmentBuild()` to `false` unconditionally and the whole
 * branch is removed by the bundler. Setting the opt-in variable in a production
 * environment has **no effect** — the switch cannot be enabled in production.
 *
 * The opt-in variable is deliberately **not** prefixed with `NEXT_PUBLIC_`, so it
 * is never inlined into the browser bundle and cannot be discovered or set from
 * the client.
 *
 * The gate is additionally re-checked on the server immediately before any
 * development data is produced, so that a misconfigured environment still
 * fails closed.
 */

/**
 * Name of the environment variable that opts in to the development-only
 * test-persona panel. Documented by name in `.env.example`.
 */
export const DEV_TEST_PERSONA_ENV_VAR = 'CMIRS_ENABLE_TEST_PERSONAS';

/**
 * True only when the application is running under the Next.js development
 * server. In a production build this is the constant `false`.
 */
export function isDevelopmentBuild(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * True only when the application runs in development **and** the operator has
 * explicitly opted in through `CMIRS_ENABLE_TEST_PERSONAS=true`.
 *
 * Fails closed in every other case, including a production build that happens
 * to carry the opt-in variable in its environment.
 *
 * **Server-side gate only.** The opt-in variable is not exposed to the browser,
 * so this function must never be used to decide what the client renders.
 */
export function isDevTestPersonaPanelEnabled(): boolean {
  if (!isDevelopmentBuild()) {
    return false;
  }

  return process.env[DEV_TEST_PERSONA_ENV_VAR] === 'true';
}

/**
 * The client-side render guard for the development-only QA persona panel.
 *
 * The browser may render the panel only inside a development build. The data
 * itself is gated separately on the server by `isDevTestPersonaPanelEnabled()`,
 * so a production build receives an empty persona list and renders nothing
 * twice over.
 *
 * `process.env.NODE_ENV` is inlined as a build-time constant, so in a
 * production bundle this is the constant `false` and the guard is removed by
 * the bundler.
 */
export function canRenderTestPersonaPanel(): boolean {
  return isDevelopmentBuild();
}

/**
 * The single server-side decision for supplying QA persona data.
 *
 * The personas may be handed to the client only when the environment is a
 * development build, the operator has explicitly opted in, **and** the server
 * actually produced at least one persona. Every other combination yields an
 * empty list, so the caller cannot accidentally render the panel in production.
 *
 * This helper holds the decision logic (not the markup) so that the production
 * behaviour is verifiable by a plain unit test.
 */
export function shouldRenderTestPersonaPanel(personaCount: number): boolean {
  if (!Number.isFinite(personaCount) || personaCount <= 0) {
    return false;
  }

  return isDevTestPersonaPanelEnabled();
}
