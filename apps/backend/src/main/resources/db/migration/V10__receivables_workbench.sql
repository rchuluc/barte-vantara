-- A collection account may receive payments for titles in several authorized units.
ALTER TABLE finance.allocation DROP CONSTRAINT allocation_tenant_id_unit_id_title_id_fkey;
ALTER TABLE finance.allocation ADD FOREIGN KEY (tenant_id, title_id) REFERENCES finance.title(tenant_id, id);

-- Immutable workbench decisions reuse the existing actor stamping and audit triggers.
ALTER TABLE finance.reconciliation_decision ADD COLUMN bank_entry_id uuid;
ALTER TABLE finance.reconciliation_decision ADD COLUMN disposition text NOT NULL DEFAULT 'draft'
    CHECK (disposition IN ('draft', 'pending', 'rejected_suggestion'));
ALTER TABLE finance.reconciliation_decision ADD COLUMN rejected_title_id uuid;
ALTER TABLE finance.reconciliation_decision ADD FOREIGN KEY (tenant_id, unit_id, bank_entry_id)
    REFERENCES finance.bank_entry(tenant_id, unit_id, id);
ALTER TABLE finance.reconciliation_decision ADD FOREIGN KEY (tenant_id, rejected_title_id)
    REFERENCES finance.title(tenant_id, id);
CREATE INDEX decision_bank ON finance.reconciliation_decision (tenant_id, bank_entry_id, created_at DESC);

CREATE POLICY workbench_bank_scope ON finance.reconciliation_decision AS RESTRICTIVE TO app_user
USING (bank_entry_id IS NULL OR EXISTS (SELECT 1 FROM finance.bank_entry b WHERE b.tenant_id=reconciliation_decision.tenant_id AND b.id=bank_entry_id))
WITH CHECK (bank_entry_id IS NULL OR EXISTS (SELECT 1 FROM finance.bank_entry b
    WHERE b.tenant_id=reconciliation_decision.tenant_id AND b.id=bank_entry_id AND b.direction='credit'));

CREATE POLICY rejected_title_scope ON finance.reconciliation_decision AS RESTRICTIVE TO app_user
USING (rejected_title_id IS NULL OR EXISTS (SELECT 1 FROM finance.title t WHERE t.tenant_id=reconciliation_decision.tenant_id AND t.id=rejected_title_id))
WITH CHECK (rejected_title_id IS NULL OR EXISTS (SELECT 1 FROM finance.title t WHERE t.tenant_id=reconciliation_decision.tenant_id AND t.id=rejected_title_id AND t.direction='receivable'));

-- Reviewing a cross-unit proposal also requires authority over every title unit.
GRANT CREATE ON SCHEMA finance TO finance_guard;
CREATE FUNCTION finance.decision_titles_reviewable(t uuid, d uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM finance.allocation a JOIN finance.title title ON (title.tenant_id,title.id)=(a.tenant_id,a.title_id)
        WHERE a.tenant_id=t AND a.decision_id=d
        AND NOT coalesce(finance.can_approve(t,title.unit_id,'review_reconciliation'),false))
$$;
ALTER FUNCTION finance.decision_titles_reviewable(uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.decision_titles_reviewable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.decision_titles_reviewable(uuid, uuid) TO app_user;
REVOKE CREATE ON SCHEMA finance FROM finance_guard;

CREATE POLICY review_title_scope ON finance.reconciliation_review AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (finance.decision_titles_reviewable(tenant_id, decision_id));

CREATE POLICY operator_review_read ON finance.reconciliation_review FOR SELECT TO app_user
USING (finance.allowed(tenant_id, unit_id, 'propose_match'));
