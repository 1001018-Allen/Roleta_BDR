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

A origem real dos leads **não é um webhook do HubSpot** — é o app oficial do
HubSpot que já posta automaticamente no canal do Slack `#mkt-sales-leads`
("Canal de notificações do Hubspot para geração de leads e deals") toda vez
que um lead inbound novo entra. Cada mensagem tem esse formato:

```
LARGE/ENTERPRISE — Chegou um novo lead inbound! 🚀

*First Name*: Najla
*Company Name*:
*Email*: najla@empresa.com
*Quantos colaboradores sua empresa tem?*: 1.001 - 5.000
*GMV mensal*: De R$ 100 mil a R$ 399 mil por mês
*Original Source*:
*Origem da conversão*: Leadster
```

O canal recebe leads de vários segmentos (`MID MARKET`, `KEY ACCOUNT`,
`LARGE/ENTERPRISE`) — **só nos interessa o `LARGE/ENTERPRISE`**, os outros
são ignorados.

```
#mkt-sales-leads (Slack)
  → app do HubSpot posta "LARGE/ENTERPRISE — Chegou um novo lead inbound!"
                                                     │
                                                     ▼
        1. Nosso serviço lê o canal periodicamente (polling) e faz o
           parsing do texto do "attachment" (nome, empresa, e-mail, ...)
                                                     │
                                                     ▼
        2. Resolve o deal no HubSpot (pelo e-mail) e CHECA SE JÁ TEM OWNER
                                                     │
                        ┌────────────────────────────┴────────────────────────────┐
                        ▼ já tem owner                                            ▼ sem owner
        3a. NÃO roda a roleta (não consome a vez de           3b. Roleta em 2 níveis (persistida no SQLite):
            ninguém). Se o owner já é um BDR conhecido,           a) sorteia o próximo COORDENADOR
            manda o aviso pra ele mesmo, sem tocar no                (Allen → Camila → Welington → Allen...)
            HubSpot (o dado já estava certo).                     b) dentro do time, sorteia o próximo BDR
                                                                    → atualiza hubspot_owner_id no HubSpot
                        └────────────────────────────┬────────────────────────────┘
                                                      ▼
                4. Avisa o time no Slack (canal do coordenador), mencionando @BDR e @coordenador
                                                      ▼
                5. Grava o lead no SQLite (data/roleta.db) → alimenta o dashboard em /dashboard
```

Falhas em HubSpot e Slack são independentes: se uma etapa falhar, a outra
ainda é tentada, e o resultado inclui um relatório de erros por etapa
(`errors: [{ step, message }]`) em vez de perder o lead inteiro por causa de
uma falha pontual. O lead é salvo no banco de qualquer forma.

> O endpoint `POST /webhook/hubspot-lead` continua existindo (útil pra
> testar manualmente ou se um dia vocês configurarem um workflow real do
> HubSpot chamando ele), mas **em produção a entrada esperada é o polling do
> Slack**, não esse webhook.

### Como o `dealId` é resolvido

O HubSpot já cria o negócio (deal) automaticamente para o lead inbound. O
serviço tenta, nessa ordem:

1. Usar `dealId` se ele já vier explícito (só acontece hoje via
   `/webhook/hubspot-lead` manual/teste).
2. Buscar o contato pelo `email` (extraído da mensagem do Slack) e pegar o
   deal mais recente associado a ele — é o caminho normal em produção.

Isso está implementado em `src/services/hubspotService.js` (`resolveDealId`).

### Checagem de "esse lead já tem dono?"

Antes de rodar a roleta, o serviço consulta o `hubspot_owner_id` atual do
deal (`hubspotService.getDealOwnerId`):

- **Já tem owner:** a roleta **não é acionada** (nenhum índice avança —
  nem o do coordenador, nem o do BDR). Se esse owner bate com um dos nossos
  BDRs cadastrados, ainda mandamos o aviso no Slack pra ele (pra manter
  visibilidade), só que sem reescrever nada no HubSpot. Se o owner for
  alguém fora da nossa lista, só registramos no banco (`ja_atribuido=1`,
  `owner_existente_id`) sem notificar (não sabemos em qual canal avisar).
- **Sem owner:** segue o fluxo normal — roda a roleta, atualiza o
  `hubspot_owner_id` e notifica.

Lógica em `src/services/leadDistributionService.js` (`distributeLead`).

### Ingestão automática do canal do Slack

`src/services/slackChannelIngestService.js` varre `#mkt-sales-leads`
periodicamente via `conversations.history` da Slack Web API, filtra só as
mensagens `LARGE/ENTERPRISE — Chegou um novo lead inbound!`, faz o parsing
(`src/services/leadMessageParser.js`) e chama `distributeLead` pra cada lead
novo. O timestamp da última mensagem processada fica salvo na tabela
`ingest_state` (não reprocessa a mesma mensagem duas vezes).

Ligado via `SLACK_POLL_ENABLED=true` no `.env` (default: desligado). Ver
"Variáveis de ambiente" abaixo — **inclui um requisito operacional
importante: o bot do Slack precisa ser adicionado ao canal**, que é privado.

### Roleta em 2 níveis

- **Nível 1 — coordenador:** cicla pela tabela `coordenadores` na ordem do
  seed (Allen → Camila → Welington → Allen → ...).
