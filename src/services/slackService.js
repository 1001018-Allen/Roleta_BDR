const axios = require("axios");

const DRY_RUN = process.env.DRY_RUN === "true";

function getClient() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!DRY_RUN && !token) {
    throw new Error("SLACK_BOT_TOKEN não configurado no ambiente");
  }
  return axios.create({
    baseURL: "https://slack.com/api",
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });
}

/** Menciona por ID do Slack se existir; senão cai para o nome (legível no rascunho). */
function mention(nome, slackUserId) {
  return slackUserId ? `<@${slackUserId}>` : `*${nome}*`;
}

/**
 * Envia a mensagem de aviso no canal do Slack do time do coordenador
 * sorteado, mencionando o BDR responsável e o coordenador (gerente).
 */
async function notifyTeam({ coordenador, bdr, lead, dealId }) {
  const text =
    `:rotating_light: *Novo lead distribuído para o time do ${coordenador.nome}*\n` +
    `> *Nome:* ${lead.name}\n` +
    `> *Empresa:* ${lead.company}\n` +
    `> *E-mail:* ${lead.email}\n` +
    `> *Formulário:* ${lead.form}\n` +
    `> *Negócio no HubSpot:* ${dealId}\n\n` +
    `${mention(bdr.nome, bdr.slack_user_id)} esse lead é seu! ` +
    `${mention(coordenador.nome, coordenador.slack_user_id)} te marcando para acompanhamento.`;

  const channel = coordenador.slack_channel_id || `#TODO-canal-${coordenador.nome.toLowerCase()}`;

  if (DRY_RUN) {
    console.log(`[DRY_RUN] Slack: enviaria para o canal ${channel}:\n${text}`);
    return { simulated: true, channel, text };
  }

  const client = getClient();
  const { data } = await client.post("/chat.postMessage", { channel, text });

  if (!data.ok) {
    throw new Error(`Slack API retornou erro: ${data.error}`);
  }
  return data;
}

module.exports = { notifyTeam };
