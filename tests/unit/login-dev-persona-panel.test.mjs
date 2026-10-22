/**
 * CMIRS — Regression Suite: Production Hardening of the Login Page
 *
 * Covers the removal of the development-only QA affordances from the
 * production-facing authentication UI:
 *
 *   1. the "Authorized Test Personas (Stage 2.1 QA)" quick-fill panel is not
 *      available in production mode — neither the server gate nor the client
 *      render guard can be opened in a production build;
 *   2. the test-account autofill shortcut is unreachable in production;
 *   3. no test e-mail address is present in any module that can reach the
 *      browser bundle;
 *   4. the persona catalogue is server-only and is supplied by the login page's
 *      Server Component;
 *   5. the approved authentication flow (email + password against Supabase
 *      Auth) and the registration / password-recovery policy notice are
 *      preserved.
 *
 * These are local, offline tests. No network call and no database write.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEV_TEST_PERSONA_ENV_VAR,
  canRenderTestPersonaPanel,
  isDevTestPersonaPanelEnabled,
  isDevelopmentBuild,
  shouldRenderTestPersonaPanel,
} from '../../utils/auth/dev-tools.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');

/**
 * Every address that must never reach a production build.
 */
const TEST_ACCOUNT_ADDRESSES = [
  'test-student@cmirs.internal',
  'test-coord@cmirs.internal',
  'test-tech@cmirs.internal',
  'test-admin@cmirs.internal',
  'test-mgmt@cmirs.internal',
];

/**
 * Runs `fn` with a temporarily patched environment and restores it afterwards.
 */
