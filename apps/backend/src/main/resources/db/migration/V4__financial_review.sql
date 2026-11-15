CREATE TABLE finance.payable_submission (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title_id uuid NOT NULL,
    snapshot jsonb NOT NULL,
    origin text NOT NULL CHECK (origin IN ('human', 'ai', 'rule')),
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id, title_id) REFERENCES finance.title(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.payable_review (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    submission_id uuid NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
    reason text NOT NULL CHECK (reason <> ''),
    origin text NOT NULL DEFAULT 'human' CHECK (origin = 'human'),
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, submission_id),
    FOREIGN KEY (tenant_id, unit_id, submission_id) REFERENCES finance.payable_submission(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.reconciliation_decision (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    origin text NOT NULL CHECK (origin IN ('human', 'ai', 'rule')),
    rationale text NOT NULL,
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id) REFERENCES finance.business_unit(tenant_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES finance.membership(tenant_id, id)
);
CREATE TABLE finance.allocation (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    decision_id uuid NOT NULL,
    title_id uuid NOT NULL,
    bank_entry_id uuid NOT NULL,
    amount_minor bigint NOT NULL CHECK (amount_minor > 0),
    currency text NOT NULL REFERENCES finance.currency(code),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, decision_id, title_id, bank_entry_id),
    FOREIGN KEY (tenant_id, unit_id, decision_id) REFERENCES finance.reconciliation_decision(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id, title_id) REFERENCES finance.title(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, unit_id, bank_entry_id) REFERENCES finance.bank_entry(tenant_id, unit_id, id)
);
CREATE TABLE finance.reconciliation_review (
    tenant_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    decision_id uuid NOT NULL,
    decision text NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
    reason text NOT NULL CHECK (reason <> ''),
    origin text NOT NULL DEFAULT 'human' CHECK (origin = 'human'),
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, decision_id),
    FOREIGN KEY (tenant_id, unit_id, decision_id) REFERENCES finance.reconciliation_decision(tenant_id, unit_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES finance.membership(tenant_id, id)
);

CREATE FUNCTION finance.human_actor(t uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT current_setting('app.actor_kind', true) = 'human' AND EXISTS (
        SELECT 1 FROM finance.membership WHERE tenant_id = t AND id = finance.actor(t) AND principal_kind = 'human')
$$;
ALTER FUNCTION finance.human_actor(uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.human_actor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.human_actor(uuid) TO app_user;

-- All proposals and reviews are immutable; this trigger stamps the verified actor,
-- captures the submitted title, and serializes confirmation per tenant.
CREATE FUNCTION finance.validate_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE proposer uuid; submitted jsonb; current_title jsonb;
BEGIN
    NEW.actor_id := finance.actor(NEW.tenant_id);
    NEW.created_at := statement_timestamp();
    IF NEW.actor_id IS NULL OR (NEW.origin = 'human' AND NOT coalesce(finance.human_actor(NEW.tenant_id), false)) THEN
        RAISE EXCEPTION 'invalid actor' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
    IF TG_TABLE_NAME = 'payable_submission' THEN
        SELECT to_jsonb(t) INTO NEW.snapshot FROM finance.title t
        WHERE (t.tenant_id, t.unit_id, t.id) = (NEW.tenant_id, NEW.unit_id, NEW.title_id)
            AND t.direction = 'payable' AND t.status = 'open' AND t.observation_state = 'expected';
        IF NEW.snapshot IS NULL THEN RAISE EXCEPTION 'invalid payable submission' USING ERRCODE = '23514'; END IF;
    ELSIF TG_TABLE_NAME = 'payable_review' THEN
        SELECT s.actor_id, s.snapshot, to_jsonb(t) INTO proposer, submitted, current_title
        FROM finance.payable_submission s JOIN finance.title t ON (t.tenant_id, t.id) = (s.tenant_id, s.title_id)
        WHERE (s.tenant_id, s.unit_id, s.id) = (NEW.tenant_id, NEW.unit_id, NEW.submission_id);
        IF NOT coalesce(finance.can_approve(NEW.tenant_id, NEW.unit_id, 'approve_payable'), false)
            OR proposer IS NULL OR proposer = NEW.actor_id THEN
            RAISE EXCEPTION 'independent human approver required' USING ERRCODE = '42501';
        END IF;
        IF NEW.decision = 'approved' AND submitted IS DISTINCT FROM current_title THEN
            RAISE EXCEPTION 'title changed since submission' USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'reconciliation_review' THEN
        IF current_setting('transaction_isolation') <> 'read committed' THEN
            RAISE EXCEPTION 'confirmation requires READ COMMITTED isolation' USING ERRCODE = '23514';
        END IF;
        SELECT actor_id INTO proposer FROM finance.reconciliation_decision
        WHERE (tenant_id, unit_id, id) = (NEW.tenant_id, NEW.unit_id, NEW.decision_id);
        IF NOT coalesce(finance.can_approve(NEW.tenant_id, NEW.unit_id, 'review_reconciliation'), false)
            OR proposer IS NULL OR proposer = NEW.actor_id THEN
            RAISE EXCEPTION 'independent human reviewer required' USING ERRCODE = '42501';
        END IF;
        IF NEW.decision = 'confirmed' THEN
            IF NOT EXISTS (SELECT 1 FROM finance.allocation WHERE tenant_id = NEW.tenant_id AND decision_id = NEW.decision_id) THEN
                RAISE EXCEPTION 'cannot confirm empty decision' USING ERRCODE = '23514';
            END IF;
            IF EXISTS (
                SELECT 1 FROM finance.allocation a
                JOIN finance.title t ON (t.tenant_id, t.id) = (a.tenant_id, a.title_id)
                JOIN finance.bank_entry b ON (b.tenant_id, b.id) = (a.tenant_id, a.bank_entry_id)
                WHERE a.tenant_id = NEW.tenant_id AND a.decision_id = NEW.decision_id
                AND (a.currency <> t.currency OR a.currency <> b.currency OR t.status <> 'open'
                    OR t.observation_state <> 'expected'
                    OR (t.direction = 'receivable') <> (b.direction = 'credit'))
            ) THEN RAISE EXCEPTION 'conflicting allocation evidence' USING ERRCODE = '23514'; END IF;
            IF EXISTS (
                SELECT a.bank_entry_id FROM finance.allocation a
                JOIN finance.bank_entry b ON (b.tenant_id, b.id) = (a.tenant_id, a.bank_entry_id)
                WHERE a.tenant_id = NEW.tenant_id AND (a.decision_id = NEW.decision_id OR EXISTS (
                    SELECT 1 FROM finance.reconciliation_review r WHERE (r.tenant_id, r.decision_id) = (a.tenant_id, a.decision_id) AND r.decision = 'confirmed'))
                GROUP BY a.bank_entry_id, b.amount_minor HAVING sum(a.amount_minor) > b.amount_minor
            ) OR EXISTS (
                SELECT a.title_id FROM finance.allocation a
                JOIN finance.title t ON (t.tenant_id, t.id) = (a.tenant_id, a.title_id)
                WHERE a.tenant_id = NEW.tenant_id AND (a.decision_id = NEW.decision_id OR EXISTS (
                    SELECT 1 FROM finance.reconciliation_review r WHERE (r.tenant_id, r.decision_id) = (a.tenant_id, a.decision_id) AND r.decision = 'confirmed'))
                GROUP BY a.title_id, t.current_amount_minor HAVING sum(a.amount_minor) > t.current_amount_minor
            ) THEN RAISE EXCEPTION 'allocation exceeds available amount' USING ERRCODE = '23514'; END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION finance.validate_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 0));
    IF NOT EXISTS (SELECT 1 FROM finance.reconciliation_decision
        WHERE (tenant_id, unit_id, id, actor_id) = (NEW.tenant_id, NEW.unit_id, NEW.decision_id, finance.actor(NEW.tenant_id)))
        OR EXISTS (SELECT 1 FROM finance.reconciliation_review WHERE tenant_id = NEW.tenant_id AND decision_id = NEW.decision_id) THEN
        RAISE EXCEPTION 'only proposer can allocate an unreviewed decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;

DO $$
DECLARE tab text; permission text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['payable_submission','payable_review','reconciliation_decision','allocation','reconciliation_review'] LOOP
        permission := CASE WHEN tab LIKE 'payable_%' THEN 'payable' ELSE 'reconcile' END;
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', tab);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', tab);
        EXECUTE format('CREATE POLICY provisioner ON finance.%I TO %I USING (true) WITH CHECK (true)', tab, current_user);
        EXECUTE format('CREATE POLICY guard_read ON finance.%I FOR SELECT TO finance_guard USING (true)', tab);
        EXECUTE format('GRANT SELECT ON finance.%I TO finance_guard', tab);
        EXECUTE format('GRANT SELECT, INSERT ON finance.%I TO app_user', tab);
        EXECUTE format('CREATE POLICY scoped_read ON finance.%I FOR SELECT TO app_user USING (finance.allowed(tenant_id, unit_id, %L))', tab, permission);
        EXECUTE format('CREATE POLICY scoped_insert ON finance.%I FOR INSERT TO app_user WITH CHECK (finance.allowed(tenant_id, unit_id, %L))', tab, permission);
        IF tab <> 'allocation' THEN
            EXECUTE format('CREATE TRIGGER validate_workflow BEFORE INSERT ON finance.%I FOR EACH ROW EXECUTE FUNCTION finance.validate_workflow()', tab);
        END IF;
    END LOOP;
