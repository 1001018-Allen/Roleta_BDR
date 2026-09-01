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
 * Orquestra a chegada de um lead:
 *   1. Resolve o deal no HubSpot e checa se ele JÁ TEM UM OWNER.
 *      - Se já tiver: NÃO roda a roleta (não consome a vez de ninguém) e
 *        direciona o aviso pra quem já é o dono, se for um BDR conhecido.
 *      - Se não tiver: roda a roleta em 2 níveis (coordenador -> BDR),
 *        atualiza o owner do deal e avisa o time no Slack.
 *   2. Grava o lead no banco (histórico para o dashboard), sempre.
 *
 * Falhas em HubSpot/Slack são independentes entre si: se uma etapa falhar,
 * a outra ainda é tentada, e o chamador recebe um relatório de erros.
 */
async function distributeLead(lead, { origem = "manual", segmento = null } = {}) {
  const dryRun = process.env.DRY_RUN === "true";
  const result = { coordenador: null, bdr: null, hubspot: null, slack: null, errors: [], jaAtribuido: false };

  let dealId = null;
  try {
    dealId = await hubspotService.resolveDealId({ dealId: lead.dealId, email: lead.email });
  } catch (err) {
    result.errors.push({ step: "hubspot-resolve-deal", message: err.message });
    // Sem dealId não dá pra checar owner nem atualizar nada — mas ainda
    // registramos o lead no banco (com erro) e devolvemos.
    const leadId = repo.saveLead({
      nome: lead.name,
      empresa: lead.company,
      email: lead.email,
      form: lead.form,
      dealId: null,
      hubspotOk: false,
      slackOk: false,
      dryRun,
      erros: result.errors,
      origem,
      segmento,
    });
    return { ...result, leadId };
  }

  let existingOwnerId = null;
  try {
    existingOwnerId = await hubspotService.getDealOwnerId(dealId);
  } catch (err) {
    result.errors.push({ step: "hubspot-check-owner", message: err.message });
  }

  if (existingOwnerId) {
    // Já tem alguém trabalhando nesse deal — não mexe na roleta.
    result.jaAtribuido = true;
    const bdrExistente = repo.getBdrByHubspotOwnerId(existingOwnerId);

    if (bdrExistente) {
      const coordenadorExistente = repo.getCoordenadorById(bdrExistente.coordenador_id);
      result.coordenador = { id: coordenadorExistente.id, nome: coordenadorExistente.nome };
      result.bdr = { id: bdrExistente.id, nome: bdrExistente.nome };
      try {
        result.slack = await slackService.notifyTeam({
          coordenador: coordenadorExistente,
          bdr: bdrExistente,
          lead,
          dealId,
          jaAtribuido: true,
        });
      } catch (err) {
        result.errors.push({ step: "slack", message: err.message });
      }
    } else {
      // Owner existe no HubSpot mas não é ninguém da nossa lista de BDRs
      // conhecidos — não temos time/canal pra avisar, só registramos.
      result.errors.push({
        step: "owner-desconhecido",
        message: `Deal ${dealId} já tem owner ${existingOwnerId}, que não está cadastrado como BDR.`,
      });
    }

    const leadId = repo.saveLead({
      nome: lead.name,
      empresa: lead.company,
      email: lead.email,
      form: lead.form,
      dealId,
      coordenadorId: result.coordenador && result.coordenador.id,
      bdrId: result.bdr && result.bdr.id,
      hubspotOk: true, // não precisou escrever nada, o dado já estava correto
      slackOk: !!result.slack,
      dryRun,
      erros: result.errors,
      origem,
      jaAtribuido: true,
      ownerExistenteId: existingOwnerId,
      segmento,
    });
    return { ...result, leadId };
  }

  // Sem owner ainda: roda a roleta normalmente.
  const { coordenador, bdr } = pickNextTeam();
  result.coordenador = { id: coordenador.id, nome: coordenador.nome };
  result.bdr = { id: bdr.id, nome: bdr.nome };

  try {
    result.hubspot = await hubspotService.updateDealOwner(dealId, bdr.hubspot_owner_id);
  } catch (err) {
    result.errors.push({ step: "hubspot", message: err.message });
  }

  try {
    result.slack = await slackService.notifyTeam({ coordenador, bdr, lead, dealId });
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
    origem,
    segmento,
  });

  return { ...result, leadId };
}

module.exports = { distributeLead, pickNextTeam, peekNextTeam };
