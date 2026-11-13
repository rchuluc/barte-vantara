-- APP_DB_PASSWORD must be alphanumeric (Terraform generated or local-only compose).
CREATE ROLE app_user LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user;
CREATE TABLE greetings (id integer PRIMARY KEY, message text NOT NULL);
INSERT INTO greetings (id, message) VALUES (1, 'Hello world from Kotlin and PostgreSQL');
ALTER TABLE greetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE greetings FORCE ROW LEVEL SECURITY;
GRANT SELECT ON greetings TO app_user;
-- Public reference data only; tenant data requires identity-scoped policies.
CREATE POLICY public_greeting_read ON greetings FOR SELECT TO app_user USING (true);
