> commits: https://github.com/rchuluc/barte-vantara/commit/3d202f6 · https://github.com/rchuluc/barte-vantara/commit/084e0aa · https://github.com/rchuluc/barte-vantara/commit/3de0290 · https://github.com/rchuluc/barte-vantara/commit/e04ec4a · https://github.com/rchuluc/barte-vantara/commit/bf88e0e

# Minhas considerações

Criar o ambiente de infraestrutura, com agentes de código ou não, geralmente exige ajustes durante a implantação.

O prompt utilizado e a sessão com o agente estão em [session.md](./session.md). O objetivo era aplicar o bootstrap e a infraestrutura na conta WURA, configurar OIDC, Datadog e DNS, e publicar as aplicações pelos pipelines. Pedi a mudança da aplicação para `us-east-1` e certificado wildcard para os tenants; o state permaneceu em `us-east-2`.

# Erros e correções

1. O agente propôs condicionais para publicar imagens sem deploy. Pedi para manter o fluxo direto. Também foi necessário ajustar o OIDC ao formato imutável de identidade usado pelo GitHub.
2. A publicação no ECR falhou por falta de `ecr:BatchGetImage`, corrigida em `084e0aa`. Depois das imagens publicadas, foi possível concluir a infraestrutura e executar a migration inicial.
3. O Terraform apresentou diferenças nos defaults da AWS e na configuração de health check do service discovery, corrigidas para evitar alterações desnecessárias nos próximos applies.
4. O backend era considerado estável antes do rollout terminar, e o frontend falhava no health check porque o ECS sobrescrevia `HOSTNAME`. O agente ajustou a espera e fixou o bind do Next.js em `0.0.0.0`.
5. Questionei o sucesso informado pelo pipeline porque o frontend ainda não abria. Faltava o CNAME da aplicação, separado da validação do certificado; depois ainda houve atraso no DNS local.

# Conclusão

Os dois pipelines passaram, a migration foi aplicada e o health check HTTPS retornou 200 usando o IP resolvido. O DNS já respondia em resolvedores públicos, mas meu acesso local ainda não funcionava ao encerrar a sessão. O backend permaneceu privado, acessível pelo frontend dentro da VPC.
