GRANT CREATE ON SCHEMA finance TO finance_guard;
ALTER TABLE finance.membership ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE finance.membership ADD COLUMN display_name text NOT NULL DEFAULT '';
GRANT UPDATE (display_name) ON finance.membership TO app_user;
CREATE INDEX membership_identity ON finance.membership (issuer, subject) WHERE active;

-- Discovery is bound to verified identity, never a caller-supplied tenant claim.
CREATE FUNCTION finance.identity_memberships() RETURNS TABLE(tenant_id uuid, id uuid, principal_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT tenant_id, id, principal_kind FROM finance.membership
    WHERE issuer = current_setting('app.issuer', true) AND subject = current_setting('app.subject', true) AND active
$$;
ALTER FUNCTION finance.identity_memberships() OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.identity_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.identity_memberships() TO app_user;

CREATE TABLE finance.member_bank_account (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    account_id uuid NOT NULL,
    PRIMARY KEY (tenant_id, member_id, account_id),
    FOREIGN KEY (tenant_id, member_id, unit_id) REFERENCES finance.member_unit(tenant_id, member_id, unit_id),
    FOREIGN KEY (tenant_id, account_id) REFERENCES finance.bank_account(tenant_id, id)
);
ALTER TABLE finance.member_bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.member_bank_account FORCE ROW LEVEL SECURITY;
CREATE POLICY provisioner ON finance.member_bank_account TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY guard_read ON finance.member_bank_account FOR SELECT TO finance_guard USING (true);
GRANT SELECT ON finance.member_bank_account TO finance_guard;
GRANT SELECT, INSERT, DELETE ON finance.member_bank_account TO app_user;

CREATE FUNCTION finance.account_allowed(t uuid, u uuid, a uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM finance.member_bank_account s JOIN finance.bank_account b
        ON (b.tenant_id, b.unit_id, b.id) = (s.tenant_id, s.unit_id, s.account_id)
        WHERE s.tenant_id = t AND s.unit_id = u AND s.account_id = a AND s.member_id = finance.actor(t))
$$;
ALTER FUNCTION finance.account_allowed(uuid, uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.account_allowed(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.account_allowed(uuid, uuid, uuid) TO app_user, finance_guard;
CREATE POLICY account_scope ON finance.bank_account AS RESTRICTIVE TO app_user USING (finance.account_allowed(tenant_id, unit_id, id));
CREATE POLICY account_scope ON finance.bank_entry AS RESTRICTIVE TO app_user
USING (finance.account_allowed(tenant_id, unit_id, account_id)) WITH CHECK (finance.account_allowed(tenant_id, unit_id, account_id));
CREATE POLICY account_scope ON finance.bank_balance AS RESTRICTIVE TO app_user
USING (finance.account_allowed(tenant_id, unit_id, account_id)) WITH CHECK (finance.account_allowed(tenant_id, unit_id, account_id));

-- Unclassified historical bank evidence is hidden until explicitly scoped.
ALTER TABLE finance.source_record ADD COLUMN account_id uuid;
ALTER TABLE finance.source_record ADD FOREIGN KEY (tenant_id, account_id) REFERENCES finance.bank_account(tenant_id, id);
CREATE POLICY evidence_account_scope ON finance.source_record AS RESTRICTIVE TO app_user
USING (dataset_kind <> 'bank' OR finance.account_allowed(tenant_id, unit_id, account_id))
WITH CHECK (dataset_kind <> 'bank' OR finance.account_allowed(tenant_id, unit_id, account_id));
CREATE POLICY allocation_account_scope ON finance.allocation AS RESTRICTIVE TO app_user
USING (EXISTS (SELECT 1 FROM finance.bank_entry b WHERE (b.tenant_id, b.id) = (allocation.tenant_id, bank_entry_id)))
WITH CHECK (EXISTS (SELECT 1 FROM finance.bank_entry b WHERE (b.tenant_id, b.id) = (allocation.tenant_id, bank_entry_id)));
CREATE FUNCTION finance.decision_accounts_allowed(t uuid, d uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM finance.allocation a JOIN finance.bank_entry b ON (b.tenant_id, b.id) = (a.tenant_id, a.bank_entry_id)
        WHERE a.tenant_id = t AND a.decision_id = d AND NOT finance.account_allowed(t, b.unit_id, b.account_id))
$$;
ALTER FUNCTION finance.decision_accounts_allowed(uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.decision_accounts_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.decision_accounts_allowed(uuid, uuid) TO app_user;
CREATE POLICY decision_account_scope ON finance.reconciliation_decision AS RESTRICTIVE FOR SELECT TO app_user USING (finance.decision_accounts_allowed(tenant_id, id));
CREATE POLICY review_account_scope ON finance.reconciliation_review AS RESTRICTIVE TO app_user
USING (finance.decision_accounts_allowed(tenant_id, decision_id)) WITH CHECK (finance.decision_accounts_allowed(tenant_id, decision_id));
CREATE OR REPLACE FUNCTION finance.allocated_minor(t uuid, u uuid, entry uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT coalesce(sum(a.amount_minor), 0) FROM finance.allocation a
    JOIN finance.reconciliation_review r ON (r.tenant_id, r.decision_id) = (a.tenant_id, a.decision_id)
    JOIN finance.bank_entry b ON (b.tenant_id, b.unit_id, b.id) = (t, u, entry)
    WHERE a.tenant_id = t AND a.bank_entry_id = entry AND r.decision = 'confirmed'
      AND finance.financial_access(t, u, CASE WHEN b.direction = 'credit' THEN 'incoming_bank' ELSE 'bank' END)
      AND finance.account_allowed(t, u, b.account_id)
$$;

-- An admin can delegate only their own units. Bootstrap admins manage zero-unit users.
CREATE FUNCTION finance.manages_member(t uuid, m uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT finance.allowed(t, NULL, 'configure') AND NOT EXISTS (
        SELECT 1 FROM finance.member_unit target WHERE target.tenant_id = t AND target.member_id = m
        AND NOT EXISTS (SELECT 1 FROM finance.member_unit own WHERE own.tenant_id = t
            AND own.member_id = finance.actor(t) AND own.unit_id = target.unit_id))
$$;
ALTER FUNCTION finance.manages_member(uuid, uuid) OWNER TO finance_guard;
REVOKE ALL ON FUNCTION finance.manages_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance.manages_member(uuid, uuid) TO app_user;
CREATE POLICY managed_approvals ON finance.approval_scope AS RESTRICTIVE FOR SELECT TO app_user
USING (member_id = finance.actor(tenant_id) OR finance.manages_member(tenant_id, member_id));
CREATE POLICY managed_read ON finance.membership AS RESTRICTIVE FOR SELECT TO app_user
USING (id = finance.actor(tenant_id) OR finance.manages_member(tenant_id, id));
CREATE POLICY managed_update ON finance.membership AS RESTRICTIVE FOR UPDATE TO app_user
USING (id <> finance.actor(tenant_id) AND finance.manages_member(tenant_id, id))
WITH CHECK (id <> finance.actor(tenant_id) AND finance.manages_member(tenant_id, id));
REVOKE DELETE ON finance.membership FROM app_user;
DO $$
DECLARE tab text;
BEGIN
    FOREACH tab IN ARRAY ARRAY['member_role', 'member_unit'] LOOP
        EXECUTE format('CREATE POLICY managed_scope ON finance.%I AS RESTRICTIVE TO app_user USING (member_id = finance.actor(tenant_id) OR finance.manages_member(tenant_id, member_id)) WITH CHECK (member_id <> finance.actor(tenant_id) AND finance.manages_member(tenant_id, member_id))', tab);
        EXECUTE format('CREATE POLICY no_self_delete ON finance.%I AS RESTRICTIVE FOR DELETE TO app_user USING (member_id <> finance.actor(tenant_id))', tab);
    END LOOP;
END $$;
CREATE POLICY unit_delegation ON finance.member_unit AS RESTRICTIVE FOR INSERT TO app_user WITH CHECK (finance.allowed(tenant_id, unit_id, 'configure'));
CREATE POLICY unit_scope ON finance.business_unit AS RESTRICTIVE FOR SELECT TO app_user
USING (EXISTS (SELECT 1 FROM finance.member_unit s WHERE s.tenant_id = business_unit.tenant_id
    AND s.member_id = finance.actor(s.tenant_id) AND s.unit_id = business_unit.id));
CREATE POLICY unit_update_scope ON finance.business_unit AS RESTRICTIVE FOR UPDATE TO app_user
USING (finance.allowed(tenant_id, id, 'configure')) WITH CHECK (finance.allowed(tenant_id, id, 'configure'));
CREATE POLICY unit_delete_scope ON finance.business_unit AS RESTRICTIVE FOR DELETE TO app_user USING (finance.allowed(tenant_id, id, 'configure'));
CREATE POLICY bank_scope_read ON finance.member_bank_account FOR SELECT TO app_user
USING (member_id = finance.actor(tenant_id) OR finance.manages_member(tenant_id, member_id));
CREATE POLICY bank_scope_insert ON finance.member_bank_account FOR INSERT TO app_user
WITH CHECK (member_id <> finance.actor(tenant_id) AND finance.manages_member(tenant_id, member_id)
    AND finance.allowed(tenant_id, unit_id, 'configure') AND finance.account_allowed(tenant_id, unit_id, account_id));
CREATE POLICY bank_scope_delete ON finance.member_bank_account FOR DELETE TO app_user
USING (member_id <> finance.actor(tenant_id) AND finance.manages_member(tenant_id, member_id));
CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON finance.member_bank_account FOR EACH ROW EXECUTE FUNCTION finance.record_audit();

CREATE POLICY entry_source_account ON finance.bank_entry AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id, s.account_id) = (bank_entry.tenant_id, source_id, bank_entry.account_id)));
CREATE POLICY balance_source_account ON finance.bank_balance AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id, s.account_id) = (bank_balance.tenant_id, source_id, bank_balance.account_id)));

