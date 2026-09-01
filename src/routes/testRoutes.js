const express = require("express");
const { distributeLead, peekNextTeam } = require("../services/leadDistributionService");

const router = express.Router();

const SAMPLE_LEAD = {
  name: "Lead de Teste",
  company: "Empresa Exemplo Ltda",
  email: "lead.teste@exemplo.com",
  form: "Formulário Inbound - Teste",
};

/**
 * GET /test/health
 * Health-check simples, sem exercitar nenhuma lógica de negócio.
 */
router.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/**
 * POST /test/simulate-lead
 * Roda o fluxo completo (round-robin + HubSpot + Slack) com um lead de
 * exemplo, permitindo sobrescrever qualquer campo via body.
 *
 * Dica: rode com DRY_RUN=true no .env para ver nos logs o que seria feito
 * no HubSpot e no Slack, sem precisar de tokens/IDs reais preenchidos em
 * data/bdrs-seed.json.
 */
router.post("/simulate-lead", async (req, res, next) => {
  try {
    const lead = { ...SAMPLE_LEAD, ...req.body };
    const result = await distributeLead(lead);
    res.json({ ok: result.errors.length === 0, lead, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /test/next-team
 * Só mostra qual seria o próximo coordenador+BDR sorteado pelo round-robin,
 * sem chamar HubSpot/Slack e sem consumir o índice (chamadas repetidas
 * retornam o mesmo resultado, diferente do /simulate-lead que avança a roleta).
 */
router.get("/next-team", (req, res, next) => {
  try {
    const { coordenador, bdr } = peekNextTeam();
    res.json({
      next: {
        coordenador: { id: coordenador.id, nome: coordenador.nome },
        bdr: { id: bdr.id, nome: bdr.nome },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
