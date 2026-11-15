-- Supported ISO 4217 subset, SIX List One (2026-01-01). Extend by reviewed migration.
CREATE TABLE finance.currency (
    code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
    minor_unit smallint NOT NULL CHECK (minor_unit BETWEEN 0 AND 4)
);
INSERT INTO finance.currency VALUES ('BRL', 2), ('USD', 2), ('EUR', 2), ('JPY', 0), ('KWD', 3), ('CLF', 4);
ALTER TABLE finance.currency ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.currency FORCE ROW LEVEL SECURITY;
CREATE POLICY currency_read ON finance.currency FOR SELECT USING (true);
CREATE POLICY currency_provisioner ON finance.currency TO CURRENT_USER USING (true) WITH CHECK (true);
GRANT SELECT ON finance.currency TO app_user, finance_guard;

CREATE TABLE finance.import_batch (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    source_system text NOT NULL,
    object_ref text NOT NULL,
    source_version text NOT NULL CHECK (source_version <> ''),
    contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version = 1),
    dataset_kind text NOT NULL CHECK (dataset_kind IN ('payable', 'receivable', 'bank')),
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id, dataset_kind),
    UNIQUE (tenant_id, unit_id, source_system, object_ref, source_version),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id)
);
CREATE TABLE finance.source_record (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL,
    dataset_kind text NOT NULL DEFAULT 'receivable',
    category text NOT NULL DEFAULT 'receivable',
    locator text NOT NULL CHECK (locator <> ''),
    raw_text text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id),
    UNIQUE (tenant_id, batch_id, locator),
    FOREIGN KEY (tenant_id, unit_id, batch_id, dataset_kind)
        REFERENCES finance.import_batch(tenant_id, unit_id, id, dataset_kind),
    CHECK ((dataset_kind IN ('payable', 'receivable') AND category = dataset_kind)
        OR (dataset_kind = 'bank' AND category IN ('bank', 'incoming_bank')))
);
CREATE TABLE finance.source_review (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL,
    state text NOT NULL CHECK (state IN ('parsed', 'needs_review', 'rejected', 'verified')),
    interpretation jsonb NOT NULL DEFAULT '{}',
    origin text NOT NULL CHECK (origin IN ('human', 'ai', 'rule')),
    actor_id uuid NOT NULL DEFAULT finance.actor(nullif(current_setting('app.tenant', true), '')::uuid),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id, source_id) REFERENCES finance.source_record(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.title (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    direction text NOT NULL CHECK (direction IN ('payable', 'receivable')),
    party_name text,
    party_tax_id text,
    external_id text,
    document_ref text,
    issued_on date,
    due_on date,
    currency text NOT NULL REFERENCES finance.currency(code),
    original_amount_minor bigint NOT NULL CHECK (original_amount_minor > 0),
    current_amount_minor bigint NOT NULL CHECK (current_amount_minor > 0),
    observation_state text NOT NULL DEFAULT 'expected' CHECK (observation_state IN ('expected', 'suggested')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'disputed', 'cancelled')),
    source_id uuid NOT NULL,
    normalization_key text NOT NULL DEFAULT 'title' CHECK (normalization_key <> ''),
    latest_source_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id),
    UNIQUE (tenant_id, source_id, normalization_key),
    FOREIGN KEY (tenant_id, unit_id, source_id) REFERENCES finance.source_record(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id, latest_source_id) REFERENCES finance.source_record(tenant_id, unit_id, id)
);
CREATE TABLE finance.bank_account (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    bank_code text NOT NULL,
    account_ref text NOT NULL,
    currency text NOT NULL REFERENCES finance.currency(code),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id, currency),
    UNIQUE (tenant_id, bank_code, account_ref),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id)
);
CREATE TABLE finance.bank_entry (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL,
    direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
    booking_date date NOT NULL,
    value_date date,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL,
    observation_state text NOT NULL DEFAULT 'posted' CHECK (observation_state = 'posted'),
    counterparty_name text,
    counterparty_tax_id text,
    description text NOT NULL,
    external_ref text,
    account_servicer_ref text,
    end_to_end_ref text,
    source_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id),
    UNIQUE (tenant_id, source_id),
    FOREIGN KEY (tenant_id, unit_id, account_id, currency) REFERENCES finance.bank_account(tenant_id, unit_id, id, currency),
    FOREIGN KEY (tenant_id, unit_id, source_id) REFERENCES finance.source_record(tenant_id, unit_id, id)
);
CREATE TABLE finance.payable_evidence (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL,
    source_id uuid NOT NULL,
    possible_duplicate_id uuid,
    CHECK (possible_duplicate_id IS NULL OR possible_duplicate_id <> title_id),
    interpretation jsonb NOT NULL,
    origin text NOT NULL CHECK (origin IN ('human', 'ai', 'rule')),
    actor_id uuid NOT NULL DEFAULT finance.actor(nullif(current_setting('app.tenant', true), '')::uuid),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, unit_id, title_id) REFERENCES finance.title(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id, possible_duplicate_id) REFERENCES finance.title(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id, source_id) REFERENCES finance.source_record(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES finance.membership(tenant_id, id)
);

