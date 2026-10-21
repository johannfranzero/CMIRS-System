import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../supabase/migrations/20261020000007_notification_lifecycle_rpcs.sql', import.meta.url);

test('notification lifecycle migration defines five hardened atomic command RPCs', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const name of [
    'submit_report_with_notifications',
    'triage_report_with_notifications',
    'assign_or_reassign_report_with_notifications',
    'transition_report_status_with_notifications',
    'verify_report_with_notifications',
  ]) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}`));
  }
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = public, auth, pg_temp/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_report_with_notifications/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_report_with_notifications/);
});

test('notification migration protects receipts, prevents generic inserts, and preserves direct-write policies', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /notification_command_receipts_actor_command_request_key/);
  assert.match(sql, /idx_notifications_event_recipient_unique/);
  assert.match(sql, /REVOKE INSERT, DELETE ON public\.notifications FROM authenticated/);
  assert.match(sql, /p_recipient_id IS NULL OR p_recipient_id = p_actor_id/);
  assert.match(sql, /p_target_status != 'under_review'/);
  assert.equal(sql.includes('DROP POLICY'), false);
  assert.equal(sql.includes('CREATE POLICY'), false);
});
