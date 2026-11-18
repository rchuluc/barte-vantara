-- The original unit remains provenance. An explicit statement scope shares one
-- immutable source and bank movement, never copies its monetary value.
ALTER TABLE finance.source_record ADD COLUMN statement_units uuid[];
ALTER TABLE finance.source_record ADD CONSTRAINT statement_units_shape CHECK (
    statement_units IS NULL OR (dataset_kind='bank' AND cardinality(statement_units) BETWEEN 1 AND 100
        AND array_position(statement_units,NULL) IS NULL AND unit_id=ANY(statement_units)));

GRANT CREATE ON SCHEMA finance TO finance_guard;
CREATE FUNCTION finance.validate_statement_units() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.statement_units IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(NEW.statement_units) u WHERE
            NOT finance.allowed(NEW.tenant_id,u,'bank') OR NOT finance.account_allowed(NEW.tenant_id,u,NEW.account_id)
            OR NOT EXISTS (SELECT 1 FROM finance.bank_account_unit a
                JOIN finance.business_unit b ON (b.tenant_id,b.id)=(a.tenant_id,a.unit_id)
                WHERE a.tenant_id=NEW.tenant_id AND a.unit_id=u AND a.account_id=NEW.account_id AND a.active AND b.active)
    ) THEN RAISE EXCEPTION 'Statement destination denied' USING ERRCODE='42501'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER validate_statement_units BEFORE INSERT ON finance.source_record
FOR EACH ROW EXECUTE FUNCTION finance.validate_statement_units();

CREATE FUNCTION finance.statement_readable(t uuid, units uuid[], a uuid, category text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM unnest(units) u
        WHERE finance.account_allowed(t,u,a) AND finance.financial_access(t,u,category))
$$;

