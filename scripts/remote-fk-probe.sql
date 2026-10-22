-- CMIRS — Foreign-key facts (read-only)
BEGIN TRANSACTION READ ONLY;
SELECT con.conrelid::regclass::text AS tbl,
       con.conname AS conname,
       pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
WHERE con.contype = 'f'
  AND con.connamespace = 'public'::regnamespace
ORDER BY 1, 2;
ROLLBACK;
