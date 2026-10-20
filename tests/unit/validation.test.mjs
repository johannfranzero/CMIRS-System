import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRoleLabel } from '../../types/auth.ts';

// Standalone verification of the logic implemented in utils/auth/validation.ts

const USER_ROLES = [
  'student_personnel',
  'coordinator',
  'technician',
  'administrator',
  'management',
];

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(trimmed);
}

function sanitizeRedirectUrl(targetUrl, defaultUrl = '/') {
  if (!targetUrl || typeof targetUrl !== 'string') {
    return defaultUrl;
  }
  const trimmed = targetUrl.trim();
  if (!trimmed) {
    return defaultUrl;
  }
  if (trimmed.startsWith('//') || trimmed.includes('\\')) {
    return defaultUrl;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('javascript:') ||
    lower.includes('data:') ||
    lower.includes('vbscript:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://')
  ) {
    return defaultUrl;
  }
  if (!trimmed.startsWith('/')) {
    return defaultUrl;
  }
  return trimmed;
}

function isUserRole(value) {
  return typeof value === 'string' && USER_ROLES.includes(value);
}

test('isValidEmail accepts valid institutional emails', () => {
  assert.equal(isValidEmail('test-student@cmirs.internal'), true);
  assert.equal(isValidEmail('test-coord@cmirs.internal'), true);
  assert.equal(isValidEmail('user.name+tag@sub.campus.edu'), true);
  assert.equal(isValidEmail('admin@cmirs.internal'), true);
});

test('isValidEmail rejects malformed or empty emails', () => {
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('plainaddress'), false);
  assert.equal(isValidEmail('@missingusername.com'), false);
  assert.equal(isValidEmail('username@.com'), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
});

test('sanitizeRedirectUrl allows valid relative paths', () => {
  assert.equal(sanitizeRedirectUrl('/'), '/');
  assert.equal(sanitizeRedirectUrl('/reports'), '/reports');
  assert.equal(sanitizeRedirectUrl('/reports/new'), '/reports/new');
  assert.equal(sanitizeRedirectUrl('/reports?status=assigned&priority=high'), '/reports?status=assigned&priority=high');
  assert.equal(sanitizeRedirectUrl('/locations'), '/locations');
});

test('sanitizeRedirectUrl prevents open redirect vulnerabilities', () => {
  assert.equal(sanitizeRedirectUrl('https://evil.com'), '/');
  assert.equal(sanitizeRedirectUrl('http://attacker.com/steal-token'), '/');
  assert.equal(sanitizeRedirectUrl('//evil.com/path'), '/');
  assert.equal(sanitizeRedirectUrl('/\\evil.com'), '/');
  assert.equal(sanitizeRedirectUrl('javascript:alert(1)'), '/');
  assert.equal(sanitizeRedirectUrl('data:text/html,<script>'), '/');
  assert.equal(sanitizeRedirectUrl(''), '/');
  assert.equal(sanitizeRedirectUrl(null), '/');
  assert.equal(sanitizeRedirectUrl(undefined), '/');
});

test('isUserRole validates all five canonical roles', () => {
  assert.equal(isUserRole('student_personnel'), true);
  assert.equal(isUserRole('coordinator'), true);
  assert.equal(isUserRole('technician'), true);
  assert.equal(isUserRole('administrator'), true);
  assert.equal(isUserRole('management'), true);

  assert.equal(isUserRole('superadmin'), false);
  assert.equal(isUserRole('guest'), false);
  assert.equal(isUserRole(''), false);
});

test('formatRoleLabel maps every canonical role and preserves fallback behavior', () => {
  assert.equal(formatRoleLabel('student_personnel'), 'Student / Personnel');
  assert.equal(formatRoleLabel('coordinator'), 'Maintenance Coordinator');
  assert.equal(formatRoleLabel('technician'), 'Maintenance Technician');
  assert.equal(formatRoleLabel('administrator'), 'School Administrator');
  assert.equal(formatRoleLabel('management'), 'School Management');
  assert.equal(formatRoleLabel(null), 'Unknown Role');
  assert.equal(formatRoleLabel(undefined), 'Unknown Role');
  assert.equal(formatRoleLabel(''), 'Unknown Role');
  assert.equal(formatRoleLabel('field_technician'), 'Field Technician');
});
