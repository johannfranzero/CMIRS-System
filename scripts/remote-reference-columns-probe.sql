-- CMIRS — Reference-table column facts (read-only)
BEGIN TRANSACTION READ ONLY;
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('locations','categories','report_attachments','work_logs')
ORDER BY table_name, ordinal_position;
ROLLBACK;