CREATE FUNCTION finance.financial_access(t uuid, u uuid, category text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT finance.allowed(t, u, category)
        OR (category = 'incoming_bank' AND finance.allowed(t, u, 'bank'))
$$;
REVOKE ALL ON FUNCTION finance.financial_access(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.financial_access(uuid, uuid, text) TO app_user, finance_guard;

DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['import_batch','source_record','source_review','title','bank_account','bank_entry','payable_evidence'] LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY provisioner ON finance.%I TO %I USING (true) WITH CHECK (true)', tab, current_user);
        EXECUTE format('CREATE POLICY guard_read ON finance.%I FOR SELECT TO finance_guard USING (true)', tab);
        EXECUTE format('GRANT SELECT ON finance.%I TO finance_guard', tab);
        EXECUTE format('GRANT SELECT, INSERT ON finance.%I TO app_user', tab);
    END LOOP;
END $$;
CREATE POLICY batch_read ON finance.import_batch FOR SELECT TO app_user USING (
    finance.allowed(tenant_id, NULL, 'configure') OR finance.allowed(tenant_id, unit_id, dataset_kind)
    OR (dataset_kind = 'bank' AND finance.allowed(tenant_id, unit_id, 'incoming_bank')));
CREATE POLICY batch_insert ON finance.import_batch FOR INSERT TO app_user WITH CHECK (
    finance.allowed(tenant_id, unit_id, dataset_kind));
CREATE POLICY source_read ON finance.source_record FOR SELECT TO app_user USING (finance.financial_access(tenant_id, unit_id, category));
CREATE POLICY source_insert ON finance.source_record FOR INSERT TO app_user WITH CHECK (finance.financial_access(tenant_id, unit_id, category));
CREATE POLICY source_review_read ON finance.source_review FOR SELECT TO app_user USING (
    EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (source_review.tenant_id, source_id)));
CREATE POLICY source_review_insert ON finance.source_review FOR INSERT TO app_user WITH CHECK (
    actor_id = finance.actor(tenant_id) AND EXISTS (
        SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (source_review.tenant_id, source_id))
    AND (origin <> 'human' OR current_setting('app.actor_kind', true) = 'human')
    AND (state <> 'verified' OR origin = 'human'));
CREATE POLICY title_read ON finance.title FOR SELECT TO app_user USING (finance.allowed(tenant_id, unit_id, direction));
CREATE POLICY title_insert ON finance.title FOR INSERT TO app_user WITH CHECK (
    finance.allowed(tenant_id, unit_id, direction) AND EXISTS (
        SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (title.tenant_id, source_id) AND s.category = direction)
    AND latest_source_id = source_id);
GRANT UPDATE (current_amount_minor, due_on, status, latest_source_id) ON finance.title TO app_user;
CREATE POLICY title_update ON finance.title FOR UPDATE TO app_user USING (finance.allowed(tenant_id, unit_id, direction))
WITH CHECK (finance.allowed(tenant_id, unit_id, direction) AND EXISTS (
    SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (title.tenant_id, latest_source_id) AND s.category = direction));
CREATE POLICY account_read ON finance.bank_account FOR SELECT TO app_user USING (
    finance.allowed(tenant_id, unit_id, 'bank') OR finance.allowed(tenant_id, unit_id, 'incoming_bank'));
-- Account provisioning is privileged; raw bank coordinates are not tenant-admin configuration.
REVOKE INSERT ON finance.bank_account FROM app_user;
CREATE POLICY bank_read ON finance.bank_entry FOR SELECT TO app_user USING (
    finance.financial_access(tenant_id, unit_id, CASE WHEN direction = 'credit' THEN 'incoming_bank' ELSE 'bank' END));
CREATE POLICY bank_insert ON finance.bank_entry FOR INSERT TO app_user WITH CHECK (
    finance.allowed(tenant_id, unit_id, 'bank') AND EXISTS (SELECT 1 FROM finance.source_record s
        WHERE (s.tenant_id, s.id) = (bank_entry.tenant_id, source_id)
        AND s.category = CASE WHEN direction = 'credit' THEN 'incoming_bank' ELSE 'bank' END));
CREATE POLICY evidence_read ON finance.payable_evidence FOR SELECT TO app_user USING (finance.allowed(tenant_id, unit_id, 'payable'));
CREATE POLICY evidence_insert ON finance.payable_evidence FOR INSERT TO app_user WITH CHECK (
    finance.allowed(tenant_id, unit_id, 'payable') AND actor_id = finance.actor(tenant_id)
    AND (origin <> 'human' OR current_setting('app.actor_kind', true) = 'human')
    AND EXISTS (SELECT 1 FROM finance.title t WHERE (t.tenant_id, t.id) = (payable_evidence.tenant_id, title_id) AND t.direction = 'payable')
    AND EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (payable_evidence.tenant_id, source_id) AND s.category = 'payable')
    AND (possible_duplicate_id IS NULL OR EXISTS (SELECT 1 FROM finance.title t
        WHERE (t.tenant_id, t.id) = (payable_evidence.tenant_id, possible_duplicate_id) AND t.direction = 'payable')));

CREATE INDEX title_due ON finance.title (tenant_id, unit_id, direction, due_on) WHERE status = 'open';
CREATE INDEX title_latest_source ON finance.title (tenant_id, unit_id, latest_source_id);
CREATE INDEX bank_posted ON finance.bank_entry (tenant_id, unit_id, booking_date);
CREATE INDEX bank_account_entries ON finance.bank_entry (tenant_id, unit_id, account_id);
CREATE INDEX source_review_source ON finance.source_review (tenant_id, unit_id, source_id, created_at);
CREATE INDEX evidence_title ON finance.payable_evidence (tenant_id, unit_id, title_id);
CREATE INDEX evidence_source ON finance.payable_evidence (tenant_id, unit_id, source_id);
CREATE INDEX evidence_duplicate ON finance.payable_evidence (tenant_id, unit_id, possible_duplicate_id);
