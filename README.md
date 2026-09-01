# Roleta BDR — Webhook de Distribuição de Leads (HubSpot → Slack)

Serviço em Node.js/Express que recebe leads inbound do HubSpot via webhook,
distribui entre os coordenadores/BDRs cadastrados em **round-robin de 2
níveis**, atualiza o owner do negócio (deal) no HubSpot, avisa o time no
Slack (mencionando o BDR e o coordenador) e guarda tudo em um banco SQLite
que alimenta um **dashboard de visualização**.

> ⚠️ **Status atual: rascunho / desenho.** A lista de coordenadores e BDRs em
> `data/bdrs-seed.json` foi passada pelo usuário em 01/09/2026 como
> **não-oficial**, só para prototiparmos a lógica e o dashboard. Os
> `slack_user_id`/`hubspot_owner_id` de quase todo mundo já foram resolvidos
> (buscando por nome no Slack/HubSpot da VOLL), mas faltam os
> `slack_channel_id` dos 3 times (canais ainda não existem) e há 1-2 pontas
> soltas — veja "Pendências conhecidas" abaixo. Continua tudo em
> `DRY_RUN=true` até isso fechar.

## Como funciona (fluxo)

```
HubSpot (form inbound) --workflow/webhook--> POST /webhook/hubspot-lead
                                                     │
                                                     ▼
                                    1. Valida payload (name, company, email, form)
                                                     │
                                                     ▼
                       2. Roleta em 2 níveis (persistida no SQLite):
                          a) sorteia o próximo COORDENADOR (Allen → Camila → Welington → Allen...)
                          b) dentro do time daquele coordenador, sorteia o próximo BDR
                                                     │
                                     ┌───────────────┴───────────────┐
                                     ▼                                ▼
                    3a. Resolve o dealId e atualiza      3b. Envia mensagem no canal
                        hubspot_owner_id no HubSpot           do Slack do time,
                        (owner = o BDR sorteado)              mencionando @BDR e @coordenador
                                     │                                │
                                     └───────────────┬────────────────┘
                                                      ▼
                                  4. Grava o lead no SQLite (data/roleta.db)
                                     → alimenta o dashboard em /dashboard
```

Os passos 3a e 3b são independentes: se um falhar (ex: token do Slack
inválido), o outro ainda é tentado, e a resposta HTTP inclui um relatório de
erros por etapa (`errors: [{ step, message }]`) em vez de perder o lead
inteiro por causa de uma falha pontual. O lead é salvo no banco de qualquer
forma, junto com o que deu certo/errado.

### Como o `dealId` é resolvido

O HubSpot já cria o negócio (deal) automaticamente para o lead inbound. O
serviço tenta, nessa ordem:

1. Usar `dealId` se ele já vier no payload do webhook (recomendado —
   configure o workflow do HubSpot para incluir o ID do negócio recém-criado).
2. Caso não venha, busca o contato pelo `email` e pega o deal mais recente
   associado a ele.

Isso está implementado em `src/services/hubspotService.js` (`resolveDealId`).

### Roleta em 2 níveis

- **Nível 1 — coordenador:** cicla pela tabela `coordenadores` na ordem do
  seed (Allen → Camila → Welington → Allen → ...).
- **Nível 2 — BDR:** dentro do time do coordenador sorteado, cicla pelos
  BDRs daquele coordenador (na ordem do seed).

Os dois índices ficam na tabela `round_robin_state` do SQLite (uma linha
para o coordenador, uma linha por coordenador para o BDR), por isso a
distribuição sobrevive a reinícios do servidor. Lógica em
`src/state/roundRobinStore.js` e `src/services/leadDistributionService.js`.

## Banco de dados (SQLite)

Usa o módulo `node:sqlite` nativo do Node 22 (sem dependências extras / sem
compilação nativa). Arquivo em `data/roleta.db` (gerado em runtime, não
versionado).

Tabelas:

- `coordenadores` (nome, slack_user_id, slack_channel_id, ordem)
- `bdrs` (nome, coordenador_id, slack_user_id, hubspot_owner_id, ordem)
- `round_robin_state` (posição atual da roleta, por nível)
- `leads` (histórico: nome, empresa, email, form, deal_id, coordenador/BDR
  sorteados, se HubSpot/Slack deram certo, se foi dry-run, erros)

