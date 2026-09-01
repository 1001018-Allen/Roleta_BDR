const { db } = require("../db");

const getState = db.prepare("SELECT last_index FROM round_robin_state WHERE chave = ?");
const upsertState = db.prepare(`
  INSERT INTO round_robin_state (chave, last_index) VALUES (?, ?)
  ON CONFLICT(chave) DO UPDATE SET last_index = excluded.last_index
`);

/** Avança e persiste o índice de uma chave de round-robin (0-based). */
function advance(chave, total) {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error(`total inválido para round-robin da chave "${chave}": ${total}`);
  }
  const row = getState.get(chave);
  const lastIndex = row ? row.last_index : -1;
  const nextIndex = (lastIndex + 1) % total;
  upsertState.run(chave, nextIndex);
  return nextIndex;
}

/** Só consulta qual seria o próximo índice, sem persistir/avançar. */
function peek(chave, total) {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error(`total inválido para round-robin da chave "${chave}": ${total}`);
  }
  const row = getState.get(chave);
  const lastIndex = row ? row.last_index : -1;
  return (lastIndex + 1) % total;
}

const COORDENADOR_KEY = "coordenador";
const bdrKey = (coordenadorId) => `bdr:${coordenadorId}`;

module.exports = {
  advanceCoordenadorIndex: (total) => advance(COORDENADOR_KEY, total),
  peekCoordenadorIndex: (total) => peek(COORDENADOR_KEY, total),
  advanceBdrIndex: (coordenadorId, total) => advance(bdrKey(coordenadorId), total),
  peekBdrIndex: (coordenadorId, total) => peek(bdrKey(coordenadorId), total),
};
