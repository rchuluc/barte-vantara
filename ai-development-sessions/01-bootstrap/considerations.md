> commit: https://github.com/rchuluc/barte-vantara/commit/bd2d254

# Minhas considerações

O prompt utilizado e a sessão com o agente estão em [session.md](./session.md).
O objetivo era gerar o bootstrap das duas aplicações backend (Kotlin/Spring Boot) e frontend (Next.js/React), além das Actions de CI/CD e o Terraform.

Meu racional é criar uma aplicação que possa ser reaproveitada pela Barte, para outros clientes dentro da Infraestrutura da Barte (multi-tenant). E o frontend ter a capacidade de ser customizado para cada cliente, com a mesma base de código (white-label).

O primeiro run do agente criou a base das aplicações e consegui validar os ambientes rodando localmente com Docker, e os testes passam o quality gate definido.

# Erros e coreções

1. A primeira run gerou código executável, porém pobre em formatação, praticamente nenhum arquivo tinha white lines, ou seja, parecia estar minificado, isso é muito ruim para revisão/leitura humana. Pedi pra ajustar a formatação. O frontend foi resolvido com Prettier. E as actions e código Terraform o agente ajustou a formatação e incluiu essa regra nos `AGENTS.md`. Os dockerfiles eu ajustei manualmente, separando os steps com uma linha em branco.
2. Questionei o porque o agente não criou um controller customizado para o healthcheck do backend, e ele incluiu via Spring Boot Actuator, que é o padrão do Spring Boot. E ele incluiu os checks do banco de dados como condição de readiness.
3. Os módulos criados do Terraform seguem um padrão ruim, ele criou na primeira run apenas `main.tf`, pedi para que separasse cada módulo em: `main.tf`, `variables.tf` e `outputs.tf`.
4. O agente criou uma unica task definition para o ECS backend/frontend, o que não faz sentido. Foi pedido para alterar a fim de não criarmos condicionais dentro do mesmo arquivo, e sim criar uma task definition para cada aplicação.

# Conclusão

Decidi fechar essa run, e atuar na próxima run com ajustes nos pipelines do GitHub actions, o restante parece suficiente para um bootstrap.
