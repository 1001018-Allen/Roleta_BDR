const { TEAMS, hasPlaceholders } = require("../config/teams");
const { getNextTeamIndex, peekNextTeamIndex } = require("../state/roundRobinStore");
const hubspotService = require("./hubspotService");
const slackService = require("./slackService");

/**
 * Sorteia (e persiste) o próximo time na roleta (round-robin) e retorna o
 * objeto do time.
 */
function pickNextTeam() {
  const index = getNextTeamIndex(TEAMS.length);
  return TEAMS[index];
}

/**
 * Apenas consulta qual seria o próximo time, sem avançar a roleta.
 */
function peekNextTeam() {
  const index = peekNextTeamIndex(TEAMS.length);
  return TEAMS[index];
}

/**
 * Orquestra a distribuição de um lead:
 *   1. Sorteia o time da vez (round-robin persistido em disco).
 *   2. Resolve/atualiza o owner do deal no HubSpot.
 *   3. Notifica o time no Slack (BDR + gerente).
 *
 * Os passos 2 e 3 são tratados de forma independente: se um falhar, o outro
 * ainda é tentado, e o chamador recebe um relatório com o que deu certo/errado
 * (em vez de perder o lead inteiro por causa de uma falha pontual).
 */
async function distributeLead(lead) {
  const team = pickNextTeam();
  const dryRun = process.env.DRY_RUN === "true";

  // Fora do DRY_RUN, não faz sentido chamar HubSpot/Slack de verdade com
  // IDs placeholder — bloqueamos cedo com uma mensagem clara do que falta
  // preencher. Em DRY_RUN, deixamos passar: é justamente o modo para
  // visualizar o fluxo completo (round-robin, etapas, mensagens simuladas)
  // antes de ter os dados reais dos times.
  if (!dryRun && hasPlaceholders(team)) {
    throw new Error(
      `Time "${team.name}" ainda tem campos placeholder em src/config/teams.js. ` +
        "Preencha hubspotOwnerId, slackChannelId, bdr e manager antes de usar em produção."
    );
  }

  const result = {
    team: { id: team.id, name: team.name },
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
    result.hubspot = await hubspotService.updateDealOwner(dealId, team.hubspotOwnerId);
  } catch (err) {
    result.errors.push({ step: "hubspot", message: err.message });
  }

  try {
    result.slack = await slackService.notifyTeam({
      team,
      lead,
      dealId: dealId || "desconhecido",
    });
  } catch (err) {
    result.errors.push({ step: "slack", message: err.message });
  }

  return result;
}

module.exports = { distributeLead, pickNextTeam, peekNextTeam };
