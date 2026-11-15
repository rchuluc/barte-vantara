-- Only this function can grant the caller access to a newly created unit.
GRANT CREATE ON SCHEMA finance TO finance_guard;
GRANT INSERT ON finance.business_unit, finance.member_unit TO finance_guard;
CREATE POLICY registration ON finance.business_unit FOR INSERT TO finance_guard WITH CHECK (true);
CREATE POLICY registration ON finance.member_unit FOR INSERT TO finance_guard WITH CHECK (true);

CREATE FUNCTION finance.register_unit(t uuid, unit_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE result uuid;
BEGIN
    IF NOT (finance.allowed(t, NULL, 'configure') OR finance.allowed(t, NULL, 'draft_receivable')) THEN
        RAISE EXCEPTION 'Unit registration denied' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(unit_name)) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Invalid unit name' USING ERRCODE = '23514';
    END IF;
    INSERT INTO finance.business_unit (tenant_id, name) VALUES (t, btrim(unit_name)) RETURNING id INTO result;
    INSERT INTO finance.member_unit VALUES (t, finance.actor(t), result);
    RETURN result;
END $$;
ALTER FUNCTION finance.register_unit(uuid, text) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.register_unit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.register_unit(uuid, text) TO app_user;
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
