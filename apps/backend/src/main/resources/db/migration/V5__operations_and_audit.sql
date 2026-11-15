ALTER TABLE finance.source_review ADD COLUMN exceptions jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(exceptions) = 'array');
ALTER TABLE finance.source_review ADD COLUMN contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version = 1);
CREATE POLICY human_source_review ON finance.source_review AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (origin <> 'human' OR finance.human_actor(tenant_id));
CREATE POLICY human_evidence ON finance.payable_evidence AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (origin <> 'human' OR finance.human_actor(tenant_id));
CREATE TRIGGER stamp_source_review BEFORE INSERT ON finance.source_review FOR EACH ROW EXECUTE FUNCTION finance.validate_workflow();
CREATE TRIGGER stamp_evidence BEFORE INSERT ON finance.payable_evidence FOR EACH ROW EXECUTE FUNCTION finance.validate_workflow();

CREATE VIEW finance.source_processing WITH (security_invoker = true) AS
SELECT s.*, coalesce(r.state, 'received') AS processing_state, r.interpretation AS normalized_output,
    coalesce(r.exceptions, '[]'::jsonb) AS unresolved_exceptions
FROM finance.source_record s LEFT JOIN LATERAL (
    SELECT state, interpretation, exceptions FROM finance.source_review
    WHERE tenant_id = s.tenant_id AND source_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1
) r ON true;
GRANT SELECT ON finance.source_processing TO app_user;

CREATE TABLE finance.bank_balance (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL,
    balance_type text NOT NULL CHECK (balance_type IN ('OPBD', 'CLBD', 'OPAV', 'CLAV', 'ITBD', 'ITAV')),
    balance_date date NOT NULL,
    direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency text NOT NULL,
    source_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, source_id, balance_type),
    FOREIGN KEY (tenant_id, unit_id, account_id, currency) REFERENCES finance.bank_account(tenant_id, unit_id, id, currency),
    FOREIGN KEY (tenant_id, unit_id, source_id) REFERENCES finance.source_record(tenant_id, unit_id, id)
);
CREATE TABLE finance.collection_case (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL,
    note text NOT NULL,
    follow_up_on date,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id, title_id) REFERENCES finance.title(tenant_id, unit_id, id)
);
CREATE TABLE finance.close_exception (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    period_end date NOT NULL,
    source_id uuid NOT NULL,
    note text NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id, source_id) REFERENCES finance.source_record(tenant_id, unit_id, id)
);
CREATE TABLE finance.forecast (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    period_end date NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inflow', 'outflow')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency text NOT NULL REFERENCES finance.currency(code),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id)
);
CREATE TABLE finance.financial_summary (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    period_end date NOT NULL,
    metric text NOT NULL CHECK (metric IN ('expected_inflow', 'expected_outflow', 'settled_inflow', 'settled_outflow')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency text NOT NULL REFERENCES finance.currency(code),
    prepared_by uuid NOT NULL DEFAULT finance.actor(nullif(current_setting('app.tenant', true), '')::uuid),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id),
    FOREIGN KEY (tenant_id, prepared_by) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.summary_publication (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    summary_id uuid NOT NULL,
    approved_by uuid NOT NULL DEFAULT finance.actor(nullif(current_setting('app.tenant', true), '')::uuid),
    approved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, summary_id),
    FOREIGN KEY (tenant_id, unit_id, summary_id) REFERENCES finance.financial_summary(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, approved_by) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.integration_metadata (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    last_attempt_at timestamptz,
    last_result text CHECK (last_result IN ('success', 'failed')),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, provider),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id)
);

DO $$
DECLARE tab text; permission text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['bank_balance','collection_case','close_exception','forecast','financial_summary','summary_publication','integration_metadata'] LOOP
        permission := CASE tab WHEN 'bank_balance' THEN 'bank' WHEN 'collection_case' THEN 'collection'
            WHEN 'close_exception' THEN 'close' WHEN 'forecast' THEN 'planning' WHEN 'integration_metadata' THEN 'configure' ELSE 'close' END;
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY provisioner ON finance.%I TO %I USING (true) WITH CHECK (true)', tab, current_user);
        EXECUTE format('CREATE POLICY guard_read ON finance.%I FOR SELECT TO finance_guard USING (true)', tab);
        EXECUTE format('GRANT SELECT ON finance.%I TO finance_guard', tab);
        EXECUTE format('GRANT SELECT, INSERT ON finance.%I TO app_user', tab);
        IF tab NOT IN ('financial_summary','summary_publication') THEN
            EXECUTE format('CREATE POLICY scoped_read ON finance.%I FOR SELECT TO app_user USING (finance.allowed(tenant_id, unit_id, %L))', tab, permission);
            EXECUTE format('CREATE POLICY scoped_insert ON finance.%I FOR INSERT TO app_user WITH CHECK (finance.allowed(tenant_id, unit_id, %L))', tab, permission);
        END IF;
    END LOOP;
