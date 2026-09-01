const express = require("express");
const { distributeLead } = require("../services/leadDistributionService");

const router = express.Router();

/**
 * Valida o payload mínimo esperado do lead vindo do HubSpot.
 * Campos obrigatórios: name (nome), company (empresa), email, form.
 * dealId é opcional (ver hubspotService.resolveDealId).
 */
function parseLeadPayload(body) {
  const { name, company, email, form, dealId } = body || {};
  const missing = ["name", "company", "email", "form"].filter((field) => !body?.[field]);

  if (missing.length > 0) {
    const err = new Error(`Campos obrigatórios ausentes no payload: ${missing.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  return { name, company, email, form, dealId };
}

/**
 * POST /webhook/hubspot-lead
 * Endpoint chamado pelo HubSpot (workflow/webhook) quando um novo lead
 * inbound é criado.
 */
router.post("/hubspot-lead", async (req, res, next) => {
  try {
    const lead = parseLeadPayload(req.body);
    const result = await distributeLead(lead);

    const hasErrors = result.errors.length > 0;
    res.status(hasErrors ? 207 : 200).json({
      ok: !hasErrors,
      message: hasErrors
        ? "Lead distribuído com falhas parciais, veja 'errors'."
        : "Lead distribuído com sucesso.",
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