-- Separate action rights from read access: reviewers do not become AP operators.
INSERT INTO finance.role_permission VALUES ('ap', 'draft_payable'), ('ar', 'draft_receivable'),
    ('ar', 'propose_match'), ('reconciliation', 'propose_match'), ('reconciliation', 'exception');
CREATE POLICY draft_title ON finance.title AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'draft_' || direction));
CREATE POLICY edit_title ON finance.title AS RESTRICTIVE FOR UPDATE TO app_user
USING (finance.allowed(tenant_id, unit_id, 'draft_' || direction)) WITH CHECK (finance.allowed(tenant_id, unit_id, 'draft_' || direction));
CREATE POLICY submit_payable ON finance.payable_submission AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'draft_payable'));
CREATE POLICY payable_draft_evidence ON finance.payable_evidence AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'draft_payable'));
CREATE POLICY propose_match ON finance.reconciliation_decision FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'propose_match'));
CREATE POLICY operator_proposal ON finance.reconciliation_decision AS RESTRICTIVE FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'propose_match'));
CREATE POLICY read_match_proposal ON finance.reconciliation_decision FOR SELECT TO app_user
USING (finance.allowed(tenant_id, unit_id, 'propose_match'));
CREATE POLICY propose_allocation ON finance.allocation FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'propose_match'));
CREATE POLICY read_allocation ON finance.allocation FOR SELECT TO app_user
USING (finance.allowed(tenant_id, unit_id, 'propose_match'));
CREATE POLICY allocation_title_scope ON finance.allocation AS RESTRICTIVE TO app_user
USING (EXISTS (SELECT 1 FROM finance.title t WHERE (t.tenant_id, t.id) = (allocation.tenant_id, title_id)))
WITH CHECK (EXISTS (SELECT 1 FROM finance.title t WHERE (t.tenant_id, t.id) = (allocation.tenant_id, title_id)));
CREATE POLICY reconciliation_exception_read ON finance.close_exception FOR SELECT TO app_user
USING (finance.allowed(tenant_id, unit_id, 'exception'));
CREATE POLICY reconciliation_exception_insert ON finance.close_exception FOR INSERT TO app_user
WITH CHECK (finance.allowed(tenant_id, unit_id, 'exception'));
CREATE POLICY exception_source_scope ON finance.close_exception AS RESTRICTIVE TO app_user
USING (EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (close_exception.tenant_id, source_id)))
WITH CHECK (EXISTS (SELECT 1 FROM finance.source_record s WHERE (s.tenant_id, s.id) = (close_exception.tenant_id, source_id)));

