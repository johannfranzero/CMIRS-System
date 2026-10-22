-- =============================================================================
-- CMIRS — Remote Production-Readiness Probe, Role-Check Pass (STRICTLY READ-ONLY)
-- =============================================================================
-- Extracts only the role-related lines of the lifecycle command functions, so
-- the enforcement can be judged without dumping the whole definition.
--
-- Safety contract: SELECT only, inside a READ ONLY transaction, rolled back.
-- =============================================================================

BEGIN TRANSACTION READ ONLY;

WITH defs AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'submit_report_with_notifications',
      'triage_report_with_notifications',
      'assign_or_reassign_report_with_notifications',
      'transition_report_status_with_notifications',
      'verify_report_with_notifications',
      'decline_assignment',
      'admin_update_profile_operational_state',
      'can_view_report'
    )
),
lines AS (
  SELECT proname, body
  FROM defs
)
SELECT
  proname AS function_name,
  -- Every line of the definition that mentions a role, a permission or an error code.
  (SELECT string_agg(trim(l), ' ⏎ ' ORDER BY l)
     FROM unnest(string_to_array(body, chr(10))) AS l
    WHERE l ~* '(v_role|get_user_role|student_personnel|coordinator|technician|administrator|management|CMIRS_FORBIDDEN|CMIRS_INVALID_STATE|CMIRS_NOT_AUTHENTICATED|auth\.uid\(\))'
  ) AS role_and_guard_lines
FROM lines
ORDER BY function_name;

ROLLBACK;
