# Plano de Implementação — Roleta BDR

> Baseado no protótipo já construído na branch
> `claude/hubspot-lead-webhook-distribution-91x2gw`. Este documento é o
> roteiro para levar esse protótipo a produção num ambiente de
> desenvolvimento próprio.

## 1. Contexto e objetivo

Distribuir automaticamente leads inbound do segmento **LARGE/ENTERPRISE**
entre BDRs organizados em 3 times (coordenados por Allen, Camila e
Welington), em **round-robin de 2 níveis** (coordenador → BDR), atualizando
o owner do negócio no HubSpot e avisando o time no Slack — só quando o lead
**ainda não tem dono**; se já tiver, respeita quem já está com ele.

**Origem real dos leads:** o app do HubSpot posta automaticamente no canal
Slack privado `#mkt-sales-leads` toda vez que um lead inbound entra. Não é
um webhook do HubSpot chamando a gente — é o inverso: nosso serviço lê esse
canal.

## 2. O que já existe (protótipo)

| Camada | Arquivo(s) | Status |
|---|---|---|
| Banco (SQLite, `node:sqlite` nativo) | `src/db/index.js`, `repository.js`, `seed.js` | ✅ Schema completo, testado |
| Roleta 2 níveis | `src/state/roundRobinStore.js` | ✅ Testado (cicla coordenador→BDR corretamente) |
| Parsing da mensagem do Slack | `src/services/leadMessageParser.js` | ✅ Validado contra mensagem real do canal |
| Ingestão (polling do canal) | `src/services/slackChannelIngestService.js` | ✅ Implementado; nunca rodou contra o Slack de verdade em produção |
| Integração HubSpot | `src/services/hubspotService.js` | ✅ Lógica validada com dados reais via MCP; **nunca testado com token real fora deste sandbox** (rede bloqueada aqui) |
| Integração Slack (postar mensagem) | `src/services/slackService.js` | ✅ Implementado; nunca enviou mensagem real (sempre rodou em DRY_RUN) |
| Webhook manual/teste | `src/routes/webhookRoutes.js`, `testRoutes.js` | ✅ Funcional |
| Dashboard | `public/dashboard.html`, `src/routes/dashboardRoutes.js` | ✅ Funcional, testado com dados reais (backfill histórico) |
| Snapshot estático do dashboard | `scripts/generate-static-dashboard.js` | ✅ Funcional (artefato sem servidor) |
| Backfill histórico | `scripts/backfill-real-leads.js` | ✅ Rodado uma vez com 31 leads reais |
| Verificação de conexão HubSpot | `scripts/check-hubspot-connection.js` | ✅ Criado; **precisa rodar no ambiente novo** pra validar de fato |

## 3. O que falta (gaps conhecidos)

1. **Dados oficiais de BDRs/coordenadores.** `data/bdrs-seed.json` está
   marcado como rascunho — a lista de quem está em qual time ainda não foi
   confirmada oficialmente.
2. **Canais do Slack por time não existem.** `slack_channel_id` de Allen,
   Camila e Welington estão `null`. Sem eles, a notificação de "lead
   distribuído" não tem pra onde ir.
3. **1-2 IDs pendentes de confirmação:**
   - `hubspot_owner_id` da BDR "Juliana Rodrigues da Silva" é uma
     estimativa (não 100% confirmada).
   - O coordenador "Welington" (Wellington Ferreira) não tem
     `hubspot_owner_id` cadastrado no HubSpot ainda.
4. **Hospedagem/ambiente de execução contínuo.** Todo o desenvolvimento
   rodou dentro de uma sessão temporária do Claude Code. Precisa de um
   lugar que fique no ar 24/7 (não precisa de URL pública — é polling, não
   webhook — mas precisa continuar rodando).
5. **Nunca testado com credenciais reais fora do sandbox de
   desenvolvimento.** A rede do ambiente onde isso foi construído bloqueia
   chamadas diretas para `api.hubapi.com`, então o teste real com
   `DRY_RUN=false` ainda não aconteceu.
6. **Bot do Slack precisa ser adicionado ao `#mkt-sales-leads`** (canal
   privado) — sem isso, `conversations.history` falha com `not_in_channel`.

## 4. Plano de implementação (fases)

### Fase 0 — Levar o código para o novo ambiente

- [ ] Clonar o repositório / branch `claude/hubspot-lead-webhook-distribution-91x2gw`
      (ou a branch que for virar a base definitiva).
