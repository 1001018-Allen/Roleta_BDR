const repo = require("../db/carteiraRepository");
const { db } = require("../db/index");

/** Remove acentos e baixa a caixa, pra casar cabeçalhos de forma tolerante. */
function normalizeHeader(h) {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// Cada campo aceita várias variações de nome de coluna (export PT-BR/EN do HubSpot).
const FIELD_ALIASES = {
  hubspot_deal_id: ["id do negocio", "record id", "deal id", "hs_object_id"],
  hs_dealname: ["nome do negocio", "deal name", "negocio"],
  hs_owner_name: ["proprietario do negocio", "deal owner", "owner"],
  hs_pipeline: ["pipeline"],
  hs_dealstage: ["etapa do negocio", "deal stage", "fase do negocio"],
  hs_amount: ["valor", "amount", "valor do negocio"],
  hs_createdate: ["data de criacao", "create date", "data de criacao do negocio"],
  hs_date_entered_stage: [
    "data que entrou na fase atual",
    "date entered current stage",
    "data que entrou na etapa atual",
  ],
  hs_last_activity_date: ["data da ultima atividade", "last activity date"],
  hs_next_meeting_name: ["nome da proxima reuniao", "next meeting name"],
  hs_next_meeting_start: [
    "hora de inicio da proxima reuniao",
    "next meeting start time",
    "data da proxima reuniao",
  ],
};

function detectDelimiter(headerLine) {
  return headerLine.split(";").length > headerLine.split(",").length ? ";" : ",";
}

/** Parser de CSV simples com suporte a campos entre aspas (inclui vírgula/; dentro do valor). */
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function buildColumnMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const map = {}; // fieldName -> column index
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Importa negócios a partir de um CSV exportado do HubSpot (colado como texto).
 * Faz upsert por "ID do negócio" quando presente; senão cria negócio manual novo.
 * Retorna um resumo { total, criados, atualizados, semColunaEtapa, erros }.
 */
function importDealsFromCsv(csvText) {
  const firstLine = csvText.split(/\r?\n/, 1)[0] || "";
  const delimiter = detectDelimiter(firstLine);
  const rows = parseCsv(csvText, delimiter);
  if (rows.length < 2) {
    return { total: 0, criados: 0, atualizados: 0, erros: ["CSV vazio ou sem linhas de dados."] };
  }

  const [headerRow, ...dataRows] = rows;
  const colMap = buildColumnMap(headerRow);
  const erros = [];

  if (colMap.hs_dealname === undefined) {
    erros.push(
      'Não encontrei a coluna "Nome do negócio"/"Deal Name" no CSV — confira o cabeçalho exportado do HubSpot.'
    );
  }
  if (colMap.hs_dealstage === undefined) {
    erros.push('Não encontrei a coluna "Etapa do negócio"/"Deal Stage" no CSV.');
  }
  if (erros.length) {
    return { total: 0, criados: 0, atualizados: 0, erros };
  }

  const get = (row, field) => (colMap[field] !== undefined ? (row[colMap[field]] || "").trim() : "");

  let criados = 0;
  let atualizados = 0;
  const nowIso = new Date().toISOString();

  for (const row of dataRows) {
    const dealname = get(row, "hs_dealname");
    if (!dealname) continue;

    const hubspotDealId = get(row, "hubspot_deal_id") || null;
    const ownerName = get(row, "hs_owner_name") || null;
    const bdrId = repo.findBdrIdByOwnerName(ownerName);

    const existing = hubspotDealId
      ? db.prepare("SELECT id FROM deals WHERE hubspot_deal_id = ?").get(hubspotDealId)
      : null;

    repo.upsertDealFromCsv({
      hubspot_deal_id: hubspotDealId,
      bdr_id: bdrId,
      hs_owner_name: ownerName,
      hs_dealname: dealname,
      hs_pipeline: get(row, "hs_pipeline") || null,
      hs_dealstage: get(row, "hs_dealstage") || "Sem etapa",
      hs_amount: parseAmount(get(row, "hs_amount")),
      hs_createdate: get(row, "hs_createdate") || null,
      hs_date_entered_stage: get(row, "hs_date_entered_stage") || null,
      hs_last_activity_date: get(row, "hs_last_activity_date") || null,
      hs_next_meeting_name: get(row, "hs_next_meeting_name") || null,
      hs_next_meeting_start: get(row, "hs_next_meeting_start") || null,
      hs_imported_at: nowIso,
    });

    if (existing) atualizados++;
    else criados++;
  }

  return { total: criados + atualizados, criados, atualizados, erros: [] };
}

module.exports = { importDealsFromCsv, parseCsv, detectDelimiter };
