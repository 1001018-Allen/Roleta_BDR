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
 * Calcula a pontuação (0-100) de um negócio em Qualificação/Diagnóstico.
 *
 * Baseada no Playbook Pré-Vendas VOLL (Large/Enterprise, 2026):
 * - O checklist (Contato Certo, Fit de GMV, Dor Mapeada, Timing Real) são os
 *   4 pilares reais usados na Reunião de Diagnóstico pra decidir se o Deal
 *   está pronto pra Negociação — pesam a maior parte da nota.
 * - Contadores de atividade (WhatsApp, ligação, reunião) complementam,
 *   medindo esforço/engajamento, mas não substituem o checklist.
 * - Penalidade por tempo parado desconta pontos de leads esfriando.
 *
 * Pesos e critérios ficam em data/lead-score-config.json — editável sem
 * mexer em código quando o playbook for revisado.
 */
function computeScore(deal) {
  const cfg = loadConfig();
  const { criterios_checklist, atividade, penalidade_por_tempo, escala } = cfg;

  const checklist = {
    contato_certo: !!deal.score_contato_certo,
    fit_gmv: !!deal.score_fit_gmv,
    dor_mapeada: !!deal.score_dor_mapeada,
    timing_real: !!deal.score_timing_real,
  };
  const pontosChecklist = Object.entries(checklist).reduce(
    (soma, [chave, marcado]) => soma + (marcado ? criterios_checklist[chave].peso : 0),
    0
  );

  const pontosAtividade =
    deal.score_whatsapp_msgs * atividade.mensagem_whatsapp +
    deal.score_calls * atividade.ligacao +
    deal.score_meetings_held * atividade.reuniao_realizada +
    deal.score_manual_bonus * atividade.bonus_manual;

  const diasNaEtapa = daysSince(deal.hs_date_entered_stage);
  const diasExtras = Math.max(0, diasNaEtapa - penalidade_por_tempo.dias_tolerados_sem_penalidade);
  const penalidade = diasExtras * penalidade_por_tempo.pontos_por_dia_extra;

  const bruto = pontosChecklist + pontosAtividade - penalidade;
  const limitado = Math.min(escala.maximo, Math.max(escala.minimo, bruto));

  const criteriosAtendidos = Object.values(checklist).filter(Boolean).length;
  const totalCriterios = Object.keys(checklist).length;

  return {
    score: Math.round(limitado),
    checklist,
    criteriosAtendidos,
    totalCriterios,
    prontoParaNegociacao: criteriosAtendidos === totalCriterios,
    detalhe: { pontosChecklist, pontosAtividade, diasNaEtapa, diasExtras, penalidade },
  };
}

module.exports = { computeScore, loadConfig, daysSince };
