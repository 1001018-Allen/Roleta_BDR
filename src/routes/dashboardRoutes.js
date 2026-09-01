const express = require("express");
const path = require("path");
const repo = require("../db/repository");
const { peekNextTeam } = require("../services/leadDistributionService");

const router = express.Router();

/** GET /dashboard — página HTML estática (lê dados via /dashboard/api/*). */
router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "dashboard.html"));
});

/** GET /dashboard/api/state — próximo coordenador/BDR sorteado (sem consumir a roleta). */
router.get("/api/state", (req, res, next) => {
  try {
    const { coordenador, bdr } = peekNextTeam();
    res.json({
      proximoCoordenador: coordenador.nome,
      proximoBdr: bdr.nome,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /dashboard/api/stats — contagem de leads por coordenador e por BDR. */
router.get("/api/stats", (req, res, next) => {
  try {
    res.json({
      porCoordenador: repo.countLeadsByCoordenador(),
      porBdr: repo.countLeadsByBdr(),
    });
  } catch (err) {
    next(err);
  }
});

/** GET /dashboard/api/leads — histórico recente de leads distribuídos. */
router.get("/api/leads", (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const leads = repo.listRecentLeads(limit).map((l) => ({
      ...l,
      erros: l.erros ? JSON.parse(l.erros) : [],
    }));
    res.json({ leads });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
