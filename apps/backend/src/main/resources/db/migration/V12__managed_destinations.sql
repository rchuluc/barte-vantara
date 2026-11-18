ALTER TABLE finance.business_unit ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE finance.bank_account ADD COLUMN active boolean NOT NULL DEFAULT true;

-- Preserve historical references and existing audit triggers; configuration is soft-disabled.
REVOKE DELETE ON finance.business_unit, finance.bank_account FROM app_user;
REVOKE UPDATE ON finance.business_unit FROM app_user;
GRANT UPDATE (name, active) ON finance.business_unit TO app_user;
GRANT UPDATE (bank_code, account_ref, active) ON finance.bank_account TO app_user;
CREATE POLICY account_config_read ON finance.bank_account FOR SELECT TO app_user
USING (finance.allowed(tenant_id, unit_id, 'configure'));
CREATE POLICY account_config_update ON finance.bank_account FOR UPDATE TO app_user
USING (finance.allowed(tenant_id, unit_id, 'configure'))
WITH CHECK (finance.allowed(tenant_id, unit_id, 'configure'));

-- Bootstrap only the newly registered account into its creator's existing unit scope.
GRANT CREATE ON SCHEMA finance TO finance_guard;
GRANT INSERT ON finance.bank_account, finance.member_bank_account TO finance_guard;
CREATE POLICY registration ON finance.bank_account FOR INSERT TO finance_guard WITH CHECK (true);
CREATE POLICY registration ON finance.member_bank_account FOR INSERT TO finance_guard WITH CHECK (true);
CREATE FUNCTION finance.register_account(t uuid, u uuid, bank text, reference text, denomination text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result uuid;
BEGIN
    IF NOT finance.allowed(t, u, 'configure') OR NOT EXISTS (
        SELECT 1 FROM finance.business_unit WHERE tenant_id=t AND id=u AND active
    ) THEN
        RAISE EXCEPTION 'Account registration denied' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(bank)) NOT BETWEEN 1 AND 50 OR length(btrim(reference)) NOT BETWEEN 1 AND 200
        OR denomination NOT IN ('BRL', 'USD', 'EUR') THEN
        RAISE EXCEPTION 'Invalid account' USING ERRCODE = '23514';
    END IF;
    INSERT INTO finance.bank_account (tenant_id, unit_id, bank_code, account_ref, currency)
    VALUES (t, u, btrim(bank), btrim(reference), denomination) RETURNING id INTO result;
    INSERT INTO finance.member_bank_account VALUES (t, finance.actor(t), u, result);
    RETURN result;
END $$;
ALTER FUNCTION finance.register_account(uuid, uuid, text, text, text) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.register_account(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.register_account(uuid, uuid, text, text, text) TO app_user;
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