END $$;
CREATE POLICY summary_read ON finance.financial_summary FOR SELECT TO app_user USING (
    finance.allowed(tenant_id, unit_id, 'close') OR (finance.allowed(tenant_id, unit_id, 'planning') AND EXISTS (
        SELECT 1 FROM finance.summary_publication p WHERE (p.tenant_id, p.summary_id) = (financial_summary.tenant_id, financial_summary.id))));
CREATE POLICY summary_insert ON finance.financial_summary FOR INSERT TO app_user WITH CHECK (
    finance.allowed(tenant_id, unit_id, 'close') AND prepared_by = finance.actor(tenant_id));
CREATE POLICY publication_read ON finance.summary_publication FOR SELECT TO app_user USING (
    finance.allowed(tenant_id, unit_id, 'planning') OR finance.allowed(tenant_id, unit_id, 'close'));
CREATE POLICY publication_insert ON finance.summary_publication FOR INSERT TO app_user WITH CHECK (
    finance.can_approve(tenant_id, unit_id, 'publish_summary') AND approved_by = finance.actor(tenant_id)
    AND EXISTS (SELECT 1 FROM finance.financial_summary s
        WHERE (s.tenant_id, s.id) = (summary_publication.tenant_id, summary_id) AND s.prepared_by <> finance.actor(s.tenant_id)));
CREATE POLICY balance_source ON finance.bank_balance AS RESTRICTIVE FOR INSERT TO app_user WITH CHECK (
    EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (bank_balance.tenant_id, source_id) AND s.dataset_kind = 'bank'));
CREATE POLICY collection_title ON finance.collection_case AS RESTRICTIVE FOR INSERT TO app_user WITH CHECK (
    EXISTS (SELECT 1 FROM finance.title t WHERE (t.tenant_id, t.id) = (collection_case.tenant_id, title_id) AND t.direction = 'receivable'));
GRANT UPDATE (enabled, last_attempt_at, last_result), DELETE ON finance.integration_metadata TO app_user;
CREATE POLICY integration_update ON finance.integration_metadata FOR UPDATE TO app_user
USING (finance.allowed(tenant_id, unit_id, 'configure')) WITH CHECK (finance.allowed(tenant_id, unit_id, 'configure'));
CREATE POLICY integration_delete ON finance.integration_metadata FOR DELETE TO app_user USING (finance.allowed(tenant_id, unit_id, 'configure'));

CREATE TABLE finance.audit_metadata (
    tenant_id uuid NOT NULL REFERENCES finance.tenant(id),
    unit_id uuid,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    entity_id uuid,
    operation text NOT NULL,
    actor_id uuid,
    actor_issuer text,
    actor_subject text,
    origin text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id)
);
CREATE TABLE finance.audit_detail (
    tenant_id uuid NOT NULL,
    unit_id uuid,
    id uuid NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    category text NOT NULL,
    before_row jsonb,
    after_row jsonb,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, id) REFERENCES finance.audit_metadata(tenant_id, id)
);
DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['audit_metadata','audit_detail'] LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY provisioner ON finance.%I FOR SELECT TO %I USING (true)', tab, current_user);
        EXECUTE format('CREATE POLICY guard_insert ON finance.%I FOR INSERT TO finance_guard WITH CHECK (true)', tab);
        EXECUTE format('GRANT INSERT ON finance.%I TO finance_guard', tab);
        EXECUTE format('GRANT SELECT ON finance.%I TO app_user', tab);
    END LOOP;
END $$;
CREATE POLICY audit_metadata_read ON finance.audit_metadata FOR SELECT TO app_user USING (finance.allowed(tenant_id, NULL, 'configure'));
CREATE POLICY audit_detail_read ON finance.audit_detail FOR SELECT TO app_user USING (finance.financial_access(tenant_id, unit_id, category));