### Seed / configuração de coordenadores e BDRs

Edite `data/bdrs-seed.json` (marcado como rascunho — substitua quando a
lista for oficial) e rode:

```bash
npm run seed
```

É idempotente: pode rodar de novo quantas vezes quiser, sem duplicar nem
apagar o histórico de leads já distribuídos. Na primeira execução do
servidor (`npm start`), se o banco estiver vazio, o seed roda sozinho.

`slack_user_id` e `hubspot_owner_id` de cada BDR/coordenador já vêm
resolvidos no JSON — a maioria foi encontrada automaticamente buscando por
nome nos conectores do Slack e do HubSpot (workspace `@govoll.com`) e
confirmada manualmente pelo usuário nos casos ambíguos (nomes repetidos).

**Pendências conhecidas** (ver comentários `_obs` no próprio JSON):
- `Juliana Rodrigues da Silva`: Slack confirmado, mas o `hubspot_owner_id`
  é uma estimativa (mesma faixa numérica dos demais BDRs) — vale confirmar
  no HubSpot antes de ir pra produção.
- Coordenador `Welington` (na real, "Wellington Ferreira" no Slack): não
  tem `hubspot_owner_id` porque não existe nenhum owner com esse nome
  cadastrado no HubSpot ainda — só faz sentido se ele também for dono de
  deals diretamente.
- `slack_channel_id` de todos os 3 coordenadores está `null`: os canais de
  time ainda não existem no Slack. Enquanto isso, o serviço usa um canal
  "placeholder" (`#TODO-canal-<coordenador>`) só pra deixar claro nos logs
  em `DRY_RUN` — **isso vai falhar de verdade fora do DRY_RUN** até um
  canal real ser criado e o ID preenchido aqui.

## Dashboard de visualização

`GET /dashboard` — página com:

- Próximo coordenador/BDR sorteado (sem consumir a roleta)
- Total de leads distribuídos
- Gráfico de leads por coordenador
- Gráfico de leads por BDR (colorido por coordenador)
- Tabela com o histórico completo de leads (status HubSpot/Slack, dry-run)

Atualiza sozinho a cada 5s. Os dados vêm de `/dashboard/api/state`,
`/dashboard/api/stats` e `/dashboard/api/leads`.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```
PORT=3000
HUBSPOT_TOKEN=...      # Private App token do HubSpot
SLACK_BOT_TOKEN=xoxb-...
DRY_RUN=true           # true = não chama HubSpot/Slack de verdade, só loga
```

`DRY_RUN=true` é o jeito recomendado de **entender e validar a lógica**
antes de ter os tokens e os dados reais dos times: a roleta funciona
normalmente e os serviços de HubSpot/Slack apenas logam no console o que
fariam, em vez de chamar as APIs. O dashboard funciona igual nos dois modos.

## Rodando

```bash
npm install
cp .env.example .env
npm start
# abra http://localhost:3000/dashboard
```

## Endpoints

- `POST /webhook/hubspot-lead` — endpoint principal, chamado pelo HubSpot.
  Body esperado:
  ```json
  {
    "name": "Nome do Lead",
    "company": "Empresa",
    "email": "lead@empresa.com",
    "form": "Nome do formulário",
    "dealId": "123456789"
  }
  ```
  (`dealId` é opcional — veja "Como o dealId é resolvido" acima.)

- `GET /dashboard` — dashboard visual (veja acima).
- `GET /test/health` — health-check simples.
- `GET /test/next-team` — mostra qual seria o próximo coordenador+BDR
  sorteado, **sem** avançar a roleta (só consulta).
- `POST /test/simulate-lead` — roda o fluxo completo (roleta + HubSpot +
  Slack + gravação no banco) com um lead de exemplo; aceita overrides no
  body. Combine com `DRY_RUN=true` para testar sem tokens/IDs reais.

## Tratamento de erros

- Payload inválido no webhook → `400` com a lista de campos faltando.
- Falha ao resolver/atualizar o deal no HubSpot ou ao enviar a mensagem no
  Slack → não derruba a requisição inteira; a etapa que falhou aparece em
  `errors` na resposta (status `207` quando há falha parcial) e fica
  registrada no banco (`leads.erros`).
- Erros não previstos caem no middleware central (`src/server.js`) e voltam
  como JSON `{ ok: false, message }`, sem derrubar o processo.
