-- CMIRS — Lifecycle command role/eligibility rules (read-only)
BEGIN TRANSACTION READ ONLY;
SELECT 'assign' AS cmd,
       s.lineno,
       s.line
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL unnest(string_to_array(pg_get_functiondef(p.oid), chr(10))) WITH ORDINALITY AS s(line, lineno)
WHERE n.nspname = 'public'
  AND p.proname IN ('assign_or_reassign_report_with_notifications','transition_report_status_with_notifications','verify_report_with_notifications','triage_report_with_notifications')
  AND s.line ~* '(RAISE EXCEPTION|caller_role|v_role|tech_id|role =|role <>|role IN|NOT IN|status <>|status =|assigned|technician_id)'
ORDER BY p.proname, s.lineno;
ROLLBACK;