CREATE FUNCTION finance.record_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE row_data jsonb; old_data jsonb; new_data jsonb; t uuid; u uuid; event_id uuid := gen_random_uuid(); category text;
BEGIN
    IF TG_OP <> 'DELETE' THEN new_data := to_jsonb(NEW); END IF;
    IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
    row_data := coalesce(new_data, old_data);
    t := (row_data->>'tenant_id')::uuid;
    u := (row_data->>'unit_id')::uuid;
    category := CASE
        WHEN TG_TABLE_NAME = 'title' THEN row_data->>'direction'
        WHEN TG_TABLE_NAME = 'source_record' THEN row_data->>'category'
        WHEN TG_TABLE_NAME = 'source_review' THEN (SELECT s.category FROM finance.source_record s WHERE s.tenant_id = t AND s.id = (row_data->>'source_id')::uuid)
        WHEN TG_TABLE_NAME = 'bank_entry' AND row_data->>'direction' = 'credit' THEN 'incoming_bank'
        WHEN TG_TABLE_NAME LIKE 'bank_%' THEN 'bank'
        WHEN TG_TABLE_NAME LIKE 'payable_%' THEN 'payable'
        WHEN TG_TABLE_NAME IN ('reconciliation_decision','reconciliation_review','allocation') THEN 'reconcile'
        WHEN TG_TABLE_NAME = 'collection_case' THEN 'collection'
        WHEN TG_TABLE_NAME IN ('close_exception','financial_summary','summary_publication') THEN 'close'
        WHEN TG_TABLE_NAME = 'forecast' THEN 'planning'
        ELSE 'configure' END;
    INSERT INTO finance.audit_metadata (tenant_id, unit_id, id, table_name, entity_id, operation, actor_id, actor_issuer, actor_subject, origin)
    VALUES (t, u, event_id, TG_TABLE_NAME, (row_data->>'id')::uuid, TG_OP, finance.actor(t),
        nullif(current_setting('app.issuer', true), ''), nullif(current_setting('app.subject', true), ''),
        coalesce(nullif(current_setting('app.actor_kind', true), ''), 'provisioner'));
    INSERT INTO finance.audit_detail (tenant_id, unit_id, id, table_name, operation, category, before_row, after_row)
    VALUES (t, u, event_id, TG_TABLE_NAME, TG_OP, category, old_data, new_data);
    RETURN coalesce(NEW, OLD);
END $$;
ALTER FUNCTION finance.record_audit() OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.record_audit() FROM PUBLIC, app_user;
DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['business_unit','membership','member_role','member_unit','approval_scope','import_batch','source_record','source_review',
        'title','bank_account','bank_entry','bank_balance','payable_evidence','payable_submission','payable_review',
        'reconciliation_decision','allocation','reconciliation_review','collection_case','close_exception','forecast',
        'financial_summary','summary_publication','integration_metadata'] LOOP
        EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON finance.%I FOR EACH ROW EXECUTE FUNCTION finance.record_audit()', tab);
    END LOOP;
END $$;

CREATE FUNCTION finance.protect_title_position() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE settled numeric;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
    SELECT coalesce(sum(a.amount_minor), 0) INTO settled FROM finance.allocation a JOIN finance.reconciliation_review r
      ON (a.tenant_id, a.decision_id) = (r.tenant_id, r.decision_id)
      WHERE a.tenant_id = NEW.tenant_id AND a.title_id = NEW.id AND r.decision = 'confirmed';
    IF NEW.current_amount_minor < settled OR (settled > 0 AND NEW.status <> 'open') THEN
        RAISE EXCEPTION 'title conflicts with confirmed settlements' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
ALTER FUNCTION finance.protect_title_position() OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.protect_title_position() FROM PUBLIC, app_user;
CREATE TRIGGER protect_position BEFORE UPDATE ON finance.title FOR EACH ROW EXECUTE FUNCTION finance.protect_title_position();

CREATE INDEX audit_detail_scope ON finance.audit_detail (tenant_id, unit_id, category);
CREATE INDEX audit_metadata_time ON finance.audit_metadata (tenant_id, occurred_at);
CREATE INDEX balance_account ON finance.bank_balance (tenant_id, unit_id, account_id, balance_date);
CREATE INDEX balance_source ON finance.bank_balance (tenant_id, unit_id, source_id);
CREATE INDEX collection_title ON finance.collection_case (tenant_id, unit_id, title_id);
CREATE INDEX close_source ON finance.close_exception (tenant_id, unit_id, source_id);
CREATE INDEX forecast_period ON finance.forecast (tenant_id, unit_id, period_end);
CREATE INDEX summary_period ON finance.financial_summary (tenant_id, unit_id, period_end);
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
