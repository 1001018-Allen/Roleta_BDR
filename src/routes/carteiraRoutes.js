const express = require("express");
const path = require("path");
const repo = require("../db/carteiraRepository");
const { listBdrsByCoordenador, listCoordenadores } = require("../db/repository");
const { db } = require("../db/index");
const { importDealsFromCsv } = require("../services/csvImportService");
const { computeScore, loadConfig } = require("../services/leadScoreService");

const router = express.Router();

/** GET /carteira — página HTML estática (lê dados via /carteira/api/*). */
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "carteira.html"));
});

/** GET /carteira/api/bdrs — lista de BDRs ativos (pra popular o filtro). */
router.get("/api/bdrs", (req, res, next) => {
  try {
    const coordenadores = listCoordenadores();
    const bdrs = coordenadores.flatMap((c) =>
      listBdrsByCoordenador(c.id).map((b) => ({ ...b, coordenador_nome: c.nome }))
    );
    res.json({ bdrs });
  } catch (err) {
    next(err);
  }
});

/** GET /carteira/api/deals — lista de negócios (com filtro opcional por bdrId/etapa). */
router.get("/api/deals", (req, res, next) => {
  try {
    const bdrId = req.query.bdrId ? Number(req.query.bdrId) : undefined;
    const dealstage = req.query.dealstage || undefined;
    const deals = repo.listDeals({ bdrId, dealstage }).map((deal) => {
      const isQualificacao = /qualifica|diagn/i.test(deal.hs_dealstage || "");
      return {
        ...deal,
        score: isQualificacao ? computeScore(deal) : null,
      };
    });
    res.json({ deals });
  } catch (err) {
    next(err);
  }
});

/** GET /carteira/api/deals/:id — detalhe de um negócio + timeline. */
router.get("/api/deals/:id", (req, res, next) => {
  try {
    const deal = repo.getDealById(req.params.id);
    if (!deal) return res.status(404).json({ ok: false, message: "Negócio não encontrado." });
    const isQualificacao = /qualifica|diagn/i.test(deal.hs_dealstage || "");
    res.json({
      deal: { ...deal, score: isQualificacao ? computeScore(deal) : null },
      notas: repo.listNotes(deal.id),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /carteira/api/deals — cria um negócio manual (fora do fluxo HubSpot). */
router.post("/api/deals", (req, res, next) => {
  try {
    const { bdrId, dealname, pipeline, dealstage, amount } = req.body;
    if (!dealname || !dealstage) {
      return res.status(400).json({ ok: false, message: "dealname e dealstage são obrigatórios." });
    }
    const id = repo.createManualDeal({
      bdr_id: bdrId || null,
      hs_owner_name: null,
      hs_dealname: dealname,
      hs_pipeline: pipeline || null,
      hs_dealstage: dealstage,
      hs_amount: amount || null,
    });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

/** PATCH /carteira/api/deals/:id/forecast — atualiza forecast manual do negócio. */
router.patch("/api/deals/:id/forecast", (req, res, next) => {
  try {
    const { forecastCloseDate, forecastAmount, forecastConfidence } = req.body;
    repo.updateForecast(req.params.id, {
      forecast_close_date: forecastCloseDate || null,
      forecast_amount: forecastAmount ?? null,
      forecast_confidence: forecastConfidence ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** PATCH /carteira/api/deals/:id/score — atualiza checklist de qualificação + contadores de atividade. */
router.patch("/api/deals/:id/score", (req, res, next) => {
  try {
    const { contatoCerto, fitGmv, dorMapeada, timingReal, whatsappMsgs, calls, meetingsHeld, manualBonus } = req.body;
    repo.updateScoreInputs(req.params.id, {
      score_contato_certo: contatoCerto ? 1 : 0,
      score_fit_gmv: fitGmv ? 1 : 0,
      score_dor_mapeada: dorMapeada ? 1 : 0,
      score_timing_real: timingReal ? 1 : 0,
      score_whatsapp_msgs: whatsappMsgs || 0,
      score_calls: calls || 0,
      score_meetings_held: meetingsHeld || 0,
      score_manual_bonus: manualBonus || 0,
    });
    const deal = repo.getDealById(req.params.id);
    res.json({ ok: true, score: computeScore(deal) });
  } catch (err) {
    next(err);
  }
});

/** GET /carteira/api/score-config — pesos atuais da pontuação (pra exibir na UI). */
router.get("/api/score-config", (req, res, next) => {
  try {
    res.json(loadConfig());
  } catch (err) {
    next(err);
  }
});

/** POST /carteira/api/deals/:id/notas — adiciona entrada na timeline do negócio. */
router.post("/api/deals/:id/notas", (req, res, next) => {
  try {
    const { tipo, texto } = req.body;
    if (!texto || !texto.trim()) {
      return res.status(400).json({ ok: false, message: "texto é obrigatório." });
    }
    const id = repo.addNote(req.params.id, { tipo, texto: texto.trim() });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    next(err);
  }
});

/** POST /carteira/api/import-csv — importa negócios de um CSV colado (export do HubSpot). */
router.post("/api/import-csv", (req, res, next) => {
  try {
    const { csv } = req.body;
    if (!csv || !csv.trim()) {
      return res.status(400).json({ ok: false, message: "Cole o conteúdo do CSV no campo 'csv'." });
    }
    const resultado = importDealsFromCsv(csv);
    res.json({ ok: resultado.erros.length === 0, ...resultado });
  } catch (err) {
    next(err);
  }
});

/** GET /carteira/api/stats — indicadores gerais pra tela inicial. */
router.get("/api/stats", (req, res, next) => {
  try {
    const total = db.prepare("SELECT COUNT(*) AS n FROM deals").get().n;
    const semAtividade14d = db
      .prepare(
        `SELECT COUNT(*) AS n FROM deals
         WHERE hs_last_activity_date IS NOT NULL
           AND julianday('now') - julianday(hs_last_activity_date) > 14`
      )
      .get().n;
    const comReuniaoFutura = db
      .prepare(
        `SELECT COUNT(*) AS n FROM deals
         WHERE hs_next_meeting_start IS NOT NULL AND hs_next_meeting_start > datetime('now')`
      )
      .get().n;
    res.json({ total, semAtividade14d, comReuniaoFutura });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
