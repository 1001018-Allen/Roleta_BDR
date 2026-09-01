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

/**
 * Envia a mensagem de aviso no canal do Slack do time sorteado, mencionando
 * o BDR responsável e o gerente do time.
 */
async function notifyTeam({ team, lead, dealId }) {
  const text =
    `:rotating_light: *Novo lead distribuído para o ${team.name}*\n` +
    `> *Nome:* ${lead.name}\n` +
    `> *Empresa:* ${lead.company}\n` +
    `> *E-mail:* ${lead.email}\n` +
    `> *Formulário:* ${lead.form}\n` +
    `> *Negócio no HubSpot:* ${dealId}\n\n` +
    `<@${team.bdr.slackUserId}> esse lead é seu! ` +
    `<@${team.manager.slackUserId}> te marcando para acompanhamento.`;

  if (DRY_RUN) {
    console.log(
      `[DRY_RUN] Slack: enviaria para o canal ${team.slackChannelId}:\n${text}`
    );
    return { simulated: true, channel: team.slackChannelId, text };
  }

  const client = getClient();
  const { data } = await client.post("/chat.postMessage", {
    channel: team.slackChannelId,
    text,
  });

  if (!data.ok) {
    throw new Error(`Slack API retornou erro: ${data.error}`);
  }
  return data;
}

module.exports = { notifyTeam };
