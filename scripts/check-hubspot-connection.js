/**
 * Verificação de "está tudo pronto pra usar o HubSpot de verdade?".
 *
 * Roda checagens reais (não simuladas) contra a API do HubSpot usando o
 * HUBSPOT_TOKEN do .env, e imprime um resultado claro de cada uma. Pensado
 * pra rodar UMA VEZ depois de colar o token, antes de colocar DRY_RUN=false
 * em produção.
 *
 * Uso:
 *   node --disable-warning=ExperimentalWarning scripts/check-hubspot-connection.js
 *   node --disable-warning=ExperimentalWarning scripts/check-hubspot-connection.js algum-email-real@empresa.com
 *
 * Passar um e-mail real (de um contato que já existe no HubSpot) roda o
 * fluxo completo de verdade (resolveDealId + getDealOwnerId) — é a forma
 * mais direta de confirmar que a lógica de produção funciona ponta a ponta.
 * Sem e-mail, só confirma que o token tem os escopos de leitura básicos.
 *
 * IMPORTANTE: este script só LÊ dados (nunca escreve/atualiza nada), mesmo
 * que rode com sucesso. O escopo de ESCRITA (crm.objects.deals.write) não
 * dá pra confirmar sem escrever de verdade — teste isso rodando
 * POST /test/simulate-lead com DRY_RUN=false contra um deal de teste.
 */
require("dotenv").config();

// Força chamadas reais nesse script, independente do DRY_RUN do .env —
// senão hubspotService simularia tudo e não checaria nada de verdade.
process.env.DRY_RUN = "false";

const axios = require("axios");
const hubspotService = require("../src/services/hubspotService");

const token = process.env.HUBSPOT_TOKEN;
const client = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: { Authorization: `Bearer ${token}` },
  timeout: 10000,
});

function classificarErro(err) {
  const body = err.response && err.response.data;
  if (body && (body.category || body.message)) {
    const prefixo = body.category ? `[${body.category}] ` : "";
    return `${prefixo}${body.message || err.message} (HTTP ${err.response.status})`;
  }
  return err.message;
}

async function checar(nome, fn) {
  process.stdout.write(`- ${nome}... `);
  try {
    await fn();
    console.log("✅ OK");
    return true;
  } catch (err) {
    console.log(`❌ FALHOU — ${classificarErro(err)}`);
    return false;
  }
}

async function main() {
  console.log("Verificação de conexão com o HubSpot\n");

  if (!token) {
    console.log(
      "❌ HUBSPOT_TOKEN não está definido no .env. Crie uma Private App em " +
        "HubSpot > Configurações > Integrações > Private Apps, com os escopos:\n" +
        "   crm.objects.contacts.read, crm.objects.deals.read, crm.objects.deals.write\n" +
        "e cole o token gerado em HUBSPOT_TOKEN no .env."
    );
    process.exitCode = 1;
    return;
  }

  const okContacts = await checar("Token válido + escopo crm.objects.contacts.read", () =>
    client.get("/crm/v3/objects/contacts", { params: { limit: 1 } })
  );

  const okDeals = await checar("Escopo crm.objects.deals.read", () =>
    client.get("/crm/v3/objects/deals", { params: { limit: 1, properties: "hubspot_owner_id" } })
  );

  console.log(
    "\nℹ️  Escopo de escrita (crm.objects.deals.write) não dá pra confirmar sem " +
      "escrever de verdade — teste rodando POST /test/simulate-lead com DRY_RUN=false\n" +
      "   contra um deal de teste depois que os checks acima passarem."
  );

  const email = process.argv[2];
  if (email) {
    console.log(`\nTeste ponta a ponta com o e-mail "${email}" (fluxo real de produção):`);
    try {
      const dealId = await hubspotService.resolveDealId({ email });
      console.log(`  ✅ Deal encontrado: ${dealId}`);
      const ownerId = await hubspotService.getDealOwnerId(dealId);
      console.log(`  ✅ Owner atual: ${ownerId || "(nenhum — deal sem owner ainda)"}`);
    } catch (err) {
      console.log(`  ❌ FALHOU — ${err.message}`);
    }
  } else {
    console.log(
      "\nDica: rode de novo passando um e-mail real de contato já existente no " +
        "HubSpot como argumento pra testar o fluxo completo (resolveDealId + " +
        "getDealOwnerId), do jeito que vai rodar em produção."
    );
  }

  console.log(
    okContacts && okDeals
      ? "\n✅ Checks básicos passaram. Pode seguir para o teste ponta a ponta / DRY_RUN=false."
      : "\n❌ Algum check falhou — resolva antes de desligar o DRY_RUN."
  );
  process.exitCode = okContacts && okDeals ? 0 : 1;
}

main();
