-- Run after Flyway releases its history lock, not inside a versioned migration.
SET lock_timeout = '10s';
ALTER TABLE flyway_schema_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE flyway_schema_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS migration_history_owner ON flyway_schema_history;
CREATE POLICY migration_history_owner ON flyway_schema_history TO CURRENT_USER USING (true) WITH CHECK (true);
