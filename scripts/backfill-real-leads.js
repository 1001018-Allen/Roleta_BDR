/**
 * Backfill ÚNICO de leads REAIS do canal #mkt-sales-leads (só LARGE/ENTERPRISE),
 * coletados lendo o Slack + cruzando com o HubSpot (só leitura). Os dados em
 * si ficam em data/backfill-real-leads.json (NÃO versionado — tem e-mails
 * reais de prospects), este arquivo só tem a lógica de importação.
 *
 * Isso é histórico: NÃO passa pela roleta (não faz sentido "sortear" um BDR
 * pra um lead que já aconteceu há semanas) — só registra o estado real
 * encontrado no HubSpot pra alimentar o dashboard com dados de verdade.
 *
 * Rode com: node --disable-warning=ExperimentalWarning scripts/backfill-real-leads.js
 * Idempotente: se já existir algum lead com origem 'slack-mkt-sales-leads-backfill'
 * no banco, o script não faz nada (evita duplicar rodando de novo).
 */
const fs = require("fs");
const path = require("path");
const repo = require("../src/db/repository");
const { db } = require("../src/db");

const ORIGEM = "slack-mkt-sales-leads-backfill";
const DATA_FILE = path.join(__dirname, "..", "data", "backfill-real-leads.json");

function jaExisteBackfill() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE origem = ?").get(ORIGEM);
  return row.n > 0;
}

function run() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log(
      `[backfill] ${DATA_FILE} não existe — nada a importar (esse arquivo tem dados reais ` +
        "e não é versionado no git; se você tem um, coloque-o aí antes de rodar)."
    );
    return;
  }

  if (jaExisteBackfill()) {
    console.log(`[backfill] já existem leads com origem "${ORIGEM}" — não vou duplicar. Nada a fazer.`);
    return;
  }

  const { leads, ownersDesconhecidos = {} } = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

  let inseridos = 0;
  for (const [ts, nome, empresa, email, ownerId, form] of leads) {
    const criadoEm = new Date(parseFloat(ts) * 1000).toISOString();
    const bdr = ownerId ? repo.getBdrByHubspotOwnerId(ownerId) : null;
    const coordenador = bdr ? repo.getCoordenadorById(bdr.coordenador_id) : null;

    repo.saveLead({
      nome,
      empresa: empresa || "(empresa não informada)",
      email,
      form: form || "LARGE/ENTERPRISE",
      dealId: null, // não coletamos o ID do deal no backfill, só o owner
      coordenadorId: coordenador ? coordenador.id : null,
      bdrId: bdr ? bdr.id : null,
      hubspotOk: true, // é leitura do estado real, não uma escrita nossa
      slackOk: false, // não enviamos nenhuma notificação de verdade pro histórico
      dryRun: false, // isso reflete dados reais, não uma simulação
      erros: [],
      origem: ORIGEM,
      jaAtribuido: !!ownerId,
      ownerExistenteId: ownerId || null,
      ownerExistenteNome: ownerId && !bdr ? ownersDesconhecidos[ownerId] || null : null,
      segmento: "LARGE/ENTERPRISE",
      criadoEm,
    });
    inseridos++;
  }

  console.log(`[backfill] ${inseridos} leads reais inseridos (origem: ${ORIGEM}).`);
}

if (require.main === module) {
  run();
}

module.exports = { run };
