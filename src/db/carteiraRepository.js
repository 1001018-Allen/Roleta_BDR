const { db } = require("./index");

/** Lista todos os negócios abertos/fechados com nome do BDR já resolvido. */
function listDeals({ bdrId, dealstage } = {}) {
  const clauses = [];
  const params = {};
  if (bdrId) {
    clauses.push("d.bdr_id = @bdrId");
    params.bdrId = bdrId;
  }
  if (dealstage) {
    clauses.push("d.hs_dealstage = @dealstage");
    params.dealstage = dealstage;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT d.*, b.nome AS bdr_nome
       FROM deals d
       LEFT JOIN bdrs b ON b.id = d.bdr_id
       ${where}
       ORDER BY d.hs_last_activity_date DESC`
    )
    .all(params);
}

function getDealById(id) {
  return db
    .prepare(
      `SELECT d.*, b.nome AS bdr_nome
       FROM deals d
       LEFT JOIN bdrs b ON b.id = d.bdr_id
       WHERE d.id = ?`
    )
    .get(id);
}

/** Busca um BDR pelo nome do owner vindo do CSV (case-insensitive, ignora acentuação simples). */
function findBdrIdByOwnerName(ownerName) {
  if (!ownerName) return null;
  const row = db
    .prepare("SELECT id FROM bdrs WHERE LOWER(nome) = LOWER(?)")
    .get(ownerName.trim());
  return row ? row.id : null;
}

function findBdrIdByHubspotOwnerId(hubspotOwnerId) {
  if (!hubspotOwnerId) return null;
  const row = db
    .prepare("SELECT id FROM bdrs WHERE hubspot_owner_id = ?")
    .get(String(hubspotOwnerId));
  return row ? row.id : null;
}

const upsertHubspotDeal = db.prepare(`
  INSERT INTO deals (
    hubspot_deal_id, bdr_id, hs_owner_name, hs_dealname, hs_pipeline, hs_dealstage,
    hs_amount, hs_createdate, hs_date_entered_stage, hs_last_activity_date,
    hs_next_meeting_name, hs_next_meeting_start, hs_imported_at, source, updated_at
  ) VALUES (
    @hubspot_deal_id, @bdr_id, @hs_owner_name, @hs_dealname, @hs_pipeline, @hs_dealstage,
    @hs_amount, @hs_createdate, @hs_date_entered_stage, @hs_last_activity_date,
    @hs_next_meeting_name, @hs_next_meeting_start, @hs_imported_at, 'hubspot_csv',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(hubspot_deal_id) DO UPDATE SET
    bdr_id = excluded.bdr_id,
    hs_owner_name = excluded.hs_owner_name,
    hs_dealname = excluded.hs_dealname,
    hs_pipeline = excluded.hs_pipeline,
    hs_dealstage = excluded.hs_dealstage,
    hs_amount = excluded.hs_amount,
    hs_createdate = excluded.hs_createdate,
    hs_date_entered_stage = excluded.hs_date_entered_stage,
    hs_last_activity_date = excluded.hs_last_activity_date,
    hs_next_meeting_name = excluded.hs_next_meeting_name,
    hs_next_meeting_start = excluded.hs_next_meeting_start,
    hs_imported_at = excluded.hs_imported_at,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  -- Repare que forecast_*, score_* e source NÃO são tocados no UPDATE: são a
  -- camada editável do time e sobrevivem a qualquer reimportação.
`);

function upsertDealFromCsv(deal) {
  return upsertHubspotDeal.run(deal);
}

function updateForecast(id, { forecast_close_date, forecast_amount, forecast_confidence }) {
  db.prepare(
    `UPDATE deals SET
       forecast_close_date = @forecast_close_date,
       forecast_amount = @forecast_amount,
       forecast_confidence = @forecast_confidence,
       forecast_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = @id`
  ).run({ id, forecast_close_date, forecast_amount, forecast_confidence });
}

function updateScoreInputs(
  id,
  {
    score_contato_certo,
    score_fit_gmv,
    score_dor_mapeada,
    score_timing_real,
    score_whatsapp_msgs,
    score_calls,
    score_meetings_held,
    score_manual_bonus,
  }
) {
  db.prepare(
    `UPDATE deals SET
       score_contato_certo = @score_contato_certo,
       score_fit_gmv = @score_fit_gmv,
       score_dor_mapeada = @score_dor_mapeada,
       score_timing_real = @score_timing_real,
       score_whatsapp_msgs = @score_whatsapp_msgs,
       score_calls = @score_calls,
       score_meetings_held = @score_meetings_held,
       score_manual_bonus = @score_manual_bonus,
       score_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = @id`
  ).run({
    id,
    score_contato_certo,
    score_fit_gmv,
    score_dor_mapeada,
    score_timing_real,
    score_whatsapp_msgs,
    score_calls,
    score_meetings_held,
    score_manual_bonus,
  });
}

function createManualDeal(deal) {
  const info = db
    .prepare(
      `INSERT INTO deals (bdr_id, hs_owner_name, hs_dealname, hs_pipeline, hs_dealstage, hs_amount, source)
       VALUES (@bdr_id, @hs_owner_name, @hs_dealname, @hs_pipeline, @hs_dealstage, @hs_amount, 'manual')`
    )
    .run(deal);
  return info.lastInsertRowid;
}

function addNote(dealId, { tipo, texto }) {
  const info = db
    .prepare(`INSERT INTO deal_notes (deal_id, tipo, texto) VALUES (?, ?, ?)`)
    .run(dealId, tipo || "geral", texto);
  db.prepare(`UPDATE deals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(dealId);
  return info.lastInsertRowid;
}

function listNotes(dealId) {
  return db
    .prepare("SELECT * FROM deal_notes WHERE deal_id = ? ORDER BY criado_em DESC")
    .all(dealId);
}

module.exports = {
  listDeals,
  getDealById,
  findBdrIdByOwnerName,
  findBdrIdByHubspotOwnerId,
  upsertDealFromCsv,
  updateForecast,
  updateScoreInputs,
  createManualDeal,
  addNote,
  listNotes,
};
