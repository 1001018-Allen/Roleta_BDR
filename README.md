# Roleta BDR — Webhook de Distribuição de Leads (HubSpot → Slack)

Serviço em Node.js/Express que recebe leads inbound do HubSpot via webhook,
distribui entre 3 times (Time A, Time B, Time C) em **round-robin**, atualiza
o owner do negócio (deal) no HubSpot e avisa o time no Slack, mencionando o
BDR responsável e o gerente do time.

## Como funciona (fluxo)

```
HubSpot (form inbound) --workflow/webhook--> POST /webhook/hubspot-lead
                                                     │
                                                     ▼
                                    1. Valida payload (name, company, email, form)
                                                     │
                                                     ▼
                              2. Sorteia o próximo time (round-robin persistido
                                 em data/round-robin-state.json: A → B → C → A → ...)
                                                     │
                                     ┌───────────────┴───────────────┐
                                     ▼                                ▼
                    3a. Resolve o dealId e atualiza      3b. Envia mensagem no canal
                        hubspot_owner_id no HubSpot           do Slack do time,
                        (PATCH /crm/v3/objects/deals/{id})     mencionando @BDR e @gerente
```

Os passos 3a e 3b são independentes: se um falhar (ex: token do Slack
inválido), o outro ainda é tentado, e a resposta HTTP inclui um relatório de
erros por etapa (`errors: [{ step, message }]`) em vez de perder o lead
inteiro por causa de uma falha pontual.

### Como o `dealId` é resolvido

O HubSpot já cria o negócio (deal) automaticamente para o lead inbound. O
serviço tenta, nessa ordem:

1. Usar `dealId` se ele já vier no payload do webhook (recomendado —
   configure o workflow do HubSpot para incluir o ID do negócio recém-criado).
2. Caso não venha, busca o contato pelo `email` e pega o deal mais recente
   associado a ele.

Isso está implementado em `src/services/hubspotService.js` (`resolveDealId`).

### Round-robin

O índice do último time sorteado fica em `data/round-robin-state.json`
(`{ "lastIndex": N }`). A cada lead, calcula-se `(lastIndex + 1) % 3` e
persiste-se o novo valor — por isso a distribuição sobrevive a reinícios do
servidor. Lógica em `src/state/roundRobinStore.js`.

## Configuração dos times

Edite `src/config/teams.js` e preencha os campos `TODO_...` de cada time:

- `hubspotOwnerId`: ID do owner no HubSpot que será colocado no deal.
- `slackChannelId`: ID do canal do Slack do time (não o nome `#time-a`).
- `bdr.name` / `bdr.slackUserId`: BDR responsável, mencionado na mensagem.
- `manager.name` / `manager.slackUserId`: gerente do time, também mencionado.

Enquanto algum time ainda tiver placeholders, o serviço recusa processar
leads reais para esse time e retorna um erro claro explicando o que falta
preencher.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```
PORT=3000
HUBSPOT_TOKEN=...      # Private App token do HubSpot
SLACK_BOT_TOKEN=xoxb-...
DRY_RUN=true           # true = não chama HubSpot/Slack de verdade, só loga
```

`DRY_RUN=true` é o jeito recomendado de **entender e validar a lógica**
antes de ter os tokens e os dados reais dos times: o round-robin funciona
normalmente e os serviços de HubSpot/Slack apenas logam no console o que
fariam, em vez de chamar as APIs.

## Rodando

```bash
npm install
cp .env.example .env
npm start
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

- `GET /test/health` — health-check simples.
- `GET /test/next-team` — mostra qual seria o próximo time sorteado, **sem**
  avançar o round-robin (só consulta).
- `POST /test/simulate-lead` — roda o fluxo completo (round-robin + HubSpot +
  Slack) com um lead de exemplo; aceita overrides no body. Combine com
  `DRY_RUN=true` para testar sem tokens/IDs reais configurados.

## Tratamento de erros

- Payload inválido no webhook → `400` com a lista de campos faltando.
- Falha ao resolver/atualizar o deal no HubSpot ou ao enviar a mensagem no
  Slack → não derruba a requisição inteira; a etapa que falhou aparece em
  `errors` na resposta (status `207` quando há falha parcial).
- Erros não previstos caem no middleware central (`src/server.js`) e voltam
  como JSON `{ ok: false, message }`, sem derrubar o processo.