- **Nível 2 — BDR:** dentro do time do coordenador sorteado, cicla pelos
  BDRs daquele coordenador (na ordem do seed).

Os dois índices ficam na tabela `round_robin_state` do SQLite (uma linha
para o coordenador, uma linha por coordenador para o BDR), por isso a
distribuição sobrevive a reinícios do servidor. Lógica em
`src/state/roundRobinStore.js` e `src/services/leadDistributionService.js`.

## Carteira BDR (`/carteira`)

Página estilo CRM (visual parecido com HubSpot, mas 100% editável e local)
pra acompanhar a carteira de cada BDR dia a dia: quadro Kanban por etapa,
timeline de interações por negócio, forecast manual e uma pontuação
(lead score) provisória para negócios em Qualificação.

Acesse em `http://localhost:3000/carteira` com o servidor rodando
(`npm start` ou `npm run dev`).

### Como os dados chegam lá

Não há sync automático com o HubSpot ainda (precisa de uma API key/Private
App Token que exige permissão de admin na conta HubSpot — ver
"Pendências conhecidas"). Por enquanto, a atualização é manual:

1. No HubSpot, vá em **Negócios**, monte uma visualização com as colunas:
   Nome do negócio, Proprietário do negócio, Pipeline, Etapa do negócio,
   Valor, Data de criação, Data que entrou na fase atual, Data da última
   atividade, Nome/hora da próxima reunião.
2. **Exportar** essa visualização como CSV.
3. Abrir o arquivo, copiar todo o conteúdo.
4. Na página `/carteira`, clicar em **"Importar CSV do HubSpot"**, colar e
   confirmar.

O import faz **upsert** por `ID do negócio` (não duplica ao reimportar) e o
proprietário é casado com os BDRs de `data/bdrs-seed.json` pelo nome. Campos
editados na própria página (forecast, pontuação, timeline de notas)
**nunca são sobrescritos** por uma reimportação — ficam em colunas
separadas das que vêm do HubSpot (prefixo `hs_`). Rode a importação todo
dia (ou sempre que quiser atualizar) pra manter a carteira em dia.

### Timeline de interações

Cada negócio tem um histórico cronológico de anotações (tipo: geral,
WhatsApp, ligação, reunião, e-mail) — nada é sobrescrito, só acumula.

### Forecast manual

Por negócio: data prevista de fechamento, valor estimado e % de confiança,
editáveis livremente na aba "Forecast" do painel lateral.

### Pontuação de leads (lead score)

Aparece só para negócios na etapa **Qualificação**. Fórmula e pesos ficam
em `data/lead-score-config.json` (mensagens de WhatsApp, ligações, reuniões
realizadas, bônus manual, e uma penalidade por dias parado na etapa) —
**hoje são valores provisórios**, ajustar esse arquivo assim que o playbook
oficial de qualificação do time for definido (não precisa mexer em código,
só editar os números e reiniciar o servidor).

## Banco de dados (SQLite)

Usa o módulo `node:sqlite` nativo do Node 22 (sem dependências extras / sem
compilação nativa). Arquivo em `data/roleta.db` (gerado em runtime, não
versionado).

Tabelas:

- `coordenadores` (nome, slack_user_id, slack_channel_id, ordem)
- `bdrs` (nome, coordenador_id, slack_user_id, hubspot_owner_id, ordem)
- `round_robin_state` (posição atual da roleta, por nível)
- `leads` (histórico: nome, empresa, email, form, deal_id, coordenador/BDR
  sorteados, se HubSpot/Slack deram certo, se foi dry-run, erros, origem,
  se já estava atribuído antes de chegar aqui)
- `ingest_state` (timestamp da última mensagem processada no polling do Slack)
- `deals` (carteira de negócios por BDR — ver seção "Carteira BDR" abaixo)
- `deal_notes` (timeline de interações por negócio)

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
- **Hospedagem/produção ainda não decidida.** Todo o desenvolvimento até
  agora rodou só localmente/nesta sessão. Pra ligar o `SLACK_POLL_ENABLED`
  de verdade e receber leads reais, o serviço precisa rodar em algum lugar
  de forma contínua (não precisa de URL pública, já que agora é polling e
  não webhook — mas precisa continuar rodando 24/7).

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

SLACK_POLL_ENABLED=false        # true = liga o polling do #mkt-sales-leads
SLACK_POLL_INTERVAL_MS=30000
SLACK_LEADS_CHANNEL_ID=C04365S730B   # #mkt-sales-leads
SLACK_LEAD_SEGMENT=LARGE/ENTERPRISE  # ignora MID MARKET / KEY ACCOUNT
```

`DRY_RUN=true` é o jeito recomendado de **entender e validar a lógica**
antes de ter os tokens e os dados reais dos times: a roleta funciona
normalmente e os serviços de HubSpot/Slack apenas logam no console o que
fariam, em vez de chamar as APIs. O dashboard funciona igual nos dois modos.

⚠️ **`SLACK_BOT_TOKEN` precisa ter permissão de leitura no
`#mkt-sales-leads` e o bot precisa estar ADICIONADO a esse canal** (ele é
privado) — sem isso o polling falha com `not_in_channel`. Isso é
independente do `DRY_RUN`: mesmo em modo dry-run, o polling precisa
conseguir *ler* o canal pra ter o que simular (só as escritas em
HubSpot/Slack são simuladas).

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
