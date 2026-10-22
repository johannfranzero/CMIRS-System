import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSettingsUserDirectoryResult,
  filterSettingsUsers,
  formatAuditTimestamp,
  isSettingsUserDirectoryComplete,
  mapRoleChangeAudit,
  mapSettingsUser,
  SETTINGS_USER_DIRECTORY_ERROR_MESSAGE,
  SETTINGS_USER_DIRECTORY_INCOMPLETE_MESSAGE,
} from '../../utils/settings/transform.ts';
import { formatRoleLabel } from '../../types/auth.ts';
import { getAdministratorSettingsDataFromClient } from '../../utils/settings/runtime.ts';
import { createMockReadSupabase } from './helpers/mock-read-supabase.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

const users = [
  mapSettingsUser({
    id: 'user-1',
    full_name: 'Rina Bautista',
    email: 'rina.bautista@example.edu',
    role: 'administrator',
    is_active: true,
    phone: '+63-900-000-0000',
  }),
  mapSettingsUser({
    id: 'user-2',
    full_name: 'Taylor Chen',
    email: 'taylor@example.edu',
    role: 'technician',
    is_active: false,
  }),
];

test('Settings transforms: user directory maps only displayed fields and safe missing values', () => {
  assert.deepEqual(users[0], {
    id: 'user-1',
    fullName: 'Rina Bautista',
    email: 'rina.bautista@example.edu',
    role: 'administrator',
    isActive: true,
    // Phase 4E: the auth-account linkage status is part of the mapped contract. It stays
    // `null` when the linkage could not be read, so the UI never claims a status it does
    // not know.
    hasAuthAccount: null,
  });
  assert.equal('phone' in users[0], false);
  assert.deepEqual(mapSettingsUser({}), {
    id: '',
    fullName: 'Name unavailable',
    email: 'Email unavailable',
    role: 'student_personnel',
    isActive: false,
    hasAuthAccount: null,
  });
});

test('Settings transforms: directory filter matches name, email, role, and account status', () => {
  assert.deepEqual(filterSettingsUsers(users, 'rina').map((user) => user.id), ['user-1']);
  assert.deepEqual(filterSettingsUsers(users, '@example.edu').map((user) => user.id), ['user-1', 'user-2']);
  assert.deepEqual(filterSettingsUsers(users, 'technician').map((user) => user.id), ['user-2']);
  assert.deepEqual(filterSettingsUsers(users, 'inactive').map((user) => user.id), ['user-2']);
  assert.deepEqual(filterSettingsUsers(users, 'nobody'), []);
  assert.deepEqual(filterSettingsUsers([], 'rina'), []);
});

test('Settings user directory: exact count accepts complete and empty results only', () => {
  assert.equal(isSettingsUserDirectoryComplete(2, 2), true);
  assert.equal(isSettingsUserDirectoryComplete(0, 0), true);
  assert.equal(isSettingsUserDirectoryComplete(1001, 1000), false);
  assert.equal(isSettingsUserDirectoryComplete(null, 0), false);
  assert.equal(isSettingsUserDirectoryComplete(undefined, 0), false);
});

test('Settings user directory: over-limit and query-error results hide all partial accounts', () => {
  const complete = createSettingsUserDirectoryResult(
    [
      {
        id: 'user-1',
        full_name: 'Rina Bautista',
        email: 'rina.bautista@example.edu',
        role: 'administrator',
        is_active: true,
      },
    ],
    1,
    null
  );
  assert.equal(complete.state, 'ready');
  assert.equal(complete.users.length, 1);

  const empty = createSettingsUserDirectoryResult([], 0, null);
  assert.deepEqual(empty, {
    users: [],
    state: 'ready',
    totalCount: 0,
    fetchedCount: 0,
    error: null,
  });

  const overLimit = createSettingsUserDirectoryResult(users, 1001, null);
  assert.deepEqual(overLimit, {
    users: [],
    state: 'incomplete',
    totalCount: 1001,
    fetchedCount: 2,
    error: SETTINGS_USER_DIRECTORY_INCOMPLETE_MESSAGE,
  });

  const queryError = createSettingsUserDirectoryResult(users, null, new Error('profiles query failed'));
  assert.deepEqual(queryError, {
    users: [],
    state: 'error',
    totalCount: null,
    fetchedCount: 2,
    error: SETTINGS_USER_DIRECTORY_ERROR_MESSAGE,
  });
});

