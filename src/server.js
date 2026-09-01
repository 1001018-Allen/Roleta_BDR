require("dotenv").config();
const express = require("express");

const { db } = require("./db");
const { seed } = require("./db/seed");
const webhookRoutes = require("./routes/webhookRoutes");
const testRoutes = require("./routes/testRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const slackChannelIngestService = require("./services/slackChannelIngestService");

// Popula coordenadores/BDRs automaticamente se o banco ainda estiver vazio
// (primeira execução). Rode `npm run seed` manualmente para reaplicar depois
// de editar data/bdrs-seed.json.
const totalCoordenadores = db.prepare("SELECT COUNT(*) AS n FROM coordenadores").get().n;
if (totalCoordenadores === 0) {
  seed();
}

const app = express();
app.use(express.json());

app.use("/webhook", webhookRoutes);
app.use("/test", testRoutes);
app.use("/dashboard", dashboardRoutes);

app.get("/", (req, res) => {
  res.json({ service: "roleta-bdr-webhook", status: "running", dashboard: "/dashboard" });
});

// 404 para rotas não mapeadas
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Rota não encontrada" });
});

// Middleware central de tratamento de erros: qualquer erro passado via
// next(err) nas rotas cai aqui, evitando que o processo derrube o servidor.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ ok: false, message: err.message || "Erro interno" });
});

// Rede de segurança para erros assíncronos que escapem do try/catch das rotas
// (ex: bug em algum código chamado via setTimeout/callback). Apenas loga: não
// queremos que uma falha pontual derrube o serviço inteiro.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Roleta BDR webhook rodando na porta ${PORT} (DRY_RUN=${process.env.DRY_RUN})`);

  // Liga o polling do canal #mkt-sales-leads (fonte real dos leads inbound)
  // se SLACK_POLL_ENABLED=true. Precisa de SLACK_BOT_TOKEN com permissão de
  // leitura no canal (e o bot precisa estar adicionado a ele, já que é
  // privado) — sem isso, cada tentativa de poll só loga um aviso e pula.
  if (process.env.SLACK_POLL_ENABLED === "true") {
    const intervalMs = Number(process.env.SLACK_POLL_INTERVAL_MS) || 30000;
    slackChannelIngestService.startPolling(intervalMs);
  } else {
    console.log(
      "[slack-ingest] polling desligado (SLACK_POLL_ENABLED != true) — " +
        "leads só entram via /webhook/hubspot-lead ou /test/simulate-lead."
    );
  }
});

module.exports = app;
