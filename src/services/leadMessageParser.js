/**
 * Faz o parsing das mensagens que o app do HubSpot posta automaticamente no
 * canal #mkt-sales-leads quando chega um lead inbound novo.
 *
 * Formato real observado (texto principal + um "attachment" em mrkdwn):
 *
 *   LARGE/ENTERPRISE — Chegou um novo lead inbound! :rocket:
 *
 *   Tem nova oportunidade entrando no funil. Vamos atuar (...)
 *
 *   *First Name*: Najla
 *   *Company Name*:
 *   *Email*: <mailto:najla@empresa.com|najla@empresa.com>
 *   *Quantos colaboradores sua empresa tem?*: 1.001 - 5.000
 *   *GMV mensal*: De R$ 100 mil a R$ 399 mil por mês
 *   *Original Source*:
 *   *Origem da conversão*: Leadster
 *
 * Só nos interessa o segmento LARGE/ENTERPRISE (é o time que a roleta
 * atende) — MID MARKET e KEY ACCOUNT são ignorados.
 */

const SEGMENTO_ALVO = process.env.SLACK_LEAD_SEGMENT || "LARGE/ENTERPRISE";

// Ex: "LARGE/ENTERPRISE — Chegou um novo lead inbound! :rocket:"
const TITULO_REGEX = /^([A-Za-zÀ-ÿ/ ]+?)\s+—\s+Chegou um novo lead inbound/;

/** Remove a sintaxe de link do Slack: <url|label> ou <mailto:x|x> -> "label". */
function limparLinkSlack(valor) {
  if (!valor) return valor;
  const match = valor.trim().match(/^<(?:mailto:)?([^|>]+)(?:\|([^>]+))?>$/);
  if (!match) return valor.trim();
  return (match[2] || match[1]).trim();
}

/**
 * Extrai os campos "*Label*: valor" do texto do attachment.
 * Retorna um objeto { "First Name": "Najla", "Company Name": "", ... }.
 */
function parseCamposAttachment(textoAttachment) {
  const campos = {};
  // [ \t]* (não \s*) depois dos ":" é de propósito: \s também casa \n, e
  // quando o valor vem vazio isso "engolia" a quebra de linha e colava o
  // valor do campo seguinte aqui dentro.
  const regexCampo = /\*([^*]+)\*:[ \t]*([^\n]*)/g;
  let m;
  while ((m = regexCampo.exec(textoAttachment)) !== null) {
    const label = m[1].trim();
    const valor = limparLinkSlack(m[2]);
    campos[label] = valor;
  }
  return campos;
}

/**
 * Tenta interpretar uma mensagem do canal como um lead inbound do segmento
 * que a roleta atende. Retorna `null` se a mensagem não for desse tipo
 * (outro segmento, mensagem manual, thread reply, etc.) — nesse caso o
 * chamador deve simplesmente ignorar a mensagem.
 *
 * @param {object} mensagem  { text, attachments: [{ text }], ts, ... } — no
 *   formato retornado pela Slack Web API (conversations.history).
 */
function parseLeadMessage(mensagem) {
  const textoPrincipal = mensagem.text || "";
  const tituloMatch = textoPrincipal.match(TITULO_REGEX);
  if (!tituloMatch) return null;

  const segmento = tituloMatch[1].trim();
  if (segmento.toUpperCase() !== SEGMENTO_ALVO.toUpperCase()) {
    return null; // MID MARKET, KEY ACCOUNT etc. — não é o nosso time
  }

  const textoAttachment = (mensagem.attachments || []).map((a) => a.text || "").join("\n");
  const campos = parseCamposAttachment(textoAttachment);

  const email = campos["Email"];
  if (!email) return null; // sem e-mail não dá pra localizar o lead no HubSpot

  const origemConversao = campos["Origem da conversão"] || campos["Origem da conversao"];

  return {
    name: campos["First Name"] || "(sem nome)",
    company: campos["Company Name"] || "(empresa não informada)",
    email,
    form: origemConversao || segmento,
    segmento,
    origemConversao: origemConversao || null,
    originalSource: campos["Original Source"] || null,
    ts: mensagem.ts,
  };
}

module.exports = { parseLeadMessage, parseCamposAttachment, limparLinkSlack };