test('Settings DAL runtime: returns complete directory and audit data from bounded exact-count queries', async () => {
  const supabase = createMockReadSupabase({
    profiles: {
      data: [
        {
          id: 'user-1',
          full_name: 'Rina Bautista',
          email: 'rina.bautista@example.edu',
          role: 'administrator',
          is_active: true,
        },
      ],
      count: 1,
      error: null,
    },
    role_change_audit: {
      data: [
        {
          id: 'audit-1',
          old_role: 'student_personnel',
          new_role: 'technician',
          created_at: '2026-10-20T04:00:00.000Z',
          affected_user: { full_name: 'Taylor Chen' },
          changed_by_user: { full_name: 'Rina Bautista' },
        },
      ],
      count: null,
      error: null,
    },
  });

  const result = await getAdministratorSettingsDataFromClient(supabase);

  assert.equal(result.userDirectory.state, 'ready');
  assert.equal(result.userDirectory.totalCount, 1);
  assert.deepEqual(result.userDirectory.users.map((user) => user.id), ['user-1']);
  assert.equal(result.roleChangeHistory.length, 1);
  assert.equal(result.roleChangeHistoryError, null);

  const profilesOperation = supabase.operations.find((operation) => operation.table === 'profiles');
  assert.deepEqual(profilesOperation.select.options, { count: 'exact' });
  assert.deepEqual(profilesOperation.orders, [{ column: 'full_name', options: undefined }]);
  assert.deepEqual(profilesOperation.range, { from: 0, to: 999 });

  const auditOperation = supabase.operations.find((operation) => operation.table === 'role_change_audit');
  assert.deepEqual(auditOperation.orders, [{ column: 'created_at', options: { ascending: false } }]);
  assert.equal(auditOperation.limit, 100);
});

test('Settings DAL runtime: accepts empty results but withholds partial directories', async () => {
  const emptySupabase = createMockReadSupabase({
    profiles: { data: [], count: 0, error: null },
    role_change_audit: { data: [], count: null, error: null },
  });
  const emptyResult = await getAdministratorSettingsDataFromClient(emptySupabase);
  assert.deepEqual(emptyResult.userDirectory, {
    users: [],
    state: 'ready',
    totalCount: 0,
    fetchedCount: 0,
    error: null,
  });

  const incompleteSupabase = createMockReadSupabase({
    profiles: { data: [users[0]], count: 2, error: null },
    role_change_audit: { data: [], count: null, error: null },
  });
  const incompleteResult = await getAdministratorSettingsDataFromClient(incompleteSupabase);
  assert.equal(incompleteResult.userDirectory.state, 'incomplete');
  assert.equal(incompleteResult.userDirectory.fetchedCount, 1);
  assert.deepEqual(incompleteResult.userDirectory.users, []);
});

test('Settings DAL runtime: sanitizes independent profiles and audit query errors', async () => {
  const supabase = createMockReadSupabase({
    profiles: { data: null, count: null, error: { message: 'permission denied' } },
    role_change_audit: { data: null, count: null, error: { message: 'timeout' } },
  });

  const result = await getAdministratorSettingsDataFromClient(supabase);

  assert.equal(result.userDirectory.state, 'error');
  assert.deepEqual(result.userDirectory.users, []);
  assert.equal(result.userDirectory.error, SETTINGS_USER_DIRECTORY_ERROR_MESSAGE);
  assert.deepEqual(result.roleChangeHistory, []);
  assert.match(result.roleChangeHistoryError, /temporarily unavailable/);
});

