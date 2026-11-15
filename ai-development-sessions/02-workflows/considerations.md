# Minhas considerações

A [primeira sessão](../01-bootstrap/considerations.md) de bootstrap criou as actions do GitHub Actions, mas não seguiram boas práticas. Nessa sessão endereço os problemas e peço para o agente resolver. O maior problema é o uso de condicionais dentro do mesmo workflow, seria melhor criar workflows separados para cada aplicação, ativados condicionalmente, e steps compartilhados como `workflow_call`.

Nesse step, migramos as actions para usar composite actions reutilizáveis em /actions, e cada workflow reaproveita isso.

O CI de infraestrutura faz um plan e adiciona um comentário do que vai ser aplicado, mas não faz o apply. O apply é feito manualmente.

Outro ponto, é um Terraform específico de bootstrap, que cria o bucket S3 para o backend remoto, e o state do Terraform é versionado e bloqueado. O agente não considerou isso na primeira run.

# Erros e coreções

1. O primeiro run não considerou um estado remoto do Terraform, que foi ajustado na primeira etapa dessa segunda run.
2. A IA falhou no conceito de reaproveitamento, funções específicas do frontend/backend foram criadas dentro de uma mesma action com condições. O que não faz sentido com o que foi pedido. Pedi para refatorar para remover condicionais e mover para dentro do CI de cada projeto.

# Conclusão

O agente criou os arquivos de infraestrutura que apliquei na minha conta da AWS, uma das premissas que sigo é deploy desde o início.
