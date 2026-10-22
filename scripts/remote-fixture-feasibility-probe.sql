-- CMIRS — Fixture feasibility probe (transaction is ALWAYS rolled back)
-- Question: can the harness create a second technician account so that
-- "technician B must not touch technician A's work order" can be proven?
-- The transaction is rolled back, so nothing is persisted.
BEGIN;

DO $$
DECLARE
  v_auth_id uuid := gen_random_uuid();
  v_ok boolean := false;
  v_msg text := '';
BEGIN
  BEGIN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated',
      'cmirs-harness-tech-b@example.invalid', crypt('harness-only-not-a-real-secret', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Harness Technician B"}',
      now(), now(), '', '', '', ''
    );
    v_ok := true;
    v_msg := 'auth.users insert: OK';
  EXCEPTION WHEN OTHERS THEN
    v_msg := 'auth.users insert FAILED: ' || SQLERRM;
  END;

  IF v_ok THEN
    BEGIN
      INSERT INTO public.profiles (id, email, full_name, role, is_active)
      VALUES (v_auth_id, 'cmirs-harness-tech-b@example.invalid', 'Harness Technician B', 'technician', true);
      v_msg := v_msg || ' | profiles insert: OK';
    EXCEPTION WHEN OTHERS THEN
      v_msg := v_msg || ' | profiles insert FAILED: ' || SQLERRM;
    END;
  END IF;

  RAISE NOTICE '%', v_msg;
END $$;

SELECT count(*) AS auth_users_now FROM auth.users;

ROLLBACK;
