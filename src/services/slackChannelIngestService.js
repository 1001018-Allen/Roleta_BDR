const axios = require("axios");
const repo = require("../db/repository");
const { parseLeadMessage } = require("./leadMessageParser");
const { distributeLead } = require("./leadDistributionService");

// Canal #mkt-sales-leads — "Canal de notificações do HubSpot para geração de
// leads e deals" (é onde o app do HubSpot posta cada lead inbound novo).
const CHANNEL_ID = process.env.SLACK_LEADS_CHANNEL_ID || "C04365S730B";
const INGEST_STATE_KEY = `slack-ingest:${CHANNEL_ID}`;
const ORIGEM = "slack-mkt-sales-leads";

/**
 * Busca mensagens novas do canal (mais recentes que o último ts processado).
 * IMPORTANTE: o bot do Slack (SLACK_BOT_TOKEN) precisa estar adicionado ao
 * canal #mkt-sales-leads (ele é privado) — sem isso a API retorna
 * "not_in_channel"/"channel_not_found".
 */
async function fetchNewMessages(oldestTs) {
  const { data } = await axios.get("https://slack.com/api/conversations.history", {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    params: { channel: CHANNEL_ID, oldest: oldestTs, limit: 200 },
    timeout: 10000,
  });

  if (!data.ok) {
    throw new Error(`Slack conversations.history falhou: ${data.error}`);
  }
  if (data.has_more) {
    // Lote grande demais para uma página só — em operação normal (polling
    // frequente) isso não deveria acontecer; logamos pra visibilidade.
    console.warn(
      `[slack-ingest] há mais mensagens do que as ${data.messages.length} retornadas ` +
        "nesta página; considere reduzir o intervalo do poller."
    );
  }

  // A API retorna mais novo -> mais antigo; processamos em ordem cronológica.
  return [...data.messages].reverse();
}

/**
 * Varre o canal em busca de leads novos do segmento configurado
 * (SLACK_LEAD_SEGMENT, default LARGE/ENTERPRISE), processa cada um via
 * leadDistributionService.distributeLead e avança o cursor de leitura.
 */
async function pollNewLeads() {
  if (!process.env.SLACK_BOT_TOKEN) {
    console.warn("[slack-ingest] SLACK_BOT_TOKEN não configurado — pulando polling do Slack.");
    return { processed: 0, skipped: true };
  }

  const oldestTs = repo.getIngestState(INGEST_STATE_KEY) || "0";
  const mensagens = await fetchNewMessages(oldestTs);

  const processados = [];
  for (const mensagem of mensagens) {
    const lead = parseLeadMessage(mensagem);
    if (lead) {
      try {
        const resultado = await distributeLead(lead, { origem: ORIGEM, segmento: lead.segmento });
        processados.push({ ts: mensagem.ts, lead, resultado });
      } catch (err) {
        console.error(`[slack-ingest] erro processando lead (ts=${mensagem.ts}):`, err);
      }
    }
    // Avança o cursor mensagem a mensagem (mesmo quando não é um lead do
    // nosso segmento) para nunca reprocessar a mesma mensagem de novo.
    repo.setIngestState(INGEST_STATE_KEY, mensagem.ts);
  }

  return { processed: processados.length, leads: processados };
}

/** Inicia o polling periódico (chamado uma vez no boot do servidor). */
function startPolling(intervalMs) {
  console.log(
    `[slack-ingest] polling do canal ${CHANNEL_ID} a cada ${intervalMs}ms (segmento: ` +
      `${process.env.SLACK_LEAD_SEGMENT || "LARGE/ENTERPRISE"})`
  );
  const tick = () => {
    pollNewLeads().catch((err) => console.error("[slack-ingest] erro no polling:", err));
  };
  tick(); // roda uma vez imediatamente, não só depois do primeiro intervalo
  return setInterval(tick, intervalMs);
}

module.exports = { pollNewLeads, startPolling, CHANNEL_ID };
