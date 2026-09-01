/**
 * Gera uma versão ESTÁTICA (self-contained) do dashboard: os dados do banco
 * são embutidos direto no HTML (em vez de vir de fetch("/dashboard/api/...")),
 * então o arquivo abre em qualquer navegador sem precisar do servidor rodando.
 *
 * É uma "foto" do banco no momento em que o script roda — não atualiza
 * sozinho. Rode de novo e reenvie o arquivo sempre que quiser dados frescos.
 *
 * Uso: node --disable-warning=ExperimentalWarning scripts/generate-static-dashboard.js [caminho-de-saida.html]
 */
const fs = require("fs");
const path = require("path");
const repo = require("../src/db/repository");
const { peekNextTeam } = require("../src/services/leadDistributionService");

const OUTPUT = process.argv[2] || path.join(__dirname, "..", "dashboard-snapshot.html");
const TEMPLATE = path.join(__dirname, "..", "public", "dashboard.html");

function buildData() {
  const { coordenador, bdr } = peekNextTeam();
  const leads = repo.listRecentLeads(200).map((l) => ({
    ...l,
    erros: l.erros ? JSON.parse(l.erros) : [],
  }));

  return {
    state: { proximoCoordenador: coordenador.nome, proximoBdr: bdr.nome },
    stats: {
      porCoordenador: repo.countLeadsByCoordenador(),
      porBdr: repo.countLeadsByBdr(),
    },
    leads: { leads },
    geradoEm: new Date().toISOString(),
  };
}

function gerar() {
  const data = buildData();
  let html = fs.readFileSync(TEMPLATE, "utf-8");

  // Troca o load() que busca das rotas /dashboard/api/* por uma versão que
  // lê os dados já embutidos em window.__DASHBOARD_DATA__.
  const fetchBlock = `async function load() {
    const [state, stats, leadsResp] = await Promise.all([
      fetch("/dashboard/api/state").then((r) => r.json()),
      fetch("/dashboard/api/stats").then((r) => r.json()),
      fetch("/dashboard/api/leads?limit=50").then((r) => r.json()),
    ]);`;

  const staticBlock = `async function load() {
    const state = window.__DASHBOARD_DATA__.state;
    const stats = window.__DASHBOARD_DATA__.stats;
    const leadsResp = window.__DASHBOARD_DATA__.leads;`;

  if (!html.includes(fetchBlock)) {
    throw new Error(
      "Não encontrei o bloco de fetch esperado em public/dashboard.html — o template mudou? " +
        "Atualize este script."
    );
  }
  html = html.replace(fetchBlock, staticBlock);

  // Snapshot estático não precisa (e não consegue) re-buscar dados: roda
  // load() uma vez só, sem o setInterval de auto-refresh.
  html = html.replace('load();\n  setInterval(load, 5000);', "load();");

  // Injeta os dados + um aviso visual de que isso é uma foto estática.
  const dataScript =
    `<script>window.__DASHBOARD_DATA__ = ${JSON.stringify(data)};</script>\n`;
  html = html.replace("<script>", dataScript + "<script>");

  const aviso = `<span class="badge-rascunho" style="color:#52514e;border-color:#c3c2b7;">📸 Foto estática — gerada em ${new Date(
    data.geradoEm
  ).toLocaleString("pt-BR")}</span>`;
  html = html.replace(
    '<span class="badge-rascunho">Rascunho — dados de teste</span>',
    `<span class="badge-rascunho">Dados reais (Slack + HubSpot, leitura)</span>\n    ${aviso}`
  );

  fs.writeFileSync(OUTPUT, html);
  console.log(`[dashboard-snapshot] gerado em ${OUTPUT}`);
}

gerar();
