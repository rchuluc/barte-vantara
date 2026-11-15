-- Hand-transcribed source fixtures, not an importer. Unit attribution for bank/messages is a test assumption.
INSERT INTO finance.import_batch (tenant_id, unit_id, id, source_system, object_ref, source_version, dataset_kind)
SELECT md5('a')::uuid, md5('a-unit')::uuid, md5('batch-' || system)::uuid, system, file, 'fixture-v1', kind
FROM (VALUES
    ('omie', '02_titulos_unidade_norte_omie_jul2026.csv', 'receivable'),
    ('itau', '03_extrato_bancario_jul2026.csv', 'bank'),
    ('inbox', '04_caixa_de_entrada_contas_a_pagar.txt', 'payable')
) v(system, file, kind);

INSERT INTO finance.source_record (tenant_id, unit_id, id, batch_id, dataset_kind, category, locator, raw_text)
SELECT md5('a')::uuid, md5('a-unit')::uuid, md5(key)::uuid, md5('batch-' || system)::uuid, kind, category, locator, raw
FROM (VALUES
    ('doce-product-source', 'protheus', 'receivable', 'receivable', 'line:4', 'Doce Ponto Comercio de Alimentos;98.765.432/0001-11;SP-Interior;NF 104533;000012345690;Produto;02/07/2026;12/07/2026;42.780,50;Aberto'),
    ('doce-royalty-source', 'protheus', 'receivable', 'receivable', 'line:11', 'Doce Ponto Comercio de Alimentos;98.765.432/0001-11;SP-Interior;NF 104588;000012345748;Royalty;08/07/2026;20/07/2026;4.850,00;Aberto'),
    ('bela-source', 'protheus', 'receivable', 'receivable', 'line:8', 'Emporio Bela Vista Alimentos SA;22.333.444/0001-55;SP-Capital;NF 104560;000012345720;Produto;06/07/2026;16/07/2026;125.000,00;Aberto'),
    ('grao-source', 'protheus', 'receivable', 'receivable', 'line:10', 'Grao Nobre Comercio Ltda;55.666.777/0001-44;SUL;NF 104580;000012345740;Produto;08/07/2026;20/07/2026;31.250,00;Aberto'),
    ('grao-omie-source', 'omie', 'receivable', 'receivable', 'line:2', 'GRAO NOBRE COM LTDA,55666777000144,FAT-2026-0331,2026-07-20,31250.00,N'),
    ('bill-source', 'inbox', 'payable', 'payable', 'email:1', E'De: financeiro@embalagenssaojorge.com.br\nPara: pagar@vantara.com.br\nData: 06/07/2026 09:14\nAssunto: NF 88231 - Vantara\n\nBom dia,\n\nSegue em anexo a NF 88231 referente ao pedido de embalagens (PC 4471).\nValor: R$ 18.900,00 - vencimento 20/07.\nDados bancarios: Banco 033 / ag 1234 / cc 56789-0\nQualquer duvida estou a disposicao.\n\nAtt,\nMarcia\n\n[anexo: NF88231.pdf]'),
    ('bill-update-source', 'inbox', 'payable', 'payable', 'email:2', E'De: marcia.rocha@embalagenssaojorge.com.br\nPara: pagar@vantara.com.br; compras@vantara.com.br\nData: 18/07/2026 16:52\nAssunto: RE: cobranca em aberto - Sao Jorge Embalagens\n\nPessoal, nao identificamos o pagamento da nota abaixo. Reenvio o boleto\natualizado com juros.\n\nNota fiscal 088231 - emissao 06/07/2026\nValor original R$ 18.900,00\nValor atualizado R$ 19.278,00 (venc. 25/07/2026)\nLinha digitavel: 03399.87654 32100.123456 78901.234567 8 91230000019278\n\nObs: o pedido PC 4471 foi entregue parcialmente (12 de 15 volumes), o\nrestante sai na proxima semana.\n\n[anexo: boleto_88231_atualizado.pdf]'),
    ('approval-thread-source', 'inbox', 'payable', 'payable', 'whatsapp:APROVACOES FIN', E'[06/07 11:02] Compras - Rafael: pessoal, NF 88231 Sao Jorge, 18.900, ok pra pagar?\n[06/07 11:40] Controladoria - Bia: entrou o material completo?\n[06/07 14:18] Compras - Rafael: acho que sim, o Joao confirmou\n[06/07 14:19] Controladoria - Bia: ok, aprovado\n[19/07 08:33] Fin - Camila: gente a Sao Jorge cobrando de novo a 88231, ja pagamos?\n[19/07 08:35] Fin - Camila: achei, pagou dia 20. era outra nota entao?\n[19/07 09:02] Controladoria - Bia: nao sei, alguem confere?'),
    ('doce-bank-source', 'itau', 'bank', 'incoming_bank', 'line:5', '14/07/2026;TED RECEBIDA DOCE PONTO COM ALIME;;47.630,50;C'),
    ('bela-bank-source', 'itau', 'bank', 'incoming_bank', 'line:8', '16/07/2026;LIQUIDACAO COBRANCA SIMPLES;000012345720;62.500,00;C'),
    ('bill-bank-source', 'itau', 'bank', 'bank', 'line:10', '20/07/2026;PAGAMENTO FORNECEDOR NF 88231;;18.900,00;D')
) v(key, system, kind, category, locator, raw);

