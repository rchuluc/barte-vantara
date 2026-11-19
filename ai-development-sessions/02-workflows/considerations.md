> commit: https://github.com/rchuluc/barte-vantara/commit/3d202f6

# Minhas considerações

O prompt utilizado e a sessão com o agente estão em [session.md](./session.md).
A [primeira sessão](../01-bootstrap/considerations.md) criou os pipelines, mas a separação de responsabilidades precisava melhorar. Pedi CI/CD por aplicação, filtros por paths e composite actions apenas para etapas realmente compartilhadas.

As etapas comuns ficaram em `.github/actions/`. O deploy passou a usar AWS CLI no lugar dos scripts Python, preservando migration antes do rollout e verificação de saúde.

O CI de infraestrutura foi preparado para fazer plan e comentar o resultado no PR, sem apply automático.

Também pedi um Terraform de bootstrap separado para criar o bucket S3 do estado remoto, com versionamento e proteções de acesso.

# Erros e correções

1. A base ainda não tinha estado remoto nem role específica para o plan. O agente adicionou a configuração e documentou os pré-requisitos.
2. A IA colocou verificações específicas de frontend/backend em uma action com condicionais por aplicação. Pedi para remover essa action e levar essas etapas para os respectivos workflows.

# Conclusão

Os 18 testes de workflows e seis testes Terraform passaram. Nenhum recurso AWS foi criado nessa sessão; o apply e os ajustes do primeiro deploy ficaram na [sessão 03](../03-infrastructure-apply/considerations.md), quando esse trabalho também foi commitado. Uma das premissas que sigo é deploy desde o início.
