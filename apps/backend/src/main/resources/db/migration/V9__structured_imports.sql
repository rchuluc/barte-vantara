-- Durable staging keeps file parsing and financial writes bounded and resumable.
CREATE TABLE finance.ingestion (
    tenant_id uuid NOT NULL,
    id uuid NOT NULL,
    owner_id uuid NOT NULL DEFAULT finance.actor(nullif(current_setting('app.tenant', true), '')::uuid),
    filename text NOT NULL,
    dataset_kind text NOT NULL CHECK (dataset_kind IN ('receivable', 'payable', 'bank')),
    object_key text NOT NULL,
    object_version text,
    sha256 text,
    platform text NOT NULL DEFAULT 'custom',
    headers jsonb NOT NULL DEFAULT '[]',
    mapping jsonb NOT NULL DEFAULT '{}',
    state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading','mapping','processing','completed','failed')),
    total bigint NOT NULL DEFAULT 0,
    processed bigint NOT NULL DEFAULT 0,
    rejected bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_id) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.ingestion_row (
    tenant_id uuid NOT NULL,
    ingestion_id uuid NOT NULL,
    row_number bigint NOT NULL,
    cells jsonb NOT NULL,
    corrected_cells jsonb,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected')),
    error text,
    result_id uuid,
    PRIMARY KEY (tenant_id, ingestion_id, row_number),
    FOREIGN KEY (tenant_id, ingestion_id) REFERENCES finance.ingestion(tenant_id, id)
);
CREATE TABLE finance.ingestion_scope (
    tenant_id uuid NOT NULL,
    ingestion_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    account_id uuid,
    PRIMARY KEY (tenant_id, ingestion_id, unit_id),
    FOREIGN KEY (tenant_id, ingestion_id) REFERENCES finance.ingestion(tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id),
    FOREIGN KEY (tenant_id, account_id) REFERENCES finance.bank_account(tenant_id, id)
);
GRANT CREATE ON SCHEMA finance TO finance_guard;
DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['ingestion','ingestion_row','ingestion_scope'] LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY provisioner ON finance.%I TO %I USING (true) WITH CHECK (true)', tab, current_user);
        EXECUTE format('CREATE POLICY guard_read ON finance.%I FOR SELECT TO finance_guard USING (true)', tab);
        EXECUTE format('GRANT SELECT ON finance.%I TO finance_guard', tab);
        EXECUTE format('GRANT SELECT, INSERT ON finance.%I TO app_user', tab);
    END LOOP;
END $$;
CREATE FUNCTION finance.ingestion_allowed(t uuid, i uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM finance.ingestion j WHERE j.tenant_id = t AND j.id = i
        AND j.owner_id = finance.actor(t)
        AND finance.allowed(t, NULL, CASE WHEN j.dataset_kind = 'bank' THEN 'bank' ELSE 'draft_' || j.dataset_kind END)
        AND NOT EXISTS (SELECT 1 FROM finance.ingestion_scope s WHERE s.tenant_id = t AND s.ingestion_id = i
            AND (NOT finance.allowed(t, s.unit_id, CASE WHEN j.dataset_kind = 'bank' THEN 'bank' ELSE 'draft_' || j.dataset_kind END)
                OR (j.dataset_kind = 'bank' AND NOT finance.account_allowed(t, s.unit_id, s.account_id)))))
$$;
ALTER FUNCTION finance.ingestion_allowed(uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.ingestion_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.ingestion_allowed(uuid, uuid) TO app_user;
CREATE POLICY read_job ON finance.ingestion FOR SELECT TO app_user USING (finance.ingestion_allowed(tenant_id, id));
CREATE POLICY insert_job ON finance.ingestion FOR INSERT TO app_user WITH CHECK (
    owner_id = finance.actor(tenant_id) AND finance.allowed(tenant_id, NULL,
        CASE WHEN dataset_kind = 'bank' THEN 'bank' ELSE 'draft_' || dataset_kind END));
CREATE POLICY update_job ON finance.ingestion FOR UPDATE TO app_user USING (finance.ingestion_allowed(tenant_id, id))
WITH CHECK (finance.ingestion_allowed(tenant_id, id));
GRANT UPDATE (object_version, sha256, platform, headers, mapping, state, total, processed, rejected) ON finance.ingestion TO app_user;
CREATE POLICY rows_scope ON finance.ingestion_row TO app_user
USING (finance.ingestion_allowed(tenant_id, ingestion_id)) WITH CHECK (finance.ingestion_allowed(tenant_id, ingestion_id));
GRANT UPDATE (state, error, result_id, corrected_cells) ON finance.ingestion_row TO app_user;
CREATE POLICY scope_read ON finance.ingestion_scope FOR SELECT TO app_user USING (finance.ingestion_allowed(tenant_id, ingestion_id));
CREATE POLICY scope_insert ON finance.ingestion_scope FOR INSERT TO app_user WITH CHECK (
    finance.ingestion_allowed(tenant_id, ingestion_id) AND EXISTS (SELECT 1 FROM finance.ingestion j
        WHERE (j.tenant_id, j.id) = (tenant_id, ingestion_id) AND finance.allowed(j.tenant_id, unit_id,
            CASE WHEN j.dataset_kind = 'bank' THEN 'bank' ELSE 'draft_' || j.dataset_kind END)
        AND (j.dataset_kind <> 'bank' OR finance.account_allowed(j.tenant_id, unit_id, account_id))));
CREATE INDEX ingestion_pending ON finance.ingestion_row (tenant_id, ingestion_id, row_number) WHERE state = 'pending';
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE ON finance.ingestion FOR EACH ROW EXECUTE FUNCTION finance.record_audit();
CREATE TRIGGER audit_change AFTER UPDATE ON finance.ingestion_row FOR EACH ROW EXECUTE FUNCTION finance.record_audit();
CREATE POLICY ingestion_audit_scope ON finance.audit_detail AS RESTRICTIVE FOR SELECT TO app_user
USING (table_name NOT IN ('ingestion', 'ingestion_row') OR finance.ingestion_allowed(tenant_id,
    coalesce(after_row->>'ingestion_id', before_row->>'ingestion_id', after_row->>'id', before_row->>'id')::uuid));
CREATE POLICY ingestion_audit_read ON finance.audit_detail FOR SELECT TO app_user
USING (table_name IN ('ingestion', 'ingestion_row') AND finance.ingestion_allowed(tenant_id,
    coalesce(after_row->>'ingestion_id', before_row->>'ingestion_id', after_row->>'id', before_row->>'id')::uuid));
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
