CREATE SCHEMA platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO app_user;

CREATE ROLE platform_guard NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT platform_guard TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA platform TO platform_guard;
GRANT USAGE ON SCHEMA finance TO platform_guard;

-- Only public branding belongs here. Memberships and financial data retain their
-- identity-scoped policies in finance; public branding does not grant access.
CREATE TABLE platform.tenant_registration (
    id uuid PRIMARY KEY REFERENCES finance.tenant(id),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{0,62}$'),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    primary_color text NOT NULL CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TABLE platform.tenant_domain (
    domain text PRIMARY KEY CHECK (domain ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' AND length(domain) <= 253),
    tenant_id uuid NOT NULL REFERENCES platform.tenant_registration(id)
);

DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['tenant_registration', 'tenant_domain'] LOOP
        EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY migration_owner ON platform.%I TO %I USING (true) WITH CHECK (true)', tab, current_user);
        EXECUTE format('CREATE POLICY public_branding ON platform.%I FOR SELECT TO app_user USING (true)', tab);
        EXECUTE format('CREATE POLICY provisioning ON platform.%I TO platform_guard USING (true) WITH CHECK (true)', tab);
        EXECUTE format('GRANT SELECT ON platform.%I TO app_user', tab);
        EXECUTE format('GRANT INSERT, SELECT ON platform.%I TO platform_guard', tab);
    END LOOP;
    FOREACH tab IN ARRAY ARRAY['tenant', 'membership', 'member_role'] LOOP
        EXECUTE format('CREATE POLICY platform_provisioning ON finance.%I FOR INSERT TO platform_guard WITH CHECK (true)', tab);
        EXECUTE format('GRANT INSERT ON finance.%I TO platform_guard', tab);
    END LOOP;
END $$;

-- Like finance.actor, this boundary consumes identity context installed by the
-- trusted backend, never HTTP parameters. The isolated GitHub JWT filter is the
-- only application path that installs app.platform_provisioner.
CREATE FUNCTION platform.register_tenant(
    tenant uuid, slug text, name text, color text, domains jsonb,
    issuer text, subject text, email text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE member uuid := gen_random_uuid();
BEGIN
    IF current_setting('app.platform_provisioner', true) IS DISTINCT FROM 'github' THEN
        RAISE EXCEPTION 'Platform provisioning identity required' USING ERRCODE = '42501';
    END IF;
    INSERT INTO finance.tenant (id, name) VALUES (tenant, name);
    INSERT INTO platform.tenant_registration VALUES (tenant, slug, name, color);
    INSERT INTO platform.tenant_domain SELECT value, tenant FROM jsonb_array_elements_text(domains);
    INSERT INTO finance.membership (tenant_id, id, issuer, subject, email, display_name)
        VALUES (tenant, member, issuer, subject, email, 'Administrator');
    INSERT INTO finance.member_role VALUES (tenant, member, 'admin');
END $$;

ALTER FUNCTION platform.register_tenant(uuid, text, text, text, jsonb, text, text, text) OWNER TO platform_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.register_tenant(uuid, text, text, text, jsonb, text, text, text) TO app_user;
REVOKE CREATE ON SCHEMA platform FROM platform_guard;
