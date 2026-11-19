> commit: https://github.com/rchuluc/barte-vantara/commit/9af57de

# Minhas considerações

O prompt utilizado e a sessão com o agente estão em [session.md](./session.md).
O objetivo era permitir consultas e propostas de conciliação por agentes, deixando a aprovação exclusivamente na interface, por outro usuário autorizado.

# Erros e correções

1. O endpoint marcava todas as propostas como humanas e não contemplava contas a pagar. O agente adicionou atribuição de IA e suporte às duas direções financeiras.
2. Após o deploy, minha conta não tinha os escopos necessários. A interface bloqueava autoedição e só havia meu usuário. Pedi ajuste direto no banco, já que Cognito não é a fonte das permissões.

# Conclusão

Os 80 testes backend e 316 frontend passaram, incluindo bloqueio de aprovação por IA e preservação dos saldos enquanto pendente. O deploy foi concluído e os novos acessos foram verificados pelo MCP. Não havia conta bancária no tenant, então a conciliação completa em produção continuou pendente.
