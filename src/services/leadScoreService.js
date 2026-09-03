const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "..", "data", "lead-score-config.json");

/** Lê o arquivo de configuração toda vez (é pequeno e assim dá pra editar sem reiniciar). */
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
}

function daysSince(isoDate) {
  if (!isoDate) return 0;
  const diffMs = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Calcula a pontuação (0-100, provisória) de um negócio em Qualificação.
 * Fórmula e pesos ficam em data/lead-score-config.json — ajustar lá quando
 * o playbook oficial do time de BDR definir os critérios reais.
 */
function computeScore(deal) {
  const cfg = loadConfig();
  const { pesos, penalidade_por_tempo, escala } = cfg;

  const pontosBase =
    deal.score_whatsapp_msgs * pesos.mensagem_whatsapp +
    deal.score_calls * pesos.ligacao +
    deal.score_meetings_held * pesos.reuniao_realizada +
    deal.score_manual_bonus * pesos.bonus_manual;

  const diasNaEtapa = daysSince(deal.hs_date_entered_stage);
  const diasExtras = Math.max(0, diasNaEtapa - penalidade_por_tempo.dias_tolerados_sem_penalidade);
  const penalidade = diasExtras * penalidade_por_tempo.pontos_por_dia_extra;

  const bruto = pontosBase - penalidade;
  const limitado = Math.min(escala.maximo, Math.max(escala.minimo, bruto));

  return {
    score: Math.round(limitado),
    detalhe: { pontosBase, diasNaEtapa, diasExtras, penalidade },
    pesos,
    rascunho: !!cfg._rascunho,
  };
}

module.exports = { computeScore, loadConfig, daysSince };