CREATE FUNCTION finance.bank_action_unit(t uuid, entry uuid, permission text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT u FROM finance.bank_entry b JOIN finance.source_record s ON (s.tenant_id,s.id)=(b.tenant_id,b.source_id),
        unnest(coalesce(s.statement_units,ARRAY[b.unit_id])) u
    WHERE b.tenant_id=t AND b.id=entry AND finance.account_allowed(t,u,b.account_id)
        AND CASE permission WHEN 'read' THEN finance.financial_access(t,u,CASE WHEN b.direction='credit' THEN 'incoming_bank' ELSE 'bank' END)
            WHEN 'review_reconciliation' THEN finance.can_approve(t,u,permission)
            ELSE finance.allowed(t,u,permission) END
    ORDER BY u LIMIT 1
$$;

CREATE FUNCTION finance.statement_accepts_title(t uuid, entry uuid, title uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM finance.bank_entry b
        JOIN finance.source_record s ON (s.tenant_id,s.id)=(b.tenant_id,b.source_id)
        JOIN finance.title ti ON ti.tenant_id=b.tenant_id AND ti.id=title
        WHERE b.tenant_id=t AND b.id=entry AND finance.allowed(t,ti.unit_id,ti.direction)
            AND (s.statement_units IS NULL OR ti.unit_id=ANY(s.statement_units)))
$$;

CREATE FUNCTION finance.bank_in_unit(t uuid, entry uuid, u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM finance.bank_entry b JOIN finance.source_record s ON (s.tenant_id,s.id)=(b.tenant_id,b.source_id)
        WHERE b.tenant_id=t AND b.id=entry AND u=ANY(coalesce(s.statement_units,ARRAY[b.unit_id]))
            AND finance.account_allowed(t,u,b.account_id))
$$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY['validate_statement_units()', 'statement_readable(uuid,uuid[],uuid,text)',
        'bank_action_unit(uuid,uuid,text)', 'bank_in_unit(uuid,uuid,uuid)', 'statement_accepts_title(uuid,uuid,uuid)'] LOOP
        EXECUTE 'ALTER FUNCTION finance.' || fn || ' OWNER TO finance_guard';
        EXECUTE 'REVOKE ALL ON FUNCTION finance.' || fn || ' FROM PUBLIC';
    END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION finance.statement_readable(uuid,uuid[],uuid,text),
    finance.bank_action_unit(uuid,uuid,text), finance.bank_in_unit(uuid,uuid,uuid), finance.statement_accepts_title(uuid,uuid,uuid) TO app_user;

DROP POLICY evidence_account_scope ON finance.source_record;
CREATE POLICY evidence_account_scope ON finance.source_record AS RESTRICTIVE TO app_user
USING (dataset_kind<>'bank' OR finance.statement_readable(tenant_id,coalesce(statement_units,ARRAY[unit_id]),account_id,category))
WITH CHECK (dataset_kind<>'bank' OR finance.account_allowed(tenant_id,unit_id,account_id));
CREATE POLICY shared_statement_read ON finance.source_record FOR SELECT TO app_user
USING (statement_units IS NOT NULL AND finance.statement_readable(tenant_id,statement_units,account_id,category));
CREATE POLICY shared_statement_read ON finance.import_batch FOR SELECT TO app_user
USING (EXISTS (SELECT 1 FROM finance.source_record s WHERE s.tenant_id=import_batch.tenant_id
    AND s.batch_id=import_batch.id AND s.statement_units IS NOT NULL));
DROP POLICY account_scope ON finance.bank_entry;
CREATE POLICY account_scope ON finance.bank_entry AS RESTRICTIVE TO app_user
USING (finance.bank_action_unit(tenant_id,id,'read') IS NOT NULL)
WITH CHECK (finance.account_allowed(tenant_id,unit_id,account_id));
CREATE POLICY shared_statement_read ON finance.bank_entry FOR SELECT TO app_user
USING (finance.bank_action_unit(tenant_id,id,'read') IS NOT NULL);

-- Proposals are scoped to an authorized participating BU rather than the source's
-- provenance unit. Existing single-BU decisions and their reviews remain valid.
ALTER TABLE finance.reconciliation_decision DROP CONSTRAINT reconciliation_decision_tenant_id_unit_id_bank_entry_id_fkey;
ALTER TABLE finance.reconciliation_decision ADD FOREIGN KEY (tenant_id,bank_entry_id) REFERENCES finance.bank_entry(tenant_id,id);
ALTER TABLE finance.allocation DROP CONSTRAINT allocation_tenant_id_unit_id_bank_entry_id_fkey;
ALTER TABLE finance.allocation ADD FOREIGN KEY (tenant_id,bank_entry_id) REFERENCES finance.bank_entry(tenant_id,id);
CREATE POLICY statement_decision_scope ON finance.reconciliation_decision AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (bank_entry_id IS NULL OR (finance.bank_in_unit(tenant_id,bank_entry_id,unit_id)
    AND (rejected_title_id IS NULL OR finance.statement_accepts_title(tenant_id,bank_entry_id,rejected_title_id))));

CREATE FUNCTION finance.validate_statement_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT finance.statement_accepts_title(NEW.tenant_id,NEW.bank_entry_id,NEW.title_id)
        OR NOT finance.bank_in_unit(NEW.tenant_id,NEW.bank_entry_id,NEW.unit_id) THEN
        RAISE EXCEPTION 'Allocation outside statement scope' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
ALTER FUNCTION finance.validate_statement_allocation() OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.validate_statement_allocation() FROM PUBLIC;
CREATE TRIGGER validate_statement_scope BEFORE INSERT ON finance.allocation
FOR EACH ROW EXECUTE FUNCTION finance.validate_statement_allocation();

CREATE OR REPLACE FUNCTION finance.decision_accounts_allowed(t uuid, d uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM finance.allocation a WHERE a.tenant_id=t AND a.decision_id=d
        AND finance.bank_action_unit(t,a.bank_entry_id,'read') IS NULL)
$$;
CREATE OR REPLACE FUNCTION finance.allocated_minor(t uuid, u uuid, entry uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT coalesce(sum(a.amount_minor),0) FROM finance.allocation a
    JOIN finance.reconciliation_review r ON (r.tenant_id,r.decision_id)=(a.tenant_id,a.decision_id)
    WHERE a.tenant_id=t AND a.bank_entry_id=entry AND r.decision='confirmed'
        AND finance.bank_action_unit(t,entry,'read') IS NOT NULL
$$;
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
