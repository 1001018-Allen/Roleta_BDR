const { db } = require("./index");

function listCoordenadores() {
  return db.prepare("SELECT * FROM coordenadores ORDER BY ordem ASC").all();
}

function listBdrsByCoordenador(coordenadorId) {
  return db
    .prepare("SELECT * FROM bdrs WHERE coordenador_id = ? AND ativo = 1 ORDER BY ordem ASC")
    .all(coordenadorId);
}

function getCoordenadorById(id) {
  return db.prepare("SELECT * FROM coordenadores WHERE id = ?").get(id);
}

function getBdrById(id) {
  return db.prepare("SELECT * FROM bdrs WHERE id = ?").get(id);
}

const insertLead = db.prepare(`
  INSERT INTO leads
    (nome, empresa, email, form, deal_id, coordenador_id, bdr_id, hubspot_ok, slack_ok, dry_run, erros)
  VALUES (@nome, @empresa, @email, @form, @deal_id, @coordenador_id, @bdr_id, @hubspot_ok, @slack_ok, @dry_run, @erros)
`);

function saveLead(lead) {
  const info = insertLead.run({
    nome: lead.nome,
    empresa: lead.empresa,
    email: lead.email,
    form: lead.form,
    deal_id: lead.dealId || null,
    coordenador_id: lead.coordenadorId,
    bdr_id: lead.bdrId,
    hubspot_ok: lead.hubspotOk ? 1 : 0,
    slack_ok: lead.slackOk ? 1 : 0,
    dry_run: lead.dryRun ? 1 : 0,
    erros: lead.erros && lead.erros.length ? JSON.stringify(lead.erros) : null,
  });
  return info.lastInsertRowid;
}

function listRecentLeads(limit = 50) {
  return db
    .prepare(
      `SELECT l.*, c.nome AS coordenador_nome, b.nome AS bdr_nome
       FROM leads l
       LEFT JOIN coordenadores c ON c.id = l.coordenador_id
       LEFT JOIN bdrs b ON b.id = l.bdr_id
       ORDER BY l.id DESC
       LIMIT ?`
    )
    .all(limit);
}

/** Contagem de leads por BDR (para o dashboard/gráfico), incluindo BDRs com zero. */
function countLeadsByBdr() {
  return db
    .prepare(
      `SELECT b.id, b.nome, c.nome AS coordenador_nome, c.id AS coordenador_id,
              COUNT(l.id) AS total
       FROM bdrs b
       JOIN coordenadores c ON c.id = b.coordenador_id
       LEFT JOIN leads l ON l.bdr_id = b.id
       WHERE b.ativo = 1
       GROUP BY b.id
       ORDER BY c.ordem ASC, b.ordem ASC`
    )
    .all();
}

/** Contagem de leads por coordenador (para o dashboard/gráfico). */
function countLeadsByCoordenador() {
  return db
    .prepare(
      `SELECT c.id, c.nome, COUNT(l.id) AS total
       FROM coordenadores c
       LEFT JOIN leads l ON l.coordenador_id = c.id
       GROUP BY c.id
       ORDER BY c.ordem ASC`
    )
    .all();
}

module.exports = {
  listCoordenadores,
  listBdrsByCoordenador,
  getCoordenadorById,
  getBdrById,
  saveLead,
  listRecentLeads,
  countLeadsByBdr,
  countLeadsByCoordenador,
};
