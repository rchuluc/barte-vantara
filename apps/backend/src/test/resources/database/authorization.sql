INSERT INTO finance.tenant VALUES (md5('a')::uuid, 'Tenant A'), (md5('b')::uuid, 'Tenant B');
INSERT INTO finance.business_unit VALUES
    (md5('a')::uuid, md5('a-unit')::uuid, 'SP-Interior'),
    (md5('a')::uuid, md5('a-other')::uuid, 'NORTE'),
    (md5('b')::uuid, md5('b-unit')::uuid, 'Tenant B unit');
INSERT INTO finance.membership (tenant_id, id, issuer, subject, active, principal_kind)
SELECT md5(t)::uuid, md5(t || '-' || s)::uuid, 'https://cognito.example/pool', s, s <> 'inactive',
    CASE WHEN s = 'robot' THEN 'ai' ELSE 'human' END
FROM (VALUES ('a'), ('b')) tenants(t)
CROSS JOIN (VALUES ('ap'), ('ar'), ('reconciliation'), ('controllership'), ('fpa'), ('admin'),
    ('approver'), ('reviewer'), ('robot'), ('inactive'), ('shared')) subjects(s)
WHERE t = 'a' OR s IN ('shared', 'ar');
INSERT INTO finance.member_role
SELECT tenant_id, id, CASE WHEN subject IN ('shared', 'inactive') THEN 'ar'
    WHEN subject IN ('approver', 'robot') THEN 'ap'
    WHEN subject = 'reviewer' THEN 'reconciliation' ELSE subject END
FROM finance.membership;
INSERT INTO finance.member_unit
SELECT tenant_id, id, CASE WHEN tenant_id = md5('a')::uuid THEN md5('a-unit')::uuid ELSE md5('b-unit')::uuid END
FROM finance.membership;
INSERT INTO finance.approval_scope
SELECT tenant_id, id, md5('a-unit')::uuid,
    CASE WHEN subject = 'reviewer' THEN 'review_reconciliation' ELSE 'approve_payable' END
FROM finance.membership WHERE subject IN ('ap', 'approver', 'reviewer', 'robot');
INSERT INTO finance.member_role VALUES (md5('a')::uuid, md5('a-reviewer')::uuid, 'controllership');
INSERT INTO finance.approval_scope VALUES (md5('a')::uuid, md5('a-reviewer')::uuid, md5('a-unit')::uuid, 'publish_summary');
INSERT INTO finance.import_batch (tenant_id, unit_id, id, source_system, object_ref, source_version, dataset_kind)
VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('batch-protheus')::uuid, 'protheus',
    '01_contas_a_receber_protheus_jul2026.csv', 'fixture-v1', 'receivable');
