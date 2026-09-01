/**
 * Configuração dos 3 times que participam da "roleta" de distribuição de leads.
 *
 * PREENCHA os campos marcados com "TODO" assim que tiver os IDs reais:
 *   - hubspotOwnerId: ID do owner no HubSpot (Configurações > Usuários e equipes,
 *     ou via API GET /crm/v3/owners) que será colocado no deal do lead inbound.
 *   - slackChannelId: ID do canal do Slack do time (ex: "C0123456789"), não o nome
 *     (#time-a). Pegue em "Detalhes do canal" no Slack ou via API conversations.list.
 *   - bdr: nome e ID de usuário do Slack (ex: "U0123456789") do BDR responsável
 *     por esse time, para ser mencionado na mensagem.
 *   - manager: nome e ID de usuário do Slack do gerente do time, também mencionado.
 *
 * A ORDEM deste array é a ordem do round-robin (A -> B -> C -> A -> ...).
 */

const TEAMS = [
  {
    id: "A",
    name: "Time A",
    hubspotOwnerId: "TODO_HUBSPOT_OWNER_ID_TIME_A",
    slackChannelId: "TODO_SLACK_CHANNEL_ID_TIME_A",
    bdr: {
      name: "TODO_NOME_BDR_TIME_A",
      slackUserId: "TODO_SLACK_USER_ID_BDR_TIME_A",
    },
    manager: {
      name: "TODO_NOME_GERENTE_TIME_A",
      slackUserId: "TODO_SLACK_USER_ID_GERENTE_TIME_A",
    },
  },
  {
    id: "B",
    name: "Time B",
    hubspotOwnerId: "TODO_HUBSPOT_OWNER_ID_TIME_B",
    slackChannelId: "TODO_SLACK_CHANNEL_ID_TIME_B",
    bdr: {
      name: "TODO_NOME_BDR_TIME_B",
      slackUserId: "TODO_SLACK_USER_ID_BDR_TIME_B",
    },
    manager: {
      name: "TODO_NOME_GERENTE_TIME_B",
      slackUserId: "TODO_SLACK_USER_ID_GERENTE_TIME_B",
    },
  },
  {
    id: "C",
    name: "Time C",
    hubspotOwnerId: "TODO_HUBSPOT_OWNER_ID_TIME_C",
    slackChannelId: "TODO_SLACK_CHANNEL_ID_TIME_C",
    bdr: {
      name: "TODO_NOME_BDR_TIME_C",
      slackUserId: "TODO_SLACK_USER_ID_BDR_TIME_C",
    },
    manager: {
      name: "TODO_NOME_GERENTE_TIME_C",
      slackUserId: "TODO_SLACK_USER_ID_GERENTE_TIME_C",
    },
  },
];

/** Retorna true se algum campo do time ainda estiver com valor placeholder. */
function hasPlaceholders(team) {
  const values = [
    team.hubspotOwnerId,
    team.slackChannelId,
    team.bdr.name,
    team.bdr.slackUserId,
    team.manager.name,
    team.manager.slackUserId,
  ];
  return values.some((v) => typeof v === "string" && v.startsWith("TODO_"));
}

module.exports = { TEAMS, hasPlaceholders };
