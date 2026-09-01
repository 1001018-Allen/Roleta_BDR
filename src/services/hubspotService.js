const axios = require("axios");

const DRY_RUN = process.env.DRY_RUN === "true";

function getClient() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!DRY_RUN && !token) {
    throw new Error("HUBSPOT_TOKEN não configurado no ambiente");
  }
  return axios.create({
    baseURL: "https://api.hubapi.com",
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });
}

/**
 * Busca o contato no HubSpot pelo e-mail e retorna seu ID.
 */
async function findContactIdByEmail(email) {
  const client = getClient();
  const { data } = await client.post("/crm/v3/objects/contacts/search", {
    filterGroups: [
      { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
    ],
    properties: ["email"],
    limit: 1,
  });

  const contact = data.results && data.results[0];
  if (!contact) {
    throw new Error(`Nenhum contato encontrado no HubSpot para o e-mail ${email}`);
  }
  return contact.id;
}

/**
 * Busca os deals associados a um contato e retorna o mais recente (assumindo
 * que é o negócio criado pelo formulário inbound que acabou de chegar).
 */
async function findMostRecentDealForContact(contactId) {
  const client = getClient();
  const { data } = await client.get(
    `/crm/v4/objects/contacts/${contactId}/associations/deals`
  );

  const dealIds = (data.results || []).map((r) => r.toObjectId);
  if (dealIds.length === 0) {
    throw new Error(`Nenhum negócio associado ao contato ${contactId}`);
  }
  if (dealIds.length === 1) {
    return String(dealIds[0]);
  }

  // Mais de um deal associado: busca as datas de criação e escolhe o mais recente.
  const { data: batchData } = await client.post("/crm/v3/objects/deals/batch/read", {
    properties: ["createdate"],
    inputs: dealIds.map((id) => ({ id: String(id) })),
  });

  const mostRecent = (batchData.results || []).sort(
    (a, b) => new Date(b.properties.createdate) - new Date(a.properties.createdate)
  )[0];

  return mostRecent ? mostRecent.id : String(dealIds[0]);
}

/**
 * Resolve o dealId do lead recebido no webhook.
 *
 * Estratégia (nessa ordem):
 *  1. Se o payload já trouxer `dealId` (ex: workflow do HubSpot configurado para
 *     enviar o ID do negócio recém-criado), usamos ele diretamente.
 *  2. Caso contrário, buscamos o contato pelo e-mail e pegamos o deal mais
 *     recente associado a ele (o negócio criado pelo formulário inbound).
 */
async function resolveDealId({ dealId, email }) {
  if (dealId) {
    return String(dealId);
  }
  if (!email) {
    throw new Error(
      "Payload sem dealId e sem email: impossível localizar o negócio no HubSpot"
    );
  }

  if (DRY_RUN) {
    const fakeDealId = "SIMULATED_DEAL_ID";
    console.log(
      `[DRY_RUN] HubSpot: buscaria contato/deal pelo e-mail ${email} (retornando ${fakeDealId})`
    );
    return fakeDealId;
  }

  const contactId = await findContactIdByEmail(email);
  return findMostRecentDealForContact(contactId);
}

/**
 * Atualiza o owner (BDR/time responsável) de um deal no HubSpot.
 */
async function updateDealOwner(dealId, ownerId) {
  if (DRY_RUN) {
    console.log(
      `[DRY_RUN] HubSpot: atualizaria deal ${dealId} com hubspot_owner_id=${ownerId}`
    );
    return { simulated: true, dealId, ownerId };
  }

  const client = getClient();
  const { data } = await client.patch(`/crm/v3/objects/deals/${dealId}`, {
    properties: { hubspot_owner_id: ownerId },
  });
  return data;
}

module.exports = { resolveDealId, updateDealOwner };
