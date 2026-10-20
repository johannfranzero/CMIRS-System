import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSettingsUserDirectoryResult,
  filterSettingsUsers,
  formatAuditTimestamp,
  formatSettingsRole,
  isSettingsUserDirectoryComplete,
  mapRoleChangeAudit,
  mapSettingsUser,
  SETTINGS_USER_DIRECTORY_ERROR_MESSAGE,
  SETTINGS_USER_DIRECTORY_INCOMPLETE_MESSAGE,
} from '../../utils/settings/transform.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

const users = [
  mapSettingsUser({
    id: 'user-1',
    full_name: 'Alex Morgan',
    email: 'alex@example.edu',
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
    fullName: 'Alex Morgan',
    email: 'alex@example.edu',
    role: 'administrator',
    isActive: true,
  });
  assert.equal('phone' in users[0], false);
  assert.deepEqual(mapSettingsUser({}), {
    id: '',
    fullName: 'Name unavailable',
    email: 'Email unavailable',
    role: 'student_personnel',
    isActive: false,
  });
});

test('Settings transforms: directory filter matches name, email, role, and account status', () => {
  assert.deepEqual(filterSettingsUsers(users, 'alex').map((user) => user.id), ['user-1']);
  assert.deepEqual(filterSettingsUsers(users, '@example.edu').map((user) => user.id), ['user-1', 'user-2']);
  assert.deepEqual(filterSettingsUsers(users, 'technician').map((user) => user.id), ['user-2']);
  assert.deepEqual(filterSettingsUsers(users, 'inactive').map((user) => user.id), ['user-2']);
  assert.deepEqual(filterSettingsUsers(users, 'nobody'), []);
  assert.deepEqual(filterSettingsUsers([], 'alex'), []);
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
        full_name: 'Alex Morgan',
        email: 'alex@example.edu',
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

test('Settings transforms: role-change audit maps actual related names and safe timestamps', () => {
  const entry = mapRoleChangeAudit({
    id: 'audit-1',
    old_role: 'student_personnel',
    new_role: 'technician',
    created_at: '2026-10-20T04:00:00.000Z',
    affected_user: { full_name: 'Taylor Chen' },
    changed_by_user: [{ full_name: 'Alex Morgan' }],
  });

  assert.deepEqual(entry, {
    id: 'audit-1',
    affectedUserName: 'Taylor Chen',
    actorName: 'Alex Morgan',
    oldRole: 'student_personnel',
    newRole: 'technician',
    createdAt: '2026-10-20T04:00:00.000Z',
  });
  assert.equal(formatSettingsRole('administrator'), 'Administrator');
  assert.equal(formatAuditTimestamp('invalid'), 'Timestamp unavailable');
});

test('Settings DAL: administrator-only exact-count query bounds the directory and refuses fallback data', () => {
  const dal = fs.readFileSync(path.join(myAppRoot, 'utils/settings/dal.ts'), 'utf8');

  assert.ok(dal.includes("user.profile.role !== 'administrator'"));
  assert.ok(dal.includes(".from('profiles')"));
  assert.ok(dal.includes(".select('id, full_name, email, role, is_active', { count: 'exact' })"));
  assert.ok(dal.includes('.range(0, SETTINGS_USER_DIRECTORY_MAX_ROWS - 1)'));
  assert.ok(dal.includes('createSettingsUserDirectoryResult('));
  assert.ok(dal.includes('SETTINGS_USER_DIRECTORY_MAX_ROWS = 1000'));
  assert.ok(dal.includes(".from('role_change_audit')"));
  assert.ok(dal.includes('affected_user:profiles!user_id'));
  assert.ok(dal.includes('changed_by_user:profiles!changed_by'));
  assert.ok(dal.includes('.limit(ROLE_CHANGE_HISTORY_LIMIT)'));
  assert.equal(dal.includes('phone'), false);
  assert.equal(dal.includes('.insert('), false);
  assert.equal(dal.includes('.update('), false);
  assert.equal(dal.includes('.delete('), false);
  assert.equal(dal.includes('FALLBACK_'), false);
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
  assert.equal(page.includes('<form'), false);
  assert.equal(page.includes('onSubmit'), false);
  assert.ok(loading.includes('role="status"'));

  const settingsNavigation = navigation.slice(navigation.indexOf("name: 'Settings'"));
  assert.ok(settingsNavigation.includes("allowedRoles: ['administrator']"));
  assert.ok(settingsNavigation.includes("badge: 'Active'"));
  assert.ok(settingsNavigation.includes('isPlaceholder: false'));
});