test('Settings transforms: role-change audit maps actual related names and safe timestamps', () => {
  const entry = mapRoleChangeAudit({
    id: 'audit-1',
    old_role: 'student_personnel',
    new_role: 'technician',
    created_at: '2026-10-20T04:00:00.000Z',
    affected_user: { full_name: 'Taylor Chen' },
    changed_by_user: [{ full_name: 'Rina Bautista' }],
  });

  assert.deepEqual(entry, {
    id: 'audit-1',
    affectedUserName: 'Taylor Chen',
    actorName: 'Rina Bautista',
    oldRole: 'student_personnel',
    newRole: 'technician',
    createdAt: '2026-10-20T04:00:00.000Z',
  });
  assert.equal(formatRoleLabel('administrator'), 'School Administrator');
  assert.equal(formatAuditTimestamp('invalid'), 'Timestamp unavailable');
});

test('Settings DAL: administrator-only exact-count query bounds the directory and refuses fallback data', () => {
  const dal = fs.readFileSync(path.join(myAppRoot, 'utils/settings/dal.ts'), 'utf8');
  const runtime = fs.readFileSync(path.join(myAppRoot, 'utils/settings/runtime.ts'), 'utf8');

  assert.ok(dal.includes("user.profile.role !== 'administrator'"));
  assert.ok(dal.includes('getAdministratorSettingsDataFromClient(supabase)'));
  assert.ok(runtime.includes(".select('id, full_name, email, role, is_active', { count: 'exact' })"));
  assert.ok(runtime.includes('.range(0, SETTINGS_USER_DIRECTORY_MAX_ROWS - 1)'));
  assert.ok(runtime.includes('SETTINGS_USER_DIRECTORY_MAX_ROWS = 1000'));
  assert.ok(runtime.includes(".from('role_change_audit')"));
  assert.ok(runtime.includes('affected_user:profiles!user_id'));
  assert.ok(runtime.includes('changed_by_user:profiles!changed_by'));
  assert.ok(runtime.includes('.limit(ROLE_CHANGE_HISTORY_LIMIT)'));
  assert.equal(runtime.includes('phone'), false);
  assert.equal(runtime.includes('.insert('), false);
  assert.equal(runtime.includes('.update('), false);
  assert.equal(runtime.includes('.delete('), false);
  assert.equal(runtime.includes('FALLBACK_'), false);
});

test('Settings page: retains administrator-only server guard and renders safe incomplete-directory state', () => {
  const page = fs.readFileSync(path.join(myAppRoot, 'app/settings/page.tsx'), 'utf8');
  const loading = fs.readFileSync(path.join(myAppRoot, 'app/settings/loading.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(myAppRoot, 'config/navigation.ts'), 'utf8');

  assert.ok(page.includes("requireRole(['administrator'], '/settings')"));
  assert.ok(page.includes('Current Administrator Account'));
  assert.ok(page.includes('User Directory'));
  assert.ok(page.includes('Recent Role-Change Audit History'));
  assert.ok(page.includes('getAdministratorSettingsData()'));
  assert.ok(page.includes("settingsData.userDirectory.state === 'incomplete'"));
  assert.ok(page.includes('No partial directory is displayed.'));
  assert.equal(page.includes('formatSettingsRole'), false);
  assert.equal(page.includes('<form'), false);
  assert.equal(page.includes('onSubmit'), false);
  assert.ok(loading.includes('role="status"'));

  const settingsNavigation = navigation.slice(navigation.indexOf("name: 'Settings'"));
  assert.ok(settingsNavigation.includes("allowedRoles: ['administrator']"));
  assert.ok(settingsNavigation.includes("badge: 'Active'"));
  assert.ok(settingsNavigation.includes('isPlaceholder: false'));
});
