const fs = require("fs");
const path = require("path");
const { db } = require("./index");

const SEED_FILE = path.join(__dirname, "..", "..", "data", "bdrs-seed.json");

/**
 * Popula/atualiza coordenadores e BDRs a partir de data/bdrs-seed.json.
 * Idempotente: pode rodar de novo (ex: quando a lista oficial chegar) sem
 * duplicar registros — faz upsert por nome.
 *
 * Não mexe em `leads` nem em `round_robin_state`: o histórico e a posição
 * atual da roleta são preservados mesmo re-rodando o seed.
 */
function seed() {
  const raw = fs.readFileSync(SEED_FILE, "utf-8");
  const data = JSON.parse(raw);

  if (data._rascunho) {
    console.log(
      "[seed] Atenção: data/bdrs-seed.json está marcado como RASCUNHO " +
        "(lista de BDRs/coordenadores ainda não é oficial)."
    );
  }

  const upsertCoordenador = db.prepare(`
    INSERT INTO coordenadores (nome, ordem) VALUES (?, ?)
    ON CONFLICT(nome) DO UPDATE SET ordem = excluded.ordem
  `);
  const getCoordenadorId = db.prepare("SELECT id FROM coordenadores WHERE nome = ?");
  const findBdr = db.prepare("SELECT id FROM bdrs WHERE nome = ? AND coordenador_id = ?");
  const insertBdr = db.prepare(`
    INSERT INTO bdrs (nome, coordenador_id, ativo, ordem) VALUES (?, ?, 1, ?)
  `);
  const updateBdrOrdem = db.prepare(`
    UPDATE bdrs SET ordem = ?, ativo = 1 WHERE id = ?
  `);

  data.coordenadores.forEach((nome, index) => {
    upsertCoordenador.run(nome, index);
  });

  const coordenadorIdByNome = {};
  for (const nome of data.coordenadores) {
    coordenadorIdByNome[nome] = getCoordenadorId.get(nome).id;
  }

  const ordemPorCoordenador = {};
  data.bdrs.forEach((bdr) => {
    const coordenadorId = coordenadorIdByNome[bdr.coordenador];
    if (!coordenadorId) {
      throw new Error(
        `BDR "${bdr.nome}" referencia coordenador "${bdr.coordenador}" que não está ` +
          "na lista de coordenadores do seed."
      );
    }
    const ordem = ordemPorCoordenador[coordenadorId] || 0;
    ordemPorCoordenador[coordenadorId] = ordem + 1;

    const existing = findBdr.get(bdr.nome, coordenadorId);
    if (existing) {
      updateBdrOrdem.run(ordem, existing.id);
    } else {
      insertBdr.run(bdr.nome, coordenadorId, ordem);
    }
  });

  console.log(
    `[seed] OK: ${data.coordenadores.length} coordenadores, ${data.bdrs.length} BDRs.`
  );
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
