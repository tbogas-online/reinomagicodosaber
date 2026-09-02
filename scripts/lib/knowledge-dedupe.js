'use strict';

const { normalizeText } = require('./memoriamedia-adivinhas');

const JACCARD_THRESHOLD = 0.72;

const SOURCE_RANK = {
  'MemóriaMedia': 100,
  manual: 80,
  'Ditos.pt': 70,
  'Pumpkin.pt': 60,
  'Brinca Comigo': 55,
  'Santander Salto': 50,
  'Quero Bolsa': 40,
  sample: 10,
};

function tokenSet(s) {
  return new Set(normalizeText(s).split(' ').filter((w) => w.length > 2));
}

function jaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function idTier(knowledgeId) {
  const id = String(knowledgeId || '');
  if (/-cur-b50-/.test(id)) return 90;
  if (/-mm-/.test(id)) return 85;
  if (/-web-/.test(id)) return 50;
  if (/-adv-daily-/.test(id)) return 45;
  if (/-cur-daily-/.test(id)) return 35;
  if (/-sample-/.test(id)) return 10;
  return 30;
}

function scoreRecord(row) {
  const sourceScore = SOURCE_RANK[row.source] ?? 30;
  const priority = Number(row.priority_pt) || 0;
  return sourceScore * 1000 + idTier(row.knowledge_id) * 10 + priority;
}

function pickKeeper(items) {
  return [...items].sort((a, b) => {
    const diff = scoreRecord(b) - scoreRecord(a);
    if (diff !== 0) return diff;
    return String(a.knowledge_id).localeCompare(String(b.knowledge_id));
  })[0];
}

function buildExactGroups(records, keyFn) {
  const map = new Map();
  for (const row of records) {
    const key = keyFn(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.values()].filter((items) => items.length > 1);
}

function buildJaccardClusters(records, textField = 'fact') {
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < records.length; i += 1) {
    if (used.has(i)) continue;
    const cluster = [records[i]];
    used.add(i);
    for (let j = i + 1; j < records.length; j += 1) {
      if (used.has(j)) continue;
      const sim = jaccard(records[i][textField] || '', records[j][textField] || '');
      if (sim >= JACCARD_THRESHOLD) {
        cluster.push(records[j]);
        used.add(j);
      }
    }
    if (cluster.length > 1) clusters.push(cluster);
  }
  return clusters;
}

function planFromGroups(groups, reason) {
  const toDisable = [];
  for (const items of groups) {
    const keeper = pickKeeper(items);
    for (const row of items) {
      if (row.knowledge_id === keeper.knowledge_id) continue;
      toDisable.push({
        knowledge_id: row.knowledge_id,
        keeper: keeper.knowledge_id,
        reason,
        topic: row.topic,
        source: row.source,
      });
    }
  }
  return toDisable;
}

function buildDedupePlan(records, { adivinhas = false, curiosidades = true } = {}) {
  const active = records.filter((r) => r.is_active !== false);
  const adivinhaRows = active.filter((r) => r.topic === 'adivinha tradicional');
  const curiosidadeRows = active.filter((r) => r.topic === 'curiosidade surpreendente');

  const planned = [];

  if (curiosidades) {
    planned.push(
      ...planFromGroups(
        buildExactGroups(curiosidadeRows, (r) => normalizeText(r.fact)),
        'exact_fact',
      ),
    );
    const exactFacts = new Set(
      curiosidadeRows.map((r) => normalizeText(r.fact)).filter(Boolean),
    );
    const forJaccard = curiosidadeRows.filter((r) => {
      const key = normalizeText(r.fact);
      if (!key) return false;
      const dupExact = curiosidadeRows.filter((x) => normalizeText(x.fact) === key);
      return dupExact.length <= 1;
    });
    planned.push(
      ...planFromGroups(
        buildJaccardClusters(forJaccard, 'fact'),
        'similar_fact',
      ),
    );
  }

  if (adivinhas) {
    planned.push(
      ...planFromGroups(
        buildExactGroups(adivinhaRows, (r) => normalizeText(r.answer)),
        'exact_answer',
      ),
    );
    const exactAnswers = new Set(
      adivinhaRows.map((r) => normalizeText(r.answer)).filter(Boolean),
    );
    const forJaccard = adivinhaRows.filter((r) => {
      const key = normalizeText(r.answer);
      if (!key) return false;
      const dupExact = adivinhaRows.filter((x) => normalizeText(x.answer) === key);
      return dupExact.length <= 1;
    });
    const byAnswer = new Map();
    for (const row of forJaccard) {
      const key = normalizeText(row.answer);
      if (!byAnswer.has(key)) byAnswer.set(key, []);
      byAnswer.get(key).push(row);
    }
    for (const [, items] of byAnswer) {
      if (items.length < 2) continue;
      planned.push(...planFromGroups(buildJaccardClusters(items, 'fact'), 'similar_answer_fact'));
    }
    void exactAnswers;
  }

  const seen = new Set();
  const unique = [];
  for (const entry of planned) {
    if (seen.has(entry.knowledge_id)) continue;
    seen.add(entry.knowledge_id);
    unique.push(entry);
  }

  return {
    toDisable: unique,
    stats: {
      planned: unique.length,
      adivinhas: unique.filter((e) => e.topic === 'adivinha tradicional').length,
      curiosidades: unique.filter((e) => e.topic === 'curiosidade surpreendente').length,
      jaccardThreshold: JACCARD_THRESHOLD,
    },
  };
}

function isDuplicateOfExisting(record, existingRecords, { topic } = {}) {
  const rec = record;
  const topicFilter = topic || rec.topic;
  const peers = existingRecords.filter((r) => r.is_active !== false && r.topic === topicFilter);

  if (topicFilter === 'curiosidade surpreendente') {
    const fact = normalizeText(rec.fact);
    for (const row of peers) {
      if (normalizeText(row.fact) === fact) return { duplicate: true, reason: 'exact_fact', of: row.knowledge_id };
      if (jaccard(row.fact, rec.fact) >= JACCARD_THRESHOLD) {
        return { duplicate: true, reason: 'similar_fact', of: row.knowledge_id };
      }
    }
    return { duplicate: false };
  }

  if (topicFilter === 'adivinha tradicional') {
    const answer = normalizeText(rec.answer);
    for (const row of peers) {
      if (normalizeText(row.answer) !== answer) continue;
      if (normalizeText(row.fact) === normalizeText(rec.fact)) {
        return { duplicate: true, reason: 'exact_answer_fact', of: row.knowledge_id };
      }
      if (jaccard(row.fact, rec.fact) >= JACCARD_THRESHOLD) {
        return { duplicate: true, reason: 'similar_answer_fact', of: row.knowledge_id };
      }
    }
  }

  return { duplicate: false };
}

function filterNewRecords(records, existingRecords) {
  const accepted = [];
  const skipped = [];
  const pool = [...existingRecords];

  for (const record of records) {
    const dup = isDuplicateOfExisting(record, pool, { topic: record.topic });
    if (dup.duplicate) {
      skipped.push({ record, ...dup });
      continue;
    }
    accepted.push(record);
    pool.push({ ...record, is_active: true });
  }

  return { accepted, skipped };
}

module.exports = {
  JACCARD_THRESHOLD,
  jaccard,
  scoreRecord,
  buildDedupePlan,
  isDuplicateOfExisting,
  filterNewRecords,
};
