'use strict';

const CAT20_REPO_FORMATS = new Set(['ADIVINHA', 'CURIOSIDADE', 'VERDADEIRO_FALSO']);
const REPOSITORY_SOURCES = new Set(['repository', 'repo-direct', 'repo-ai']);

function cat20RequiresKnowledgeId(categoryN, formatId) {
  return Number(categoryN) === 20 && CAT20_REPO_FORMATS.has(String(formatId || ''));
}

function isRepositoryTelemetrySource(source) {
  return REPOSITORY_SOURCES.has(String(source || ''));
}

function assertCat20Delivery(question, categoryN, formatId) {
  if (!cat20RequiresKnowledgeId(categoryN, formatId)) {
    return { ok: true, blocked: false };
  }

  const kid = String(question?.knowledgeId || question?.knowledge_id || '').trim();
  if (kid) return { ok: true, blocked: false };

  if (question?.a === '—' || question?.source === 'local') {
    return { ok: true, blocked: false, stockFallback: true };
  }

  return { ok: false, blocked: true, reason: 'KR14_MISSING_KNOWLEDGE_ID' };
}

function bankRowMissingKnowledgeId(categoryN, row) {
  if (Number(categoryN) !== 20) return false;
  const fmt = String(row?.format || '');
  if (!CAT20_REPO_FORMATS.has(fmt)) return false;
  return !String(row?.knowledge_id || row?.knowledgeId || '').trim();
}

function buildCat20StockFallbackQuestion(engine) {
  const FORMAT_IDS = engine?.FORMAT_IDS || { ESCOLHA_MULTIPLA: 'ESCOLHA_MULTIPLA' };
  return {
    q: 'Ainda não há perguntas verificadas disponíveis para esta categoria e faixa etária.',
    a: '—',
    options: ['—', '—', '—', '—'],
    source: 'local',
    format: FORMAT_IDS.ESCOLHA_MULTIPLA,
    formatLabel: 'Sem stock',
  };
}

module.exports = {
  CAT20_REPO_FORMATS,
  cat20RequiresKnowledgeId,
  isRepositoryTelemetrySource,
  assertCat20Delivery,
  bankRowMissingKnowledgeId,
  buildCat20StockFallbackQuestion,
};
