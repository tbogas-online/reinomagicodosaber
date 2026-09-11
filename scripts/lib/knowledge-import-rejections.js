'use strict';

/**
 * Memória de curadoria: factos rejeitados no preview de importação
 * não voltam a ser propostos (mesmo id, mesma propriedade da entidade,
 * mesmo texto ou texto muito parecido da mesma entidade).
 */

const { jaccard, wikidataQid, JACCARD_THRESHOLD } = require('./knowledge-dedupe');

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function normalizeHash(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function factKeyFromRecord(row) {
  const fromMeta = String(row?.metadata?.factKey || row?.fact_key || row?.factKey || '').trim();
  if (fromMeta) return fromMeta.toLowerCase();
  const id = String(row?.knowledge_id || row?.knowledgeId || '');
  if (/-capital-q\d+/i.test(id)) return 'capital';
  const match = id.match(/-([a-z][a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function rejectionFingerprint(row) {
  const nested = row?.record && typeof row.record === 'object' ? row.record : row;
  const knowledgeId = String(nested?.knowledge_id || nested?.knowledgeId || row?.knowledgeId || '').trim();
  const source = String(nested?.source || row?.source || 'Wikidata').trim();
  const sourceId = String(nested?.source_id || nested?.sourceId || row?.sourceId || '').trim();
  const fact = String(nested?.fact || row?.fact || '').trim();
  const answer = String(nested?.answer || row?.answer || '').trim();
  const qid = wikidataQid(nested) || wikidataQid(row);
  return {
    knowledgeId,
    source,
    sourceId,
    qid,
    factKey: factKeyFromRecord(nested),
    factHash: normalizeHash(fact),
    answerHash: normalizeHash(answer),
    categoryN: Number(nested?.category_n || nested?.categoryN || row?.categoryN) || null,
    topic: clip(nested?.topic || row?.topic, 120),
    fact: clip(fact, 400),
    answer: clip(answer, 160),
  };
}

function toRejectionRow(row) {
  const fp = rejectionFingerprint(row);
  if (!fp.knowledgeId) return null;
  return {
    knowledge_id: fp.knowledgeId,
    source: fp.source || null,
    source_id: fp.sourceId || null,
    qid: fp.qid || null,
    fact_key: fp.factKey || null,
    fact_hash: fp.factHash || null,
    answer_hash: fp.answerHash || null,
    category_n: fp.categoryN,
    topic: fp.topic || null,
    fact: fp.fact || null,
    answer: fp.answer || null,
  };
}

function normalizeStoredRejection(row) {
  const fp = rejectionFingerprint(row);
  return {
    knowledgeId: fp.knowledgeId,
    source: fp.source,
    sourceId: fp.sourceId,
    qid: fp.qid,
    factKey: fp.factKey,
    factHash: fp.factHash,
    fact: fp.fact,
  };
}

function sourceKey(source, sourceId) {
  const src = String(source || '').trim();
  const id = String(sourceId || '').trim();
  return src && id ? `${src}|${id}` : '';
}

function qidFactKey(qid, factKey) {
  const q = String(qid || '').trim().toUpperCase();
  const key = String(factKey || '').trim().toLowerCase();
  return q && key ? `${q}|${key}` : '';
}

function buildRejectionIndex(rejections) {
  const knowledgeIds = new Set();
  const sourceKeys = new Set();
  const factHashes = new Set();
  const qidFactKeys = new Set();
  const factsByQid = new Map();

  for (const raw of rejections || []) {
    const row = normalizeStoredRejection(raw);
    if (row.knowledgeId) knowledgeIds.add(row.knowledgeId);
    const src = sourceKey(row.source, row.sourceId);
    if (src) sourceKeys.add(src);
    if (row.factHash) factHashes.add(row.factHash);
    const pair = qidFactKey(row.qid, row.factKey);
    if (pair) qidFactKeys.add(pair);
    if (row.qid && (row.fact || row.factHash)) {
      if (!factsByQid.has(row.qid)) factsByQid.set(row.qid, []);
      factsByQid.get(row.qid).push(row.fact || row.factHash);
    }
  }

  return {
    knowledgeIds,
    sourceKeys,
    factHashes,
    qidFactKeys,
    factsByQid,
  };
}

function matchRejectionReason(record, index) {
  const fp = rejectionFingerprint(record);
  if (fp.knowledgeId && index.knowledgeIds.has(fp.knowledgeId)) return 'same_id';
  const src = sourceKey(fp.source, fp.sourceId);
  if (src && index.sourceKeys.has(src)) return 'same_source';
  if (fp.factHash && index.factHashes.has(fp.factHash)) return 'same_fact';
  const pair = qidFactKey(fp.qid, fp.factKey);
  if (pair && index.qidFactKeys.has(pair)) return 'same_property';
  if (fp.qid && fp.fact) {
    for (const previous of index.factsByQid.get(fp.qid) || []) {
      if (jaccard(fp.fact, previous) >= JACCARD_THRESHOLD) return 'similar_fact';
    }
  }
  return '';
}

function filterRejectedRecords(records, rejections) {
  const index = buildRejectionIndex(rejections);
  const kept = [];
  const rejected = [];
  for (const record of records || []) {
    const reason = matchRejectionReason(record, index);
    if (reason) rejected.push({ record, reason });
    else kept.push(record);
  }
  return { kept, rejected };
}

module.exports = {
  JACCARD_THRESHOLD,
  normalizeHash,
  factKeyFromRecord,
  rejectionFingerprint,
  toRejectionRow,
  buildRejectionIndex,
  matchRejectionReason,
  filterRejectedRecords,
};