INSERT INTO finance.title (tenant_id, unit_id, id, direction, party_name, document_ref, due_on, currency, original_amount_minor, current_amount_minor, source_id, latest_source_id)
SELECT md5('a')::uuid, md5('a-unit')::uuid, md5(key)::uuid, direction, party, doc, due::date, 'BRL', amount * 100, amount * 100, md5(key || '-source')::uuid, md5(key || '-source')::uuid
FROM (VALUES
    ('doce-product', 'receivable', 'Doce Ponto Comercio de Alimentos', 'NF 104533', '2026-07-12', 42780.50),
    ('doce-royalty', 'receivable', 'Doce Ponto Comercio de Alimentos', 'NF 104588', '2026-07-20', 4850.00),
    ('bela', 'receivable', 'Emporio Bela Vista Alimentos SA', 'NF 104560', '2026-07-16', 125000.00),
    ('grao', 'receivable', 'Grao Nobre Comercio Ltda', 'NF 104580', '2026-07-20', 31250.00),
    ('grao-omie', 'receivable', 'GRAO NOBRE COM LTDA', 'FAT-2026-0331', '2026-07-20', 31250.00),
    ('bill', 'payable', 'Sao Jorge Embalagens', 'NF 88231', '2026-07-20', 18900.00)
) v(key, direction, party, doc, due, amount);
INSERT INTO finance.bank_account VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('account')::uuid, '341', 'test-account', 'BRL');
INSERT INTO finance.bank_account VALUES (md5('a')::uuid, md5('a-unit')::uuid, md5('account-denied')::uuid, '341', 'restricted-account', 'BRL');
UPDATE finance.source_record SET account_id = md5('account')::uuid WHERE dataset_kind = 'bank';
INSERT INTO finance.member_bank_account
SELECT tenant_id, id, md5('a-unit')::uuid, md5('account')::uuid FROM finance.membership WHERE tenant_id = md5('a')::uuid;
INSERT INTO finance.bank_entry (tenant_id, unit_id, id, account_id, direction, booking_date, amount_minor, currency, description, source_id)
SELECT md5('a')::uuid, md5('a-unit')::uuid, md5(key)::uuid, md5('account')::uuid, direction, posted::date, amount * 100, 'BRL', description, md5(key || '-source')::uuid
FROM (VALUES
    ('doce-bank', 'credit', '2026-07-14', 47630.50, 'TED RECEBIDA DOCE PONTO COM ALIME'),
    ('bela-bank', 'credit', '2026-07-16', 62500.00, 'LIQUIDACAO COBRANCA SIMPLES'),
    ('bill-bank', 'debit', '2026-07-20', 18900.00, 'PAGAMENTO FORNECEDOR NF 88231')
) v(key, direction, posted, amount, description);
-- Unseen business unit and tenant rows ensure empty results are meaningful denials.
INSERT INTO finance.import_batch (tenant_id, unit_id, id, source_system, object_ref, source_version, dataset_kind)
VALUES (md5('a')::uuid, md5('a-other')::uuid, md5('other-batch')::uuid, 'omie', 'other', 'v1', 'receivable'),
    (md5('b')::uuid, md5('b-unit')::uuid, md5('b-batch')::uuid, 'omie', 'b', 'v1', 'receivable');
INSERT INTO finance.source_record (tenant_id, unit_id, id, batch_id, locator, raw_text)
VALUES (md5('a')::uuid, md5('a-other')::uuid, md5('other-source')::uuid, md5('other-batch')::uuid, '1', 'Other unit'),
    (md5('b')::uuid, md5('b-unit')::uuid, md5('b-source')::uuid, md5('b-batch')::uuid, '1', 'Other tenant');
INSERT INTO finance.title (tenant_id, unit_id, id, direction, party_name, currency, original_amount_minor, current_amount_minor, source_id, latest_source_id)
VALUES (md5('a')::uuid, md5('a-other')::uuid, md5('other-title')::uuid, 'receivable', 'Other unit', 'BRL', 10, 10, md5('other-source')::uuid, md5('other-source')::uuid),
    (md5('b')::uuid, md5('b-unit')::uuid, md5('b-title')::uuid, 'receivable', 'Other tenant', 'BRL', 10, 10, md5('b-source')::uuid, md5('b-source')::uuid);
