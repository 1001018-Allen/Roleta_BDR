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
`);

module.exports = { db, DB_FILE };