function withEnv(env, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Recursively collects source files under `dir` with the given extension.
 */
function collectFiles(dir, extensions) {
  const results = [];

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;

    const full = path.join(dir, entry);
    const stats = statSync(full);

    if (stats.isDirectory()) {
      results.push(...collectFiles(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(full);
    }
  }

  return results;
}

const sourceFiles = [
  ...collectFiles(path.join(appRoot, 'app'), ['.ts', '.tsx']),
  ...collectFiles(path.join(appRoot, 'components'), ['.ts', '.tsx']),
  ...collectFiles(path.join(appRoot, 'utils'), ['.ts', '.tsx']),
  ...collectFiles(path.join(appRoot, 'actions'), ['.ts', '.tsx']),
  ...collectFiles(path.join(appRoot, 'types'), ['.ts', '.tsx']),
  ...collectFiles(path.join(appRoot, 'config'), ['.ts', '.tsx']),
];

const relative = (file) => path.relative(appRoot, file).replace(/\\/g, '/');

// =============================================================================
// 1. The switch is closed in production mode
// =============================================================================

test('Login: the development-only persona switch is closed in production mode', () => {
  withEnv({ NODE_ENV: 'production', [DEV_TEST_PERSONA_ENV_VAR]: 'true' }, () => {
    assert.equal(
      isDevelopmentBuild(),
      false,
      'A production build must never report a development environment'
    );
    assert.equal(
      isDevTestPersonaPanelEnabled(),
      false,
      'The opt-in variable must not be able to open the switch in production'
    );
    assert.equal(
      canRenderTestPersonaPanel(),
      false,
      'The client render guard must be closed in production'
    );
    assert.equal(
      shouldRenderTestPersonaPanel(5),
      false,
      'The server must not supply persona data in production'
    );
  });
});

test('Login: the production switch cannot be opened by any opt-in spelling', () => {
  for (const value of ['true', 'TRUE', 'True', '1', 'yes', 'on', 'enabled', 'development']) {
    withEnv({ NODE_ENV: 'production', [DEV_TEST_PERSONA_ENV_VAR]: value }, () => {
      assert.equal(
        isDevTestPersonaPanelEnabled(),
        false,
        `The switch must stay closed in production for opt-in value "${value}"`
      );
      assert.equal(
        canRenderTestPersonaPanel(),
        false,
        `The client guard must stay closed in production for opt-in value "${value}"`
      );
    });
  }
});

test('Login: the switch is closed in every non-development environment', () => {
  for (const nodeEnv of ['production', 'test', 'staging', '']) {
    withEnv({ NODE_ENV: nodeEnv, [DEV_TEST_PERSONA_ENV_VAR]: 'true' }, () => {
      assert.equal(
        isDevTestPersonaPanelEnabled(),
        false,
        `The switch must stay closed when NODE_ENV="${nodeEnv}"`
      );
    });
  }
});

// =============================================================================
// 2. The switch still works for local QA
// =============================================================================

test('Login: the switch opens only in development with an explicit opt-in', () => {
  withEnv({ NODE_ENV: 'development', [DEV_TEST_PERSONA_ENV_VAR]: 'true' }, () => {
    assert.equal(isDevelopmentBuild(), true);
    assert.equal(isDevTestPersonaPanelEnabled(), true);
    assert.equal(canRenderTestPersonaPanel(), true);
    assert.equal(shouldRenderTestPersonaPanel(5), true);
  });

  // Development without the explicit opt-in stays closed.
  withEnv({ NODE_ENV: 'development', [DEV_TEST_PERSONA_ENV_VAR]: undefined }, () => {
    assert.equal(isDevTestPersonaPanelEnabled(), false);
    assert.equal(shouldRenderTestPersonaPanel(5), false);
  });
});

// =============================================================================
// 3. The persona catalogue is server-only and empty in production
// =============================================================================

test('Login: the persona catalogue returns nothing in production mode', async () => {
  const { getTestPersonas } = await import('../../utils/auth/test-personas.server.ts');

  withEnv({ NODE_ENV: 'production', [DEV_TEST_PERSONA_ENV_VAR]: 'true' }, () => {
    const personas = getTestPersonas();
    assert.deepEqual(
      [...personas],
      [],
      'The server must not supply the QA persona catalogue in production'
    );
  });

  withEnv({ NODE_ENV: 'development', [DEV_TEST_PERSONA_ENV_VAR]: 'true' }, () => {
    const personas = getTestPersonas();
    assert.equal(personas.length, 5, 'Local QA must still receive the five personas');
    for (const persona of personas) {
      assert.ok(
        TEST_ACCOUNT_ADDRESSES.includes(persona.email),
        `Unexpected persona address "${persona.email}"`
      );
    }
  });
});

test('Login: the persona catalogue refuses to load in a browser', () => {
  const source = readFileSync(
    path.join(appRoot, 'utils', 'auth', 'test-personas.server.ts'),
    'utf8'
  );

  assert.match(
    source,
    /typeof window !== 'undefined'/,
    'The server-only persona catalogue must guard against browser evaluation'
  );
  assert.match(
    source,
    /must never be loaded in the browser/,
    'The browser guard must state the failure explicitly'
  );
});

// =============================================================================
// 4. No test address can reach the browser bundle
// =============================================================================

test('Login: no client component contains a test account address', () => {
  const clientModules = sourceFiles.filter((file) => {
    const source = readFileSync(file, 'utf8');
    return /^\s*['"]use client['"]/m.test(source);
  });

  assert.ok(clientModules.length > 0, 'The project must contain client components');

  for (const file of clientModules) {
    const source = readFileSync(file, 'utf8');
    for (const address of TEST_ACCOUNT_ADDRESSES) {
      assert.ok(
        !source.includes(address),
        `${relative(file)} must not contain the test address ${address}`
      );
    }
  }
});

test('Login: the QA persona panel markup lives only in the isolated dev module', () => {
  const panelPath = 'components/auth/dev/test-persona-panel.tsx';
  const holders = sourceFiles.filter((file) =>
    /Authorized Test Personas/.test(readFileSync(file, 'utf8'))
  );

  assert.deepEqual(
    holders.map(relative),
    [panelPath],
    'The QA persona panel markup must be isolated in the dedicated development-only module'
  );

  // The dedicated panel is a client component and may therefore be part of the browser
  // bundle. It must be imported by the login form and by nothing else, and it must be
  // guarded against production rendering.
  const importers = sourceFiles.filter((file) => {
    const source = readFileSync(file, 'utf8');
    return /from ['"]@\/components\/auth\/dev\/test-persona-panel['"]/.test(source);
  });

  assert.deepEqual(
    importers.map(relative),
    ['components/auth/login-form.tsx'],
    'Only the login form may import the development-only persona panel'
  );
});

test('Login: only the server-only module holds the test account addresses', () => {
  const holders = sourceFiles.filter((file) => {
    const source = readFileSync(file, 'utf8');
    return TEST_ACCOUNT_ADDRESSES.some((address) => source.includes(address));
  });

  assert.deepEqual(
    holders.map(relative),
    ['utils/auth/test-personas.server.ts'],
    'The test addresses must live in exactly one server-only module'
  );

  // The holder must never be imported by a client module.
  const clientImporters = sourceFiles.filter((file) => {
    const source = readFileSync(file, 'utf8');
    if (!/^\s*['"]use client['"]/m.test(source)) return false;
    return source.includes('test-personas.server');
  });

  assert.deepEqual(
    clientImporters.map(relative),
    [],
    'No client component may import the server-only persona catalogue'
  );
});

// =============================================================================
// 5. The login form and page are wired correctly
// =============================================================================

test('Login: the login form no longer embeds the persona panel', () => {
  const source = readFileSync(path.join(appRoot, 'components', 'auth', 'login-form.tsx'), 'utf8');

  assert.ok(
    !source.includes('Authorized Test Personas'),
    'The persona panel must no longer be hard-coded in the login form'
  );
  assert.ok(
    !/const TEST_ACCOUNTS/.test(source),
    'The login form must not declare its own test-account list'
  );
  for (const address of TEST_ACCOUNT_ADDRESSES) {
    assert.ok(
      !source.includes(address),
      `The login form must not contain the test address ${address}`
    );
  }

  assert.match(
    source,
    /TestPersonaPanel/,
    'The login form must delegate to the isolated development-only panel'
  );
  assert.match(
    source,
    /testPersonas/,
    'The login form must accept the personas as a prop'
  );
});

test('Login: the persona panel is guarded against production rendering', () => {
  const source = readFileSync(
    path.join(appRoot, 'components', 'auth', 'dev', 'test-persona-panel.tsx'),
    'utf8'
  );

  assert.match(
    source,
    /canRenderTestPersonaPanel\(\)/,
    'The panel must consult the production render guard'
  );
  assert.match(
    source,
    /return null;/,
    'The panel must return nothing when the guard is closed'
  );
  assert.match(
    source,
    /^\s*['"]use client['"]/m,
    'The panel is a client component and must declare the directive'
  );
});

test('Login: the login page supplies the personas from the server-only module', () => {
  const source = readFileSync(path.join(appRoot, 'app', 'login', 'page.tsx'), 'utf8');

  assert.match(
    source,
    /from '@\/utils\/auth\/test-personas\.server'/,
    'The login page must import the persona catalogue from the server-only module'
  );
  assert.match(
    source,
    /getTestPersonas\(\)/,
    'The login page must obtain the personas through the gated accessor'
  );
  assert.match(
    source,
    /testPersonas=\{testPersonas\}/,
    'The login page must pass the personas to the form'
  );
});

// =============================================================================
// 6. The approved authentication flow is preserved
// =============================================================================

test('Login: the approved authentication flow and policy notice are preserved', () => {
  const form = readFileSync(path.join(appRoot, 'components', 'auth', 'login-form.tsx'), 'utf8');
  const action = readFileSync(path.join(appRoot, 'actions', 'auth.ts'), 'utf8');

  assert.match(form, /name="email"/, 'The e-mail field must remain');
  assert.match(form, /name="password"/, 'The password field must remain');
  assert.match(
    form,
    /type=\{showPassword \? 'text' : 'password'\}/,
    'The password field must remain masked unless the reveal control is used'
  );
  assert.match(form, /autoComplete="current-password"/, 'Password autocomplete is preserved');
  assert.match(
    form,
    /Public self-registration and self-service password recovery are disabled/,
    'The registration and recovery policy notice must remain'
  );

  assert.match(action, /signInWithPassword/, 'The approved password sign-in must remain');
  assert.match(action, /sanitizeRedirectUrl/, 'The redirect sanitiser must remain');
  assert.ok(
    !/signUp\(|inviteUserByEmail|resetPasswordForEmail/.test(action),
    'No self-registration or self-service recovery call may exist'
  );

  assert.ok(
    !/signUp\(|inviteUserByEmail|resetPasswordForEmail/.test(
      readFileSync(path.join(appRoot, 'components', 'auth', 'login-form.tsx'), 'utf8')
    ),
    'No self-registration or self-service recovery control may exist in the login UI'
  );
});