- [ ] `npm install` (zero dependências nativas — usa `node:sqlite` do
      Node ≥ 22; confirme a versão do Node no novo ambiente).
- [ ] `cp .env.example .env`, manter `DRY_RUN=true` por enquanto.
- [ ] `npm run seed && npm start` — confirmar que sobe limpo e
      `GET /dashboard` funciona com os dados de rascunho.

**Critério de aceite:** dashboard local acessível, `/test/simulate-lead`
funcionando, sem erros no console.

### Fase 1 — Fechar os dados de times (bloqueador de negócio)

- [ ] Validar com Allen/Camila/Welington a lista definitiva de BDRs por
      time (hoje em `data/bdrs-seed.json`, ~26 pessoas).
- [ ] Confirmar o `hubspot_owner_id` da Juliana e conseguir um da Wellington
      Ferreira (coordenador), se ele também for dono de deals.
- [ ] Atualizar `data/bdrs-seed.json` com a versão final e rodar
      `npm run seed` (idempotente — não perde histórico).
- [ ] Remover o campo `_rascunho` do JSON quando a lista for oficial.

**Critério de aceite:** `data/bdrs-seed.json` sem nenhum `_obs` de
pendência e com `_rascunho: false` (ou removido).

### Fase 2 — Credenciais e escopos

**HubSpot:**
- [ ] Criar Private App (Configurações → Integrações → Private Apps) com
      escopos: `crm.objects.contacts.read`, `crm.objects.deals.read`,
      `crm.objects.deals.write`.
- [ ] Colar o token em `HUBSPOT_TOKEN` no `.env`.
- [ ] Rodar `npm run check:hubspot -- algum-email-real@empresa.com` —
      **primeiro teste real da integração**, feito fora do sandbox de
      desenvolvimento.

**Slack:**
- [ ] Criar/usar um Slack App com Bot Token, escopos `chat:write` +
      `channels:history`/`groups:history`.
- [ ] **Adicionar o bot ao canal `#mkt-sales-leads`** (Slack → canal →
      Integrações → Adicionar apps).
- [ ] Colar o token em `SLACK_BOT_TOKEN`.

**Critério de aceite:** `npm run check:hubspot` passa em verde; uma
chamada manual de teste ao `conversations.history` do canal (via script ou
curl) não retorna `not_in_channel`.

### Fase 3 — Canais de time no Slack

- [ ] Decidir nomenclatura dos 3 canais (sugestão: `#time-allen`,
      `#time-camila`, `#time-welington`).
- [ ] Criar os canais (manualmente ou via API do Slack).
- [ ] Preencher `slack_channel_id` de cada coordenador em
      `data/bdrs-seed.json` e rodar `npm run seed`.

**Critério de aceite:** os 3 coordenadores em `SELECT * FROM coordenadores`
têm `slack_channel_id` preenchido (não nulo).

### Fase 4 — Teste ponta a ponta controlado

- [ ] Com `DRY_RUN=false`, rodar `POST /test/simulate-lead` com um e-mail
      de teste real (ou de um deal descartável) e confirmar:
      - a mensagem chega no canal de time certo, mencionando o BDR e o
        coordenador corretos;
      - o `hubspot_owner_id` do deal de teste foi atualizado no HubSpot.
- [ ] Testar o caminho "deal já tem owner": usar um deal que já tenha
      owner e confirmar que a roleta **não avança** (índice de
      `round_robin_state` inalterado) e que o aviso vai pro dono certo.
- [ ] Testar o parsing de uma mensagem real do canal (rodar
      `pollNewLeads()` uma vez manualmente, com `SLACK_POLL_ENABLED=false`
      ainda, só pra ver o resultado sem repetir automaticamente).

**Critério de aceite:** os 3 cenários acima batem com o esperado, sem
nenhum erro em `errors: []` na resposta.

### Fase 5 — Hospedagem

- [ ] Decidir onde o processo Node vai rodar continuamente (opções:
      Railway/Render/Fly.io, uma VM própria, um container gerenciado).
      Não precisa de URL pública/HTTPS exposta (é polling, não webhook).
- [ ] Configurar variáveis de ambiente no host escolhido.
- [ ] Garantir persistência do arquivo `data/roleta.db` entre reinícios
      (volume persistente — se o host recriar o filesystem a cada deploy,
      o histórico e o estado da roleta se perdem).
- [ ] Configurar um processo supervisor (systemd, PM2, ou o próprio
      restart policy do provedor) pra reiniciar o serviço se ele cair.

