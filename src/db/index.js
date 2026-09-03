const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DB_FILE = path.join(__dirname, "..", "..", "data", "roleta.db");

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS coordenadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    slack_user_id TEXT,       -- TODO: preencher quando tivermos o ID do Slack do coordenador
    slack_channel_id TEXT,    -- TODO: preencher com o canal do Slack do time desse coordenador
    ordem INTEGER NOT NULL    -- posição fixa no round-robin de coordenadores
  );

  CREATE TABLE IF NOT EXISTS bdrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    coordenador_id INTEGER NOT NULL REFERENCES coordenadores(id),
    slack_user_id TEXT,          -- TODO: preencher quando tivermos o ID do Slack do BDR
    hubspot_owner_id TEXT,       -- TODO: preencher com o owner ID do HubSpot do BDR
    ativo INTEGER NOT NULL DEFAULT 1,
    ordem INTEGER NOT NULL       -- posição fixa no round-robin dentro do time do coordenador
  );

  CREATE TABLE IF NOT EXISTS round_robin_state (
    chave TEXT PRIMARY KEY,   -- 'coordenador' ou 'bdr:<coordenador_id>'
    last_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    nome TEXT NOT NULL,
    empresa TEXT NOT NULL,
    email TEXT NOT NULL,
    form TEXT NOT NULL,
    deal_id TEXT,
    coordenador_id INTEGER REFERENCES coordenadores(id),
    bdr_id INTEGER REFERENCES bdrs(id),
    hubspot_ok INTEGER NOT NULL DEFAULT 0,
    slack_ok INTEGER NOT NULL DEFAULT 0,
    dry_run INTEGER NOT NULL DEFAULT 0,
    erros TEXT,           -- JSON com a lista de erros por etapa, se houver
    origem TEXT NOT NULL DEFAULT 'manual',  -- 'manual' (webhook/test) ou 'slack-mkt-sales-leads'
    ja_atribuido INTEGER NOT NULL DEFAULT 0, -- 1 = o deal já tinha owner no HubSpot; não passou pela roleta
    owner_existente_id TEXT,    -- hubspot_owner_id encontrado quando ja_atribuido = 1
    owner_existente_nome TEXT,  -- nome do owner, quando ele NÃO é um dos nossos BDRs cadastrados
    segmento TEXT               -- ex: 'LARGE/ENTERPRISE', 'MID MARKET', 'KEY ACCOUNT' (quando vier do Slack)
  );

  -- Estado do "ingestor" que varre o canal do Slack em busca de novos leads
  -- (ex: timestamp da última mensagem já processada, por canal).
  CREATE TABLE IF NOT EXISTS ingest_state (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );

  -- Carteira de negócios (deals) por BDR — alimenta a página /carteira.
  -- Colunas com prefixo "hs_" vêm do HubSpot (via import de CSV) e são
  -- sobrescritas a cada import. As demais são editadas manualmente por aqui
  -- e NUNCA são tocadas pelo import — são a "camada" própria do time.
  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hubspot_deal_id TEXT UNIQUE,
    bdr_id INTEGER REFERENCES bdrs(id),
    hs_owner_name TEXT,            -- nome do owner como veio do CSV (fallback se não bater com nenhum bdr_id)
    hs_dealname TEXT NOT NULL,
    hs_pipeline TEXT,
    hs_dealstage TEXT NOT NULL,    -- rótulo da etapa, ex: "Cadência", "Qualificação"
    hs_amount REAL,
    hs_createdate TEXT,
    hs_date_entered_stage TEXT,
    hs_last_activity_date TEXT,
    hs_next_meeting_name TEXT,
    hs_next_meeting_start TEXT,
    hs_imported_at TEXT,

    -- Editável pelo time, nunca sobrescrito pelo import:
    forecast_close_date TEXT,
    forecast_amount REAL,
    forecast_confidence INTEGER,   -- 0-100
    forecast_updated_at TEXT,

    -- Checklist de qualificação real (etapa Diagnóstico/Qualificação do playbook
    -- Pré-Vendas VOLL — slides 14 e 40): os 4 pilares que decidem se o negócio
    -- está de fato pronto pra avançar. Cada um é 0/1 (marcado ou não).
    score_contato_certo INTEGER NOT NULL DEFAULT 0,
    score_fit_gmv INTEGER NOT NULL DEFAULT 0,
    score_dor_mapeada INTEGER NOT NULL DEFAULT 0,
    score_timing_real INTEGER NOT NULL DEFAULT 0,

    -- Contadores de atividade/esforço (complementam o checklist, pesam menos):
    score_whatsapp_msgs INTEGER NOT NULL DEFAULT 0,
    score_calls INTEGER NOT NULL DEFAULT 0,
    score_meetings_held INTEGER NOT NULL DEFAULT 0,
    score_manual_bonus INTEGER NOT NULL DEFAULT 0,
    score_updated_at TEXT,

    source TEXT NOT NULL DEFAULT 'manual', -- 'hubspot_csv' | 'manual'
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- Timeline de interações de cada negócio (histórico cronológico, nunca editado por cima).
  CREATE TABLE IF NOT EXISTS deal_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL DEFAULT 'geral', -- 'whatsapp' | 'ligacao' | 'reuniao' | 'email' | 'geral'
    texto TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Migração leve: quem já tinha rodado o app antes do checklist de qualificação
// (score_contato_certo etc.) ganhar essas colunas, o CREATE TABLE IF NOT EXISTS
// acima não altera a tabela existente. Adiciona só o que faltar, sem apagar dados.
const existingDealColumns = new Set(db.prepare("PRAGMA table_info(deals)").all().map((c) => c.name));
const NEW_DEAL_COLUMNS = {
  score_contato_certo: "INTEGER NOT NULL DEFAULT 0",
  score_fit_gmv: "INTEGER NOT NULL DEFAULT 0",
  score_dor_mapeada: "INTEGER NOT NULL DEFAULT 0",
  score_timing_real: "INTEGER NOT NULL DEFAULT 0",
};
for (const [column, definition] of Object.entries(NEW_DEAL_COLUMNS)) {
  if (!existingDealColumns.has(column)) {
    db.exec(`ALTER TABLE deals ADD COLUMN ${column} ${definition};`);
  }
}

module.exports = { db, DB_FILE };
