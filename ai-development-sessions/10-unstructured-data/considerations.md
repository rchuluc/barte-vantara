> commit: https://github.com/rchuluc/barte-vantara/commit/4d123e6

# Minhas considerações

O prompt utilizado e a sessão com o agente estão em [session.md](./session.md).
O objetivo era iniciar a extração de dados não estruturados com AI SDK e OpenRouter no Next.js, preservando fonte, resposta e versão do prompt. Usei os e-mails e WhatsApp do case como benchmark.

# Erros e correções

1. O modelo retornou `NF 88231` em vez do identificador `88231`. O prompt foi ajustado.
2. O valor original da nota foi classificado como apenas mencionado. O agente refinou a distinção entre valor da obrigação e valores citados em conversas.
3. Uma citação substituiu uma quebra de linha por espaço e foi rejeitada pela validação da fonte. O prompt passou a pedir trechos curtos e literais, sem relaxar a validação.

# Conclusão

Os quatro casos passaram com o prompt v4, sem precisar de classificador separado, e os 230 testes frontend passaram. Aprovei o push para testar depois da integração visual. A auditoria persistente no backend ainda ficou pendente.