**Critério de aceite:** o serviço sobrevive a um restart manual sem perder
o estado da roleta nem o histórico de leads.

### Fase 6 — Go-live

- [ ] Ligar `SLACK_POLL_ENABLED=true`.
- [ ] Acompanhar de perto (logs + dashboard) os primeiros leads reais
      processados automaticamente.
- [ ] Confirmar visualmente no HubSpot e no Slack que tudo bate.

**Critério de aceite:** pelo menos 3-5 leads reais processados
automaticamente sem intervenção manual, com owner e notificação corretos.

### Fase 7 — Observabilidade e iteração (pós-lançamento)

- [ ] Definir um jeito de ser avisado se o polling parar de funcionar
      silenciosamente (ex: alerta se não processar nenhum lead em X horas
      em horário comercial).
- [ ] Considerar mover logs de `console.log`/`console.error` para um
      serviço de logging se o volume justificar.
- [ ] Revisitar a lista de "owners desconhecidos" (pessoas que recebem
      leads mas não estão na tabela `bdrs`) periodicamente — pode indicar
      gente que devia entrar na roleta.
- [ ] Avaliar se o dashboard precisa de autenticação antes de ficar
      acessível pra mais gente (hoje não tem nenhuma).

## 5. Riscos e pontos de atenção

| Risco | Mitigação |
|---|---|
| Lista de BDRs mudar depois do go-live | `npm run seed` é idempotente — só editar o JSON e rodar de novo, sem perder histórico |
| Mensagem do HubSpot no Slack mudar de formato | `leadMessageParser.js` está isolado — se quebrar, só esse arquivo precisa de ajuste. Adicionar um teste com uma mensagem de exemplo real como regressão. |
| Rate limit do HubSpot/Slack | Ambos os serviços já centralizam as chamadas (`hubspotService`, `slackService`) — dá pra adicionar retry/backoff num lugar só se necessário |
| Polling perder mensagens (serviço ficar fora do ar por muito tempo) | `conversations.history` com `oldest` cobre o intervalo desde a última leitura, mas tem paginação (200 msgs/página) — se ficar off por dias, pode precisar rodar mais de uma vez pra alcançar o backlog |
| Dashboard sem autenticação | Hoje é aceitável (uso interno, sem hospedagem pública ainda) — revisitar antes de expor externamente |
| `owner_existente_id` sem BDR correspondente | Já tratado (loga sem notificar) — mas vale revisar esses casos periodicamente (Fase 7) |

## 6. Estrutura do projeto (referência rápida)

```
src/
  db/            # schema SQLite, seed, queries (repository.js)
  services/
    hubspotService.js         # resolve deal, checa/atualiza owner
    slackService.js            # posta aviso no canal do time
    leadMessageParser.js       # extrai dados da mensagem do #mkt-sales-leads
    slackChannelIngestService.js  # polling do canal + orquestra o processamento
    leadDistributionService.js    # roleta + decide se roda ou não (owner check)
  state/roundRobinStore.js     # persistência do índice da roleta (2 níveis)
  routes/                      # webhook manual, endpoints de teste, dashboard API
  server.js                    # boot, seed automático, liga o polling
public/dashboard.html          # front-end do dashboard (vanilla JS)
scripts/
  backfill-real-leads.js       # importação única de histórico real
  generate-static-dashboard.js # gera snapshot HTML autônomo
  check-hubspot-connection.js  # valida credenciais antes de ir pra produção
data/
  bdrs-seed.json                # config de coordenadores/BDRs (editar aqui)
  backfill-real-leads.json      # dados reais de leads (gitignored, sensível)
  roleta.db                     # banco SQLite (gitignored, gerado em runtime)
```

## 7. Definition of Done (visão geral)

O projeto está "pronto" quando:

- [ ] Times/BDRs oficiais carregados, sem placeholders.
- [ ] Credenciais reais configuradas e validadas (`check:hubspot` verde).
- [ ] Canais de Slack dos 3 times existem e estão preenchidos no seed.
- [ ] Teste ponta a ponta (Fase 4) passou nos 3 cenários.
- [ ] Serviço hospedado de forma persistente, sobrevivendo a restarts.
- [ ] `DRY_RUN=false` e `SLACK_POLL_ENABLED=true` em produção, processando
      leads reais sem intervenção manual.
- [ ] Dashboard acessível pro time acompanhar a distribuição.