END $$;
CREATE TRIGGER validate_allocation BEFORE INSERT ON finance.allocation FOR EACH ROW EXECUTE FUNCTION finance.validate_allocation();
ALTER FUNCTION finance.validate_workflow() OWNER TO finance_guard;
ALTER FUNCTION finance.validate_allocation() OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.validate_workflow(), finance.validate_allocation() FROM PUBLIC, app_user;

CREATE INDEX submission_title ON finance.payable_submission (tenant_id, unit_id, title_id);
CREATE INDEX allocation_title ON finance.allocation (tenant_id, unit_id, title_id);
CREATE INDEX allocation_bank ON finance.allocation (tenant_id, unit_id, bank_entry_id);

-- The scalar exposes only the sum for an explicitly authorized title, never bank details.
CREATE FUNCTION finance.settled_minor(t uuid, u uuid, title uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT coalesce(sum(a.amount_minor), 0) FROM finance.allocation a
    JOIN finance.reconciliation_review r ON (r.tenant_id, r.decision_id) = (a.tenant_id, a.decision_id)
    JOIN finance.title ti ON (ti.tenant_id, ti.unit_id, ti.id) = (t, u, title)
    WHERE a.tenant_id = t AND a.title_id = title AND r.decision = 'confirmed'
      AND finance.allowed(t, u, ti.direction)
$$;
ALTER FUNCTION finance.settled_minor(uuid, uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.settled_minor(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.settled_minor(uuid, uuid, uuid) TO app_user;
-- Invoker view preserves title RLS. Outstanding != bank balance.
CREATE VIEW finance.title_position WITH (security_invoker = true) AS
SELECT t.*, t.current_amount_minor - finance.settled_minor(t.tenant_id, t.unit_id, t.id) AS outstanding_minor
FROM finance.title t;
GRANT SELECT ON finance.title_position TO app_user;

CREATE FUNCTION finance.allocated_minor(t uuid, u uuid, entry uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT coalesce(sum(a.amount_minor), 0) FROM finance.allocation a
    JOIN finance.reconciliation_review r ON (r.tenant_id, r.decision_id) = (a.tenant_id, a.decision_id)
    JOIN finance.bank_entry b ON (b.tenant_id, b.unit_id, b.id) = (t, u, entry)
    WHERE a.tenant_id = t AND a.bank_entry_id = entry AND r.decision = 'confirmed'
      AND finance.financial_access(t, u, CASE WHEN b.direction = 'credit' THEN 'incoming_bank' ELSE 'bank' END)
$$;
ALTER FUNCTION finance.allocated_minor(uuid, uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.allocated_minor(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.allocated_minor(uuid, uuid, uuid) TO app_user;
CREATE VIEW finance.bank_position WITH (security_invoker = true) AS
SELECT b.*, b.amount_minor - finance.allocated_minor(b.tenant_id, b.unit_id, b.id) AS unallocated_minor
FROM finance.bank_entry b;
GRANT SELECT ON finance.bank_position TO app_user;
