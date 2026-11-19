# Meu processo

Como um dos requisitos do case é registrar meu uso de agentes de IA no desenvolvimento, documentei cada sessão em uma pasta. O objetivo é permitir que o avaliador acompanhe as decisões, minhas correções e a evolução da aplicação.

Cada pasta contém o `session.md`, com a conversa original, e o `considerations.md`, com objetivo, erros, correções e conclusão. A sessão é a fonte de verdade; meus pedidos, testes e ajustes do agente são as evidências.

Os commits relacionados estão no cabeçalho das considerações. Não há relação de um para um: uma sessão pode gerar vários commits, e um trabalho pode ser commitado em uma sessão posterior. As conclusões registram o que foi validado e o que ficou pendente naquele momento.

# O que estou usando

- Harness: OpenCode.
- Modelos: GPT-6 Astra, GPT-5.6 Sol ou GPT-6 Sol.
- MCPs: Context7 para documentação, Browse para validações no navegador e Vantara para testar as ferramentas da aplicação.

# Sumário

| Sessão | Objetivo | Registro |
| --- | --- | --- |
| 01 — Bootstrap | Base das aplicações, Docker, CI/CD e Terraform. | [Considerações](./01-bootstrap/considerations.md) · [Sessão](./01-bootstrap/session.md) |
| 02 — Workflows | Separação dos pipelines, actions reutilizáveis e estado remoto. | [Considerações](./02-workflows/considerations.md) · [Sessão](./02-workflows/session.md) |
| 03 — Infraestrutura | Apply na AWS, OIDC, DNS e primeiro deploy. | [Considerações](./03-infrastructure-apply/considerations.md) · [Sessão](./03-infrastructure-apply/session.md) |
| 04 — Banco de dados | Modelo financeiro, RLS e contratos de persistência. | [Considerações](./04-database-foundations/considerations.md) · [Sessão](./04-database-foundations/session.md) |
| 05 — Usuários | Cognito, autenticação e gestão de acessos. | [Considerações](./05-user-management/considerations.md) · [Sessão](./05-user-management/session.md) |
| 06 — Frontend | White-label, login e provisionamento de tenants. | [Considerações](./06-frontend-foundations/considerations.md) · [Sessão](./06-frontend-foundations/session.md) |
| 07 — Ingestão backend | CSV/XLSX, mapeamento, processamento e auditoria. | [Considerações](./07-data-ingestion/considerations.md) · [Sessão](./07-data-ingestion/session.md) |
| 08 — Ingestão frontend | Preview, confirmação e acompanhamento da importação. | [Considerações](./08-data-ingestion-frontend-integration/considerations.md) · [Sessão](./08-data-ingestion-frontend-integration/session.md) |
| 09 — Conciliação | Bancada de recebíveis, alocações e revisão independente. | [Considerações](./09-reconciliation/considerations.md) · [Sessão](./09-reconciliation/session.md) |
| 10 — Dados não estruturados | Extração com AI SDK/OpenRouter e benchmark do case. | [Considerações](./10-unstructured-data/considerations.md) · [Sessão](./10-unstructured-data/session.md) |
| 11 — Assistente de importação | Chat integrado à página de importações. | [Considerações](./11-ai-import-assistant/considerations.md) · [Sessão](./11-ai-import-assistant/session.md) |
| 12 — Ferramentas do assistente | Importação pelo chat após confirmação humana. | [Considerações](./12-ai-tooling/considerations.md) · [Sessão](./12-ai-tooling/session.md) |
| 13 — MCP | Importação externa com OIDC e permissões por usuário. | [Considerações](./13-mcp/considerations.md) · [Sessão](./13-mcp/session.md) |
| 14 — Consultas e propostas MCP | Buscas financeiras e conciliação pendente de aprovação pela UI. | [Considerações](./14-mcp-read-tools/considerations.md) · [Sessão](./14-mcp-read-tools/session.md) |
| 15 — Ajustes de importação | Contas compartilhadas, múltiplas BUs e validação ponta a ponta. | [Considerações](./15-import-fixes/considerations.md) · [Sessão](./15-import-fixes/session.md) |
| 16 — Internacionalização | PT-BR, inglês e espanhol em todos os fluxos. | [Considerações](./16-i18n/considerations.md) · [Sessão](./16-i18n/session.md) |
