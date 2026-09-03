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

const AI_PROVIDER_SOURCES = new Set(['ai', 'bank-replenish', 'repo-ai']);

function isAiProviderTelemetryEvent(ev) {
  const src = String(ev?.source || 'ai');
  return AI_PROVIDER_SOURCES.has(src) && String(ev?.provider || '').trim().length > 0;
}

function enrichProviderBucket(raw = {}) {
  const total = Number(raw.total) || 0;
  const accepted = Number(raw.accepted) || 0;
  const rejected = Number(raw.rejected) || 0;
  const parseErrors = Number(raw.parseErrors) || 0;
  const apiErrors = Number(raw.apiErrors) || 0;
  const attemptSum = Number(raw.attemptSum) || 0;
  const attemptCount = Number(raw.attemptCount) || 0;
  const failures = rejected + parseErrors + apiErrors;
  return {
    total,
    accepted,
    rejected,
    parseErrors,
    apiErrors,
    attemptSum,
    attemptCount,
    acceptanceRate: total ? accepted / total : 0,
    rejectionRate: total ? failures / total : 0,
    avgAttempts: attemptCount ? attemptSum / attemptCount : null,
  };
}

function rankAiProviders(byProvider, { minSamplesForBest = 3 } = {}) {
  const ranking = Object.entries(byProvider || {})
    .map(([id, raw]) => ({ id, ...enrichProviderBucket(raw) }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => {
      if (b.acceptanceRate !== a.acceptanceRate) return b.acceptanceRate - a.acceptanceRate;
      const aAttempts = a.avgAttempts ?? 99;
      const bAttempts = b.avgAttempts ?? 99;
      if (aAttempts !== bAttempts) return aAttempts - bAttempts;
      return b.total - a.total;
    });

  const qualified = ranking.filter((entry) => entry.total >= minSamplesForBest);
  return {
    ranking,
    best: qualified[0] || null,
    minSamplesForBest,
  };
}

function enrichSummaryWithProviderInsights(summary) {
  const next = summary || {};
  const enriched = {};
  for (const [id, bucket] of Object.entries(next.byProvider || {})) {
    enriched[id] = enrichProviderBucket(bucket);
  }
  next.byProvider = enriched;
  next.providerInsights = rankAiProviders(enriched);
  return next;
}

module.exports = {
  CAT20_NON_AI_TARGET,
  REPOSITORY_SOURCES,
  AI_PROVIDER_SOURCES,
  isRepositoryDeliverySource,
  isNonAiDeliverySource,
  isAiFreeDeliverySource,
  isAiProviderTelemetryEvent,
  computeCategoryDelivery,
  enrichSummaryWithCategoryDelivery,
  enrichProviderBucket,
  rankAiProviders,
  enrichSummaryWithProviderInsights,
};