-- Raw audit JSON must not leak account evidence hidden by the business table policies.
CREATE POLICY audit_account_scope ON finance.audit_detail AS RESTRICTIVE FOR SELECT TO app_user
USING (category NOT IN ('bank', 'incoming_bank', 'reconcile') OR
    CASE
        WHEN table_name IN ('reconciliation_decision', 'reconciliation_review') THEN
            finance.decision_accounts_allowed(tenant_id, coalesce(after_row->>'decision_id', before_row->>'decision_id', after_row->>'id', before_row->>'id')::uuid)
        WHEN table_name = 'allocation' THEN EXISTS (SELECT 1 FROM finance.bank_entry b
            WHERE (b.tenant_id, b.id) = (audit_detail.tenant_id, coalesce(after_row->>'bank_entry_id', before_row->>'bank_entry_id')::uuid))
        WHEN table_name = 'source_review' THEN EXISTS (SELECT 1 FROM finance.source_record s
            WHERE (s.tenant_id, s.id) = (audit_detail.tenant_id, coalesce(after_row->>'source_id', before_row->>'source_id')::uuid))
        ELSE finance.account_allowed(tenant_id, unit_id,
            coalesce(after_row->>'account_id', before_row->>'account_id',
                CASE WHEN table_name = 'bank_account' THEN coalesce(after_row->>'id', before_row->>'id') END)::uuid)
    END);
DROP POLICY audit_metadata_read ON finance.audit_metadata;
CREATE POLICY audit_metadata_read ON finance.audit_metadata FOR SELECT TO app_user
USING (finance.allowed(tenant_id, unit_id, 'configure') OR finance.allowed(tenant_id, unit_id, 'close'));
CREATE POLICY audit_membership_scope ON finance.audit_detail AS RESTRICTIVE FOR SELECT TO app_user
USING (table_name NOT IN ('membership', 'member_role', 'member_unit', 'member_bank_account', 'approval_scope') OR
    finance.manages_member(tenant_id, coalesce(after_row->>'member_id', before_row->>'member_id', after_row->>'id', before_row->>'id')::uuid));
DROP POLICY batch_read ON finance.import_batch;
CREATE POLICY batch_read ON finance.import_batch FOR SELECT TO app_user USING (
    finance.allowed(tenant_id, unit_id, 'configure') OR finance.allowed(tenant_id, unit_id, dataset_kind)
    OR (dataset_kind = 'bank' AND finance.allowed(tenant_id, unit_id, 'incoming_bank')));
REVOKE CREATE ON SCHEMA finance FROM finance_guard;
