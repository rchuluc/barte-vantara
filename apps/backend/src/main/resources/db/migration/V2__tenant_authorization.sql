CREATE SCHEMA finance;
REVOKE ALL ON SCHEMA finance FROM PUBLIC;
GRANT USAGE ON SCHEMA finance TO app_user;

-- Narrow function owner, never a login or runtime role membership.
CREATE ROLE finance_guard NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT finance_guard TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA finance TO finance_guard;

CREATE TABLE finance.tenant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);
CREATE TABLE finance.business_unit (
    tenant_id uuid NOT NULL REFERENCES finance.tenant(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);
CREATE TABLE finance.membership (
    tenant_id uuid NOT NULL REFERENCES finance.tenant(id),
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    issuer text NOT NULL CHECK (issuer <> ''),
    subject text NOT NULL CHECK (subject <> ''),
    active boolean NOT NULL DEFAULT true,
    principal_kind text NOT NULL DEFAULT 'human' CHECK (principal_kind IN ('human', 'ai')),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, issuer, subject)
);
CREATE TABLE finance.role_permission (
    role text NOT NULL CHECK (role IN ('ap', 'ar', 'reconciliation', 'controllership', 'fpa', 'admin')),
    permission text NOT NULL,
    PRIMARY KEY (role, permission)
);
INSERT INTO finance.role_permission VALUES
    ('ap', 'payable'), ('ar', 'receivable'), ('ar', 'incoming_bank'), ('ar', 'collection'),
    ('reconciliation', 'payable'), ('reconciliation', 'receivable'),
    ('reconciliation', 'bank'), ('reconciliation', 'reconcile'),
    ('controllership', 'payable'), ('controllership', 'receivable'),
    ('controllership', 'bank'), ('controllership', 'reconcile'), ('controllership', 'close'),
    ('fpa', 'planning'), ('admin', 'configure');
CREATE TABLE finance.member_role (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('ap', 'ar', 'reconciliation', 'controllership', 'fpa', 'admin')),
    PRIMARY KEY (tenant_id, member_id, role),
    FOREIGN KEY (tenant_id, member_id) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.member_unit (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, member_id, unit_id),
    FOREIGN KEY (tenant_id, member_id) REFERENCES finance.membership(tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id)
);
-- Only the authorization provisioner (migration owner initially) can grant these.
CREATE TABLE finance.approval_scope (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    permission text NOT NULL CHECK (permission IN ('approve_payable', 'review_reconciliation', 'publish_summary')),
    PRIMARY KEY (tenant_id, member_id, unit_id, permission),
    FOREIGN KEY (tenant_id, member_id, unit_id) REFERENCES finance.member_unit(tenant_id, member_id, unit_id)
);

CREATE FUNCTION finance.actor(t uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT id FROM finance.membership
    WHERE tenant_id = t AND t::text = current_setting('app.tenant', true)
      AND issuer = current_setting('app.issuer', true)
      AND subject = current_setting('app.subject', true) AND active
      AND current_setting('app.actor_kind', true) IN ('human', 'ai')
$$;
CREATE FUNCTION finance.allowed(t uuid, u uuid, p text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.member_role r
        JOIN finance.role_permission p1 ON p1.role = r.role AND p1.permission = p
        WHERE r.tenant_id = t AND r.member_id = finance.actor(t)
          AND (u IS NULL OR EXISTS (SELECT 1 FROM finance.member_unit s
              WHERE s.tenant_id = t AND s.member_id = r.member_id AND s.unit_id = u))
    )
$$;
CREATE FUNCTION finance.can_approve(t uuid, u uuid, p text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT current_setting('app.actor_kind', true) = 'human' AND EXISTS (
        SELECT 1 FROM finance.approval_scope s JOIN finance.membership m
          ON (m.tenant_id, m.id) = (s.tenant_id, s.member_id)
        WHERE s.tenant_id = t AND s.member_id = finance.actor(t)
          AND s.unit_id = u AND s.permission = p AND m.principal_kind = 'human'
    )
$$;
ALTER FUNCTION finance.actor(uuid) OWNER TO finance_guard;
ALTER FUNCTION finance.allowed(uuid, uuid, text) OWNER TO finance_guard;
ALTER FUNCTION finance.can_approve(uuid, uuid, text) OWNER TO finance_guard;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA finance TO app_user;

DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['tenant','business_unit','membership','role_permission','member_role','member_unit','approval_scope'] LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY provisioner ON finance.%I TO %I USING (true) WITH CHECK (true)', tab, current_user);
        EXECUTE format('CREATE POLICY guard_read ON finance.%I FOR SELECT TO finance_guard USING (true)', tab);
        EXECUTE format('GRANT SELECT ON finance.%I TO finance_guard, app_user', tab);
    END LOOP;
END $$;
CREATE POLICY tenant_read ON finance.tenant FOR SELECT TO app_user USING (finance.actor(id) IS NOT NULL);
CREATE POLICY unit_read ON finance.business_unit FOR SELECT TO app_user USING (
    finance.allowed(tenant_id, NULL, 'configure') OR EXISTS (
        SELECT 1 FROM finance.member_unit s WHERE s.tenant_id = business_unit.tenant_id
        AND s.unit_id = business_unit.id AND s.member_id = finance.actor(business_unit.tenant_id)));
CREATE POLICY membership_read ON finance.membership FOR SELECT TO app_user USING (
    id = finance.actor(tenant_id) OR finance.allowed(tenant_id, NULL, 'configure'));
CREATE POLICY permission_read ON finance.role_permission FOR SELECT TO app_user USING (true);
DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['member_role','member_unit','approval_scope'] LOOP
        EXECUTE format('CREATE POLICY member_read ON finance.%I FOR SELECT TO app_user USING (member_id = finance.actor(tenant_id) OR finance.allowed(tenant_id, NULL, ''configure''))', tab);
    END LOOP;
    FOREACH tab IN ARRAY ARRAY['business_unit','membership','member_role','member_unit'] LOOP
        EXECUTE format('GRANT INSERT, UPDATE, DELETE ON finance.%I TO app_user', tab);
        EXECUTE format('CREATE POLICY configure_insert ON finance.%I FOR INSERT TO app_user WITH CHECK (finance.allowed(tenant_id, NULL, ''configure''))', tab);
        EXECUTE format('CREATE POLICY configure_update ON finance.%I FOR UPDATE TO app_user USING (finance.allowed(tenant_id, NULL, ''configure'')) WITH CHECK (finance.allowed(tenant_id, NULL, ''configure''))', tab);
        EXECUTE format('CREATE POLICY configure_delete ON finance.%I FOR DELETE TO app_user USING (finance.allowed(tenant_id, NULL, ''configure''))', tab);
    END LOOP;
END $$;
-- Identity binding and principal classification cannot be rewritten by a tenant admin.
REVOKE UPDATE ON finance.membership FROM app_user;
GRANT UPDATE (active) ON finance.membership TO app_user;
