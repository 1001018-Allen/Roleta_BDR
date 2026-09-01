const fs = require("fs");
const path = require("path");
const { db } = require("./index");

const SEED_FILE = path.join(__dirname, "..", "..", "data", "bdrs-seed.json");

/**
 * Popula/atualiza coordenadores e BDRs a partir de data/bdrs-seed.json,
 * incluindo os IDs de Slack/HubSpot já resolvidos.
 *
 * Idempotente: pode rodar de novo (ex: quando a lista oficial chegar, ou
 * quando resolver mais IDs) sem duplicar registros — faz upsert por nome.
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
    INSERT INTO coordenadores (nome, slack_user_id, slack_channel_id, ordem)
    VALUES (@nome, @slack_user_id, @slack_channel_id, @ordem)
    ON CONFLICT(nome) DO UPDATE SET
      slack_user_id = excluded.slack_user_id,
      slack_channel_id = excluded.slack_channel_id,
      ordem = excluded.ordem
  `);
  const getCoordenadorId = db.prepare("SELECT id FROM coordenadores WHERE nome = ?");
  const findBdr = db.prepare("SELECT id FROM bdrs WHERE nome = ? AND coordenador_id = ?");
  const insertBdr = db.prepare(`
    INSERT INTO bdrs (nome, coordenador_id, slack_user_id, hubspot_owner_id, ativo, ordem)
    VALUES (@nome, @coordenador_id, @slack_user_id, @hubspot_owner_id, 1, @ordem)
  `);
  const updateBdr = db.prepare(`
    UPDATE bdrs
    SET slack_user_id = @slack_user_id, hubspot_owner_id = @hubspot_owner_id,
        ordem = @ordem, ativo = 1
    WHERE id = @id
  `);

  data.coordenadores.forEach((coordenador, index) => {
    upsertCoordenador.run({
      nome: coordenador.nome,
      slack_user_id: coordenador.slack_user_id || null,
      slack_channel_id: coordenador.slack_channel_id || null,
      ordem: index,
    });
  });

  const coordenadorIdByNome = {};
  for (const coordenador of data.coordenadores) {
    coordenadorIdByNome[coordenador.nome] = getCoordenadorId.get(coordenador.nome).id;
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

    const params = {
      nome: bdr.nome,
      coordenador_id: coordenadorId,
      slack_user_id: bdr.slack_user_id || null,
      hubspot_owner_id: bdr.hubspot_owner_id || null,
      ordem,
    };

    const existing = findBdr.get(bdr.nome, coordenadorId);
    if (existing) {
      updateBdr.run({ ...params, id: existing.id });
    } else {
      insertBdr.run(params);
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
