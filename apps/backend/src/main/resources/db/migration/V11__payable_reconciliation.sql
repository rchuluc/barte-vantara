-- Account visibility still governs proposals; allocation triggers enforce matching directions.
DROP POLICY workbench_bank_scope ON finance.reconciliation_decision;
CREATE POLICY workbench_bank_scope ON finance.reconciliation_decision AS RESTRICTIVE TO app_user
USING (bank_entry_id IS NULL OR EXISTS (SELECT 1 FROM finance.bank_entry b
    WHERE b.tenant_id=reconciliation_decision.tenant_id AND b.id=bank_entry_id))
WITH CHECK (bank_entry_id IS NULL OR EXISTS (SELECT 1 FROM finance.bank_entry b
    WHERE b.tenant_id=reconciliation_decision.tenant_id AND b.id=bank_entry_id));

DROP POLICY rejected_title_scope ON finance.reconciliation_decision;
CREATE POLICY rejected_title_scope ON finance.reconciliation_decision AS RESTRICTIVE TO app_user
USING (rejected_title_id IS NULL OR EXISTS (SELECT 1 FROM finance.title t
    WHERE t.tenant_id=reconciliation_decision.tenant_id AND t.id=rejected_title_id))
WITH CHECK (rejected_title_id IS NULL OR EXISTS (SELECT 1 FROM finance.title t
    JOIN finance.bank_entry b ON b.tenant_id=t.tenant_id
    WHERE t.tenant_id=reconciliation_decision.tenant_id AND t.id=rejected_title_id
    AND b.id=reconciliation_decision.bank_entry_id
    AND (t.direction='receivable')=(b.direction='credit')));
