'use strict';

const {
  buildAdivinhaDistractors,
  assembleMcOptions,
} = require('../../../scripts/lib/adivinha-distractors-node');

const AGE_BANDS = ['6-9', '10-15', '15+'];
const BATCH_SIZE = 40;
const DEFAULT_TOPIC = 'adivinha tradicional';

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeQ(str) {
  return stripTags(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hashQuestionKey(text) {
  const s = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function capitalizeAnswer(answer) {
  const a = String(answer || '').trim();
  if (!a) return a;
  return a.charAt(0).toLocaleUpperCase('pt-PT') + a.slice(1);
}

function buildAdivinhaQuestion(record) {
  const clues = Array.isArray(record.clues) ? record.clues.map((c) => String(c).trim()).filter(Boolean) : [];
  let qText = clues.length >= 2 ? clues.join(' ') : String(record.fact || '').trim();
  qText = qText.replace(/^[«"']?\s*[^.!?]{1,40}[.!?]\s+/u, '').trim() || qText;
  if (!/\?\s*$/.test(qText)) {
    qText = `${qText.replace(/[.!]\s*$/, '').trim()}. O que sou?`;
  }
  const answer = capitalizeAnswer(record.answer);
  const distractors = buildAdivinhaDistractors(answer, { normalizeFn: normalizeQ });
  if (!distractors) return null;
  const options = assembleMcOptions(answer, distractors);
  if (!options) return null;
  return { question: qText, correctAnswer: answer, options };
}

async function supabaseRequest(url, key, path, options = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function rpc(url, key, fn, params) {
  return supabaseRequest(url, key, `/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

async function countPlayableBankQuestions(url, key, categoryN, ageBand) {
  try {
    const data = await rpc(url, key, 'count_playable_bank_questions', {
      p_category_n: categoryN,
      p_age_band: ageBand,
    });
    return Number(data) || 0;
  } catch {
    return null;
  }
}

async function fetchUnmaterializedKnowledge(url, key, {
  categoryN = 20,
  ageBand,
  topic = DEFAULT_TOPIC,
  limit = 50,
  minConfidence = 0.85,
} = {}) {
  try {
    const rows = await rpc(url, key, 'list_unmaterialized_knowledge', {
      p_category_n: categoryN,
      p_age_band: ageBand,
      p_topic: topic,
      p_limit: limit,
      p_min_confidence: minConfidence,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    const params = new URLSearchParams({
      select: 'knowledge_id,fact,answer,clues,source,source_id,confidence,age_bands,allowed_formats,topic',
      category_n: `eq.${categoryN}`,
      topic: `eq.${topic}`,
      is_active: 'eq.true',
      confidence: `gte.${minConfidence}`,
      order: 'priority_pt.desc,knowledge_id.asc',
      limit: String(Math.min(limit * 3, 300)),
    });
    const batch = await supabaseRequest(url, key, `/knowledge_records?${params.toString()}`);
    if (!Array.isArray(batch)) return [];
    const bankParams = new URLSearchParams({
      select: 'knowledge_id',
      category_n: `eq.${categoryN}`,
      age_band: `eq.${ageBand}`,
      is_reported: 'eq.false',
    });
    const bankRows = await supabaseRequest(url, key, `/question_bank?${bankParams.toString()}`);
    const banked = new Set((bankRows || []).map((r) => r.knowledge_id).filter(Boolean));
    return batch
      .filter((row) => {
        const formats = Array.isArray(row.allowed_formats) ? row.allowed_formats : [];
        if (formats.length && !formats.includes('ADIVINHA')) return false;
        const bands = Array.isArray(row.age_bands) ? row.age_bands : AGE_BANDS;
        if (!bands.includes(ageBand)) return false;
        return !banked.has(row.knowledge_id);
      })
      .slice(0, limit);
  }
}

function buildBankItems(records, ageBand, { source = 'repository-replenish' } = {}) {
  const items = [];
  let skipped = 0;
  for (const record of records) {
    const built = buildAdivinhaQuestion(record);
    if (!built) {
      skipped += 1;
      continue;
    }
    const questionHash = hashQuestionKey(`${stripTags(built.question)}|${stripTags(built.correctAnswer)}|${ageBand}`);
    items.push({
      category_n: 20,
      age_band: ageBand,
      question: built.question,
      correct_answer: built.correctAnswer,
      question_hash: questionHash,
      options: built.options,
      format: 'ADIVINHA',
      knowledge_key: null,
      source,
      knowledge_id: record.knowledge_id,
      source_id: record.source_id || null,
      confidence: record.confidence,
    });
  }
  return { items, skipped };
}

async function importBatch(url, key, items) {
  const data = await rpc(url, key, 'import_questions_batch', { p_items: items });
  return data || { inserted: 0, exists: 0, skipped: 0 };
}

async function replenishBankFromKnowledge(url, key, {
  categoryN = 20,
  ageBand,
  limit = 50,
  topic = DEFAULT_TOPIC,
  minConfidence = 0.85,
  dryRun = false,
  source = 'repository-replenish',
} = {}) {
  if (!url || !key) throw new Error('Supabase em falta');
  if (!AGE_BANDS.includes(ageBand)) throw new Error(`Faixa etária inválida: ${ageBand}`);

  const records = await fetchUnmaterializedKnowledge(url, key, {
    categoryN,
    ageBand,
    topic,
    limit,
    minConfidence,
  });

  const { items, skipped } = buildBankItems(records, ageBand, { source });
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      candidates: records.length,
      prepared: items.length,
      skipped,
      playableBefore: await countPlayableBankQuestions(url, key, categoryN, ageBand),
    };
  }

  let inserted = 0;
  let exists = 0;
  let batchSkipped = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const result = await importBatch(url, key, batch);
    inserted += Number(result.inserted) || 0;
    exists += Number(result.exists) || 0;
    batchSkipped += Number(result.skipped) || 0;
  }

  const playableAfter = await countPlayableBankQuestions(url, key, categoryN, ageBand);
  return {
    ok: true,
    candidates: records.length,
    prepared: items.length,
    skipped,
    inserted,
    exists,
    batchSkipped,
    playableAfter,
  };
}

module.exports = {
  AGE_BANDS,
  DEFAULT_TOPIC,
  hashQuestionKey,
  buildAdivinhaQuestion,
  countPlayableBankQuestions,
  fetchUnmaterializedKnowledge,
  buildBankItems,
  replenishBankFromKnowledge,
};
