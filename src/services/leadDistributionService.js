const repo = require("../db/repository");
const roundRobin = require("../state/roundRobinStore");
const hubspotService = require("./hubspotService");
const slackService = require("./slackService");

/**
 * Sorteia (e persiste) o próximo coordenador e, dentro do time dele, o
 * próximo BDR — round-robin em 2 níveis:
 *   1. coordenador -> coordenador -> coordenador -> ... (ordem fixa do seed)
 *   2. dentro do time do coordenador sorteado, o próximo BDR daquele time
 */
function pickNextCoordenadorAndBdr({ persist }) {
  const coordenadores = repo.listCoordenadores();
  if (coordenadores.length === 0) {
    throw new Error("Nenhum coordenador cadastrado. Rode `npm run seed` primeiro.");
  }

  const coordenadorIndex = persist
    ? roundRobin.advanceCoordenadorIndex(coordenadores.length)
    : roundRobin.peekCoordenadorIndex(coordenadores.length);
  const coordenador = coordenadores[coordenadorIndex];

  const bdrs = repo.listBdrsByCoordenador(coordenador.id);
  if (bdrs.length === 0) {
    throw new Error(`Coordenador "${coordenador.nome}" não tem nenhum BDR ativo cadastrado.`);
  }

  const bdrIndex = persist
    ? roundRobin.advanceBdrIndex(coordenador.id, bdrs.length)
    : roundRobin.peekBdrIndex(coordenador.id, bdrs.length);
  const bdr = bdrs[bdrIndex];

  return { coordenador, bdr };
}

function pickNextTeam() {
  return pickNextCoordenadorAndBdr({ persist: true });
}

function peekNextTeam() {
  return pickNextCoordenadorAndBdr({ persist: false });
}

/**
 * Orquestra a distribuição de um lead:
 *   1. Sorteia coordenador + BDR da vez (round-robin em 2 níveis, persistido).
 *   2. Resolve/atualiza o owner do deal no HubSpot (owner = o BDR sorteado).
 *   3. Notifica o time no Slack, mencionando o BDR e o coordenador (gerente).
 *   4. Grava o lead no banco (histórico para o dashboard).
 *
 * Os passos 2 e 3 são independentes: se um falhar, o outro ainda é tentado,
 * e o chamador recebe um relatório com o que deu certo/errado.
 */
async function distributeLead(lead) {
  const { coordenador, bdr } = pickNextTeam();
  const dryRun = process.env.DRY_RUN === "true";

  const result = {
    coordenador: { id: coordenador.id, nome: coordenador.nome },
    bdr: { id: bdr.id, nome: bdr.nome },
    hubspot: null,
    slack: null,
    errors: [],
  };

  let dealId = null;
  try {
    dealId = await hubspotService.resolveDealId({
      dealId: lead.dealId,
      email: lead.email,
    });
    result.hubspot = await hubspotService.updateDealOwner(dealId, bdr.hubspot_owner_id);
  } catch (err) {
    result.errors.push({ step: "hubspot", message: err.message });
  }

  try {
    result.slack = await slackService.notifyTeam({ coordenador, bdr, lead, dealId: dealId || "desconhecido" });
  } catch (err) {
    result.errors.push({ step: "slack", message: err.message });
  }

  const leadId = repo.saveLead({
    nome: lead.name,
    empresa: lead.company,
    email: lead.email,
    form: lead.form,
    dealId,
    coordenadorId: coordenador.id,
    bdrId: bdr.id,
    hubspotOk: !!result.hubspot,
    slackOk: !!result.slack,
    dryRun,
    erros: result.errors,
  });

  return { ...result, leadId };
}

module.exports = { distributeLead, pickNextTeam, peekNextTeam };
