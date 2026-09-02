'use strict';

const { normalizePtPtRecord } = require('./pt-pt-normalize');
const { evaluateRecordPolicy } = require('./knowledge-policy');

const AGE_BANDS = ['6-9', '10-15', '15+'];

function todayPt() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeRecord(raw) {
  const r = raw || {};
  const ageBands = r.age_bands || r.ageBands || ['6-9', '10-15', '15+'];
  const allowedFormats = r.allowed_formats || r.allowedFormats || ['RESPOSTA_DIRETA'];
  const pt = normalizePtPtRecord({
    fact: r.fact,
    answer: r.answer,
    clues: Array.isArray(r.clues) ? r.clues : [],
  });
  return {
    knowledge_id: String(r.knowledge_id || r.knowledgeId || '').trim(),
    category_n: Number(r.category_n ?? r.category ?? 0),
    topic: String(r.topic || '').trim(),
    subtopic: r.subtopic ? String(r.subtopic).trim() : null,
    fact: pt.fact || String(r.fact || '').trim(),
    answer: pt.answer || String(r.answer || '').trim(),
    clues: pt.clues.length ? pt.clues : (Array.isArray(r.clues) ? r.clues.map(String) : []),
    statement: r.statement ? String(r.statement) : null,
    is_true: r.is_true ?? r.isTrue ?? null,
    source: String(r.source || '').trim(),
    source_id: String(r.source_id || r.sourceId || '').trim(),
    source_url: r.source_url || r.sourceUrl || null,
    license: r.license || null,
    confidence: r.confidence ?? 0.9,
    priority_pt: r.priority_pt ?? r.priorityPt ?? null,
    age_bands: ageBands.map(String),
    allowed_formats: allowedFormats.map(String),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    verified_at: r.verified_at || r.verifiedAt || todayPt(),
    verified_by: r.verified_by || r.verifiedBy || 'daily-knowledge-import',
    metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
  };
}

function validateRecord(rec) {
  const missing = [];
  if (!rec.knowledge_id) missing.push('knowledge_id');
  if (!rec.category_n || rec.category_n < 1 || rec.category_n > 20) missing.push('category_n');
  if (!rec.topic) missing.push('topic');
  if (!rec.fact) missing.push('fact');
  if (!rec.answer) missing.push('answer');
  if (!rec.source) missing.push('source');
  if (!rec.source_id) missing.push('source_id');
  if (!rec.age_bands?.length) missing.push('age_bands');
  if (!rec.allowed_formats?.length) missing.push('allowed_formats');
  const formats = rec.allowed_formats || [];
  if (formats.includes('ADIVINHA')) {
    if (!Array.isArray(rec.clues) || rec.clues.length < 2) missing.push('clues');
  }

  const formatId = formats.includes('ADIVINHA')
    ? 'ADIVINHA'
    : (formats.includes('VERDADEIRO_FALSO') ? 'VERDADEIRO_FALSO' : (formats[0] || null));
  const policy = evaluateRecordPolicy(
    {
      category: rec.category_n,
      source: rec.source,
      confidence: rec.confidence,
    },
    { categoryN: rec.category_n, formatId },
  );
  if (!policy.ok) missing.push(`policy_${policy.reason}`);

  return missing;
}

function effectiveItemStatus(item, overrides = {}) {
  const override = overrides[item.queueId];
  if (override?.status) return override.status;
  return item.status || 'pending';
}

function mergeQueueWithOverrides(queue, overrides = {}) {
  return (queue.items || []).map((item) => ({
    ...item,
    status: effectiveItemStatus(item, overrides),
    importedAt: overrides[item.queueId]?.importedAt || item.importedAt || null,
  }));
}

function pickItemsForToday(items) {
  const picked = [];
  const usedQueueIds = new Set();

  for (const band of AGE_BANDS) {
    const item = items.find((entry) => {
      if (entry.status !== 'pending') return false;
      if (usedQueueIds.has(entry.queueId)) return false;
      const rec = normalizeRecord(entry.record);
      return rec.age_bands.includes(band);
    });
    if (item) {
      usedQueueIds.add(item.queueId);
      picked.push({ band, item, record: normalizeRecord(item.record) });
    }
  }

  return picked;
}

async function importBatch(supabaseUrl, serviceKey, records) {
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/import_knowledge_batch`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ p_items: records }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data.message || data.error || data.hint || `HTTP ${response.status}`;
    throw new Error(`import_knowledge_batch falhou: ${msg}`);
  }
  return data;
}

function summarizeQueue(items) {
  const pending = items.filter((i) => i.status === 'pending').length;
  const imported = items.filter((i) => i.status === 'imported').length;
  return { total: items.length, pending, imported };
}

module.exports = {
  AGE_BANDS,
  todayPt,
  normalizeRecord,
  validateRecord,
  effectiveItemStatus,
  mergeQueueWithOverrides,
  pickItemsForToday,
  importBatch,
  summarizeQueue,
};
