'use strict';

const REPOSITORY_SOURCES = new Set(['repository', 'repo-direct', 'repo-ai']);
const CAT20_NON_AI_TARGET = 0.95;

function isRepositoryDeliverySource(source) {
  return REPOSITORY_SOURCES.has(String(source || ''));
}

function isNonAiDeliverySource(source) {
  const src = String(source || 'ai');
  return src !== 'ai' && src !== 'repo-ai';
}

function isAiFreeDeliverySource(source) {
  return String(source || 'ai') === 'ai';
}

function computeCategoryDelivery(events, categoryN, { targetNonAiShare = CAT20_NON_AI_TARGET } = {}) {
  const accepted = (events || []).filter(
    (ev) => ev.outcome === 'accepted' && Number(ev.category) === Number(categoryN),
  );
  const total = accepted.length;
  if (!total) {
    return {
      category: Number(categoryN),
      accepted: 0,
      nonAi: 0,
      nonAiShare: 0,
      repository: 0,
      repositoryShare: 0,
      aiFree: 0,
      aiFreeShare: 0,
      bank: 0,
      bankShare: 0,
      meetsNonAiTarget: false,
      targetNonAiShare,
    };
  }

  let nonAi = 0;
  let repository = 0;
  let aiFree = 0;
  let bank = 0;

  for (const ev of accepted) {
    const src = ev.source || 'ai';
    if (isNonAiDeliverySource(src)) nonAi += 1;
    if (isRepositoryDeliverySource(src)) repository += 1;
    if (isAiFreeDeliverySource(src)) aiFree += 1;
    if (src === 'bank') bank += 1;
  }

  const nonAiShare = nonAi / total;
  return {
    category: Number(categoryN),
    accepted: total,
    nonAi,
    nonAiShare,
    repository,
    repositoryShare: repository / total,
    aiFree,
    aiFreeShare: aiFree / total,
    bank,
    bankShare: bank / total,
    meetsNonAiTarget: nonAiShare >= targetNonAiShare,
    targetNonAiShare,
  };
}

function enrichSummaryWithCategoryDelivery(summary, events) {
  const next = summary || {};
  next.cat20Delivery = computeCategoryDelivery(events, 20);
  return next;
}

module.exports = {
  CAT20_NON_AI_TARGET,
  REPOSITORY_SOURCES,
  isRepositoryDeliverySource,
  isNonAiDeliverySource,
  isAiFreeDeliverySource,
  computeCategoryDelivery,
  enrichSummaryWithCategoryDelivery,
};
