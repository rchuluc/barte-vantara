> commits: https://github.com/rchuluc/barte-vantara/commit/26c0831 · https://github.com/rchuluc/barte-vantara/commit/da4f9dd · https://github.com/rchuluc/barte-vantara/commit/0c287b5

# Minhas considerações

O prompt utilizado e a sessão com o agente estão em [session.md](./session.md).
O objetivo era criar o frontend white-label, login, perfil e gestão de usuários, seguindo UI → hooks → services. Durante a sessão incluí o provisionamento de tenants por GitHub Action.

# Erros e correções

1. Ajustei o botão de mostrar senha para um ícone dentro do input, sem o hover que deformava o campo.
2. Primeiro pedi configuração em JSON, depois decidi unificar desenvolvimento e produção no banco, com seed e script local de criação.
3. A Action exigia JSON manual. Pedi campos separados, exemplos e geração automática do tenant ID. Também corrigi o redirect para a Barte: configurado em produção, sem default no código.
4. Antes do teste de provisionamento, o agente identificou incompatibilidade com o subject imutável do GitHub OIDC e corrigiu o validador em um segundo commit.
5. O agente criou Vantara em `tenant.wura.io` e manteve rotas por path. Corrigi para `vantara.wura.io`, exclusivamente por subdomínio.

# Conclusão

O tenant foi criado pela Action, os ajustes foram publicados e o ambiente ficou saudável. A entrega do convite e meu primeiro login não foram confirmados nessa sessão.
