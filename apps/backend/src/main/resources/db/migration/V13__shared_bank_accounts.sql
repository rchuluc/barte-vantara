-- Keep the original unit column for rollback compatibility; associations are authoritative.
ALTER TABLE finance.bank_account ADD UNIQUE (tenant_id, id, currency);
CREATE TABLE finance.bank_account_unit (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    account_id uuid NOT NULL,
    currency text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (tenant_id, unit_id, account_id),
    UNIQUE (tenant_id, unit_id, account_id, currency),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id),
    FOREIGN KEY (tenant_id, account_id, currency) REFERENCES finance.bank_account(tenant_id, id, currency)
);
ALTER TABLE finance.bank_account_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_account_unit FORCE ROW LEVEL SECURITY;
CREATE POLICY provisioner ON finance.bank_account_unit TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY guard_access ON finance.bank_account_unit TO finance_guard USING (true) WITH CHECK (true);
GRANT SELECT ON finance.bank_account_unit TO app_user;
GRANT SELECT, INSERT, UPDATE ON finance.bank_account_unit TO finance_guard;
INSERT INTO finance.bank_account_unit (tenant_id, unit_id, account_id, currency)
SELECT tenant_id, unit_id, id, currency FROM finance.bank_account;

ALTER TABLE finance.bank_entry DROP CONSTRAINT bank_entry_tenant_id_unit_id_account_id_currency_fkey;
ALTER TABLE finance.bank_entry ADD FOREIGN KEY (tenant_id, unit_id, account_id, currency)
    REFERENCES finance.bank_account_unit(tenant_id, unit_id, account_id, currency);
ALTER TABLE finance.bank_balance DROP CONSTRAINT bank_balance_tenant_id_unit_id_account_id_currency_fkey;
ALTER TABLE finance.bank_balance ADD FOREIGN KEY (tenant_id, unit_id, account_id, currency)
    REFERENCES finance.bank_account_unit(tenant_id, unit_id, account_id, currency);
ALTER TABLE finance.member_bank_account DROP CONSTRAINT member_bank_account_pkey;
ALTER TABLE finance.member_bank_account ADD PRIMARY KEY (tenant_id, member_id, unit_id, account_id);
ALTER TABLE finance.member_bank_account ADD FOREIGN KEY (tenant_id, unit_id, account_id)
    REFERENCES finance.bank_account_unit(tenant_id, unit_id, account_id);

GRANT CREATE ON SCHEMA finance TO finance_guard;
CREATE FUNCTION finance.link_original_account_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    INSERT INTO finance.bank_account_unit (tenant_id, unit_id, account_id, currency)
    VALUES (NEW.tenant_id, NEW.unit_id, NEW.id, NEW.currency);
    RETURN NEW;
END $$;
ALTER FUNCTION finance.link_original_account_unit() OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.link_original_account_unit() FROM PUBLIC;
CREATE TRIGGER link_original_unit AFTER INSERT ON finance.bank_account
FOR EACH ROW EXECUTE FUNCTION finance.link_original_account_unit();

CREATE OR REPLACE FUNCTION finance.account_allowed(t uuid, u uuid, a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM finance.member_bank_account s
        JOIN finance.member_unit m USING (tenant_id, member_id, unit_id)
        WHERE s.tenant_id=t AND s.unit_id=u AND s.account_id=a AND s.member_id=finance.actor(t))
$$;
CREATE POLICY scoped_read ON finance.bank_account_unit FOR SELECT TO app_user
USING (finance.account_allowed(tenant_id, unit_id, account_id));

CREATE FUNCTION finance.account_configurable(t uuid, a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT finance.allowed(t, NULL, 'configure')
        AND EXISTS (SELECT 1 FROM finance.bank_account_unit WHERE tenant_id=t AND account_id=a)
        AND NOT EXISTS (SELECT 1 FROM finance.bank_account_unit b WHERE b.tenant_id=t AND b.account_id=a
            AND (NOT finance.allowed(t, b.unit_id, 'configure') OR NOT finance.account_allowed(t, b.unit_id, a)))
$$;
ALTER FUNCTION finance.account_configurable(uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.account_configurable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.account_configurable(uuid, uuid) TO app_user;
DROP POLICY account_scope ON finance.bank_account;
DROP POLICY account_read ON finance.bank_account;
DROP POLICY account_config_read ON finance.bank_account;
DROP POLICY account_config_update ON finance.bank_account;
CREATE POLICY account_read ON finance.bank_account FOR SELECT TO app_user USING (
    EXISTS (SELECT 1 FROM finance.bank_account_unit b WHERE b.tenant_id=bank_account.tenant_id AND b.account_id=bank_account.id
        AND (finance.allowed(b.tenant_id, b.unit_id, 'bank') OR finance.allowed(b.tenant_id, b.unit_id, 'incoming_bank')
            OR finance.allowed(b.tenant_id, b.unit_id, 'configure'))));
CREATE POLICY account_config_update ON finance.bank_account FOR UPDATE TO app_user
USING (finance.account_configurable(tenant_id, id)) WITH CHECK (finance.account_configurable(tenant_id, id));

-- Disabled links retain historical references and scoped read access, but cannot receive new imports.
CREATE FUNCTION finance.set_account_units(t uuid, a uuid, units uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; denomination text;
BEGIN
    SELECT currency INTO denomination FROM finance.bank_account WHERE tenant_id=t AND id=a FOR UPDATE;
    IF NOT finance.account_configurable(t, a) THEN
        RAISE EXCEPTION 'Account configuration denied' USING ERRCODE = '42501';
    END IF;
    IF coalesce(cardinality(units), 0) NOT BETWEEN 1 AND 100 OR array_position(units, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'At least one business unit is required' USING ERRCODE = '23514';
    END IF;
    FOREACH u IN ARRAY units LOOP
        IF NOT finance.allowed(t, u, 'configure') OR NOT EXISTS (
            SELECT 1 FROM finance.business_unit WHERE tenant_id=t AND id=u AND (active OR EXISTS (
                SELECT 1 FROM finance.bank_account_unit b WHERE b.tenant_id=t AND b.unit_id=u AND b.account_id=a AND b.active
            ))
        ) THEN
            RAISE EXCEPTION 'Business unit is outside your scope or disabled' USING ERRCODE = '42501';
        END IF;
        INSERT INTO finance.bank_account_unit (tenant_id, unit_id, account_id, currency)
        VALUES (t, u, a, denomination) ON CONFLICT (tenant_id, unit_id, account_id) DO UPDATE SET active=true;
        INSERT INTO finance.member_bank_account VALUES (t, finance.actor(t), u, a) ON CONFLICT DO NOTHING;
    END LOOP;
    UPDATE finance.bank_account_unit SET active=false WHERE tenant_id=t AND account_id=a AND NOT (unit_id=ANY(units));
END $$;
ALTER FUNCTION finance.set_account_units(uuid, uuid, uuid[]) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.set_account_units(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.set_account_units(uuid, uuid, uuid[]) TO app_user;
GRANT UPDATE (currency) ON finance.bank_account TO finance_guard;
CREATE POLICY shared_account_lock ON finance.bank_account FOR UPDATE TO finance_guard USING (true) WITH CHECK (true);
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON finance.bank_account_unit
FOR EACH ROW EXECUTE FUNCTION finance.record_audit();
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
