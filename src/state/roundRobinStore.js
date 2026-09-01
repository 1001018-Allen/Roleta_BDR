const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "..", "data", "round-robin-state.json");

/** Garante que o arquivo de estado existe, criando com valor inicial se necessário. */
function ensureStateFile() {
  if (!fs.existsSync(STATE_FILE)) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastIndex: -1 }, null, 2));
  }
}

function readState() {
  ensureStateFile();
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.lastIndex !== "number") {
      throw new Error("Campo lastIndex inválido no arquivo de estado");
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `Não foi possível ler o arquivo de estado do round-robin (${STATE_FILE}): ${err.message}`
    );
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Calcula e persiste o índice do próximo time no round-robin.
 * @param {number} totalTeams quantidade de times cadastrados (ex: 3)
 * @returns {number} índice do time sorteado (0-based)
 */
function getNextTeamIndex(totalTeams) {
  if (!Number.isInteger(totalTeams) || totalTeams <= 0) {
    throw new Error("totalTeams precisa ser um inteiro positivo");
  }

  const state = readState();
  const nextIndex = (state.lastIndex + 1) % totalTeams;
  writeState({ lastIndex: nextIndex });
  return nextIndex;
}

/**
 * Mostra qual seria o próximo índice sem avançar/persistir o round-robin.
 * Útil para inspeção (ex: endpoint de teste) sem efeitos colaterais.
 */
function peekNextTeamIndex(totalTeams) {
  if (!Number.isInteger(totalTeams) || totalTeams <= 0) {
    throw new Error("totalTeams precisa ser um inteiro positivo");
  }
  const state = readState();
  return (state.lastIndex + 1) % totalTeams;
}

module.exports = { getNextTeamIndex, peekNextTeamIndex, STATE_FILE };
