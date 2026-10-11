-- READ-ONLY DEPENDENCY REVIEW. Run in the configured project's SQL editor.
-- No schema or data changes. Review results alongside mobile and Edge Function source.
-- Catalog dependencies alone cannot discover every dynamic SQL/client dependency.
SELECT conrelid::regclass AS child_table, confrelid::regclass AS parent_table,
       conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

SELECT p.oid::regprocedure AS function_name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind IN ('f','p')
ORDER BY p.oid::regprocedure::text;

SELECT tablename, indexname, indexdef
FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;
