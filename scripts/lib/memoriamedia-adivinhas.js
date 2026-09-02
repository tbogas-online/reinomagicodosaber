'use strict';

const { validateAdivinhaImport } = require('./adivinha-import-validation');
const { normalizePtPtRecord } = require('./pt-pt-normalize');

const BASE_URL = 'https://www.memoriamedia.net';
const LIST_JSON = `${BASE_URL}/index.php/adivinhario-base-de-dados/list/5?format=json`;
const PAGE_SIZE = 10;
const SOURCE = 'MemóriaMedia';
const LICENSE = 'CC-BY-NC-ND (ver memoriamedia.net)';

const MALICIOUS_CLASS_IDS = new Set(['6']);
const PLACEHOLDER_ANSWERS = [
  /^devido ao tamanho da resposta/i,
  /^sem informa/i,
  /^sem resposta$/i,
  /^ver na transcri/i,
];

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0*39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeText(s) {
  return stripHtml(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function splitAnswerCandidates(answer) {
  return String(answer || '')
    .split(/[;/|]|(?:\s+-\s+)|(?:\s+–\s+)|(?:\s+—\s+)/)
    .map((part) => part.replace(/^[^:]+:\s*/, '').trim())
    .filter(Boolean);
}

function isPlaceholderAnswer(answer) {
  const a = String(answer || '').trim();
  if (!a) return true;
  return PLACEHOLDER_ANSWERS.some((re) => re.test(a));
}

function extractAnswerFromTranscription(text) {
  const stripped = stripHtml(text);
  const match = stripped.match(/\n\s*(?:R|Resposta)\s*:\s*([\s\S]+)/i);
  if (!match) return '';
  let tail = match[1].trim();
  tail = tail.split(/\n\s*(?:Nota|Explica[çc][ãa]o)\s*:/i)[0].trim();
  const firstLine = tail.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  return firstLine.replace(/^\(E\)\s*/i, '').replace(/^o que [eé]\?\s*/i, '').trim();
}

function parseTranscriptionBody(raw) {
  const text = stripHtml(raw);
  const cut = text.split(/\n\s*(?:R|Resposta)\s*:/i)[0];
  const body = cut.split(/\n\s*(?:Nota|Explica[çc][ãa]o)\s*:/i)[0].trim();
  return body;
}

function linesToClues(body) {
  const lines = body
    .split('\n')
    .map((line) => line.replace(/^[-–—]\s*/, '').trim())
    .map((line) => line.replace(/^que [eé] que [eé]\?\s*/i, '').trim())
    .filter((line) => line.length >= 8);
  const unique = [];
  const seen = new Set();
  for (const line of lines) {
    const key = normalizeText(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique.slice(0, 6);
}

function clueLeaksAnswer(clues, answer) {
  const ans = normalizeText(answer);
  if (!ans) return true;
  return clues.some((clue) => {
    const c = normalizeText(clue);
    if (!c) return false;
    if (c === ans) return true;
    if (ans.length >= 4 && c.includes(ans)) return true;
    if (c.length >= 4 && ans.includes(c)) return true;
    return false;
  });
}

function inferAgeBands({ classificationId, answer, clues, fact }) {
  const blob = normalizeText(`${answer} ${clues.join(' ')} ${fact}`);
  const adultish = MALICIOUS_CLASS_IDS.has(String(classificationId || ''))
    || /\b(verga|pindureza|guedelho|carne crua|mentolia|panascudo|maliciosa)\b/.test(blob);
  if (adultish) return ['15+'];
  const long = blob.length > 220 || clues.length > 5;
  if (long) return ['10-15', '15+'];
  return ['6-9', '10-15', '15+'];
}

function buildFact(title, body) {
  const verses = linesToClues(body);
  const intro = String(title || '').trim();
  if (!verses.length) return intro;
  if (intro && normalizeText(verses[0]).startsWith(normalizeText(intro).slice(0, 12))) {
    return verses.join(' ');
  }
  if (intro && !normalizeText(body).includes(normalizeText(intro))) {
    return `${intro}. ${verses.join(' ')}`;
  }
  return verses.join(' ');
}

function mapRawRow(row) {
  const id = Number(row.__pk_val || row.slug || 0);
  const title = row.adivinhario___nome_ficheiro_raw || row.adivinhario___nome_ficheiro || '';
  const transcription = row.adivinhario___adivinha_raw || row.adivinhario___adivinha || '';
  let answer = String(row.adivinhario___resposta_raw || row.adivinhario___resposta || '').trim();
  if (isPlaceholderAnswer(answer)) {
    answer = extractAnswerFromTranscription(transcription);
  }
  const body = parseTranscriptionBody(transcription);
  const clues = linesToClues(body);
  const fact = buildFact(title, body);
  const classificationId = String(row.adivinhario___classificacao_fundo_raw || row.adivinhario___classificacao_fundo || '');
  const detailUrl = row.fabrik_view_url
    ? `${BASE_URL}${row.fabrik_view_url}`
    : `${BASE_URL}/index.php/adivinhario-base-de-dados/details/5/${id}`;

  return {
    mmId: id,
    title,
    fact,
    answer,
    clues,
    classificationId,
    numeroFicha: row.adivinhario___numero_ficha_raw || row.adivinhario___numero_ficha || '',
    localidade: row.adivinhario___localidade_recolha_raw || '',
    concelho: row.adivinhario___concelho_raw || row.adivinhario___concelho || '',
    distrito: row.adivinhario___distrito_raw || row.adivinhario___distrito || '',
    dataRecolha: row.adivinhario___data_recolha_raw || '',
    sourceUrl: detailUrl,
    transcriptionRaw: stripHtml(transcription),
  };
}

function validateParsed(parsed, options = {}) {
  const issues = [];
  const normalized = normalizePtPtRecord({
    fact: parsed.fact,
    answer: parsed.answer,
    clues: parsed.clues || [],
  });
  parsed.fact = normalized.fact;
  parsed.answer = normalized.answer;
  parsed.clues = normalized.clues;

  if (!parsed.mmId) issues.push('missing_id');
  if (!parsed.fact || parsed.fact.length < 12) issues.push('fact_too_short');
  if (!parsed.answer || parsed.answer.length < 2) issues.push('missing_answer');
  if (isPlaceholderAnswer(parsed.answer)) issues.push('placeholder_answer');

  const answers = splitAnswerCandidates(parsed.answer);
  if (answers.length > 1) issues.push('multiple_answers');

  if (parsed.clues.length < 2) issues.push('missing_clues');
  if (clueLeaksAnswer(parsed.clues, parsed.answer)) issues.push('clue_leaks_answer');

  if (!options.includeMalicious && MALICIOUS_CLASS_IDS.has(parsed.classificationId)) {
    issues.push('malicious_classification');
  }

  const ageBands = inferAgeBands({
    classificationId: parsed.classificationId,
    answer: parsed.answer,
    clues: parsed.clues || [],
    fact: parsed.fact,
  });
  issues.push(...validateAdivinhaImport(parsed, ageBands));

  return issues;
}

function toKnowledgeRecord(parsed, seq) {
  const knowledgeId = `knw-cat20-mm-${String(parsed.mmId).padStart(4, '0')}`;
  const ageBands = inferAgeBands(parsed);
  const normalized = normalizePtPtRecord({
    fact: parsed.fact,
    answer: parsed.answer,
    clues: parsed.clues,
  });
  return {
    knowledge_id: knowledgeId,
    category_n: 20,
    topic: 'adivinha tradicional',
    subtopic: parsed.concelho || parsed.distrito || 'folclore',
    fact: normalized.fact,
    answer: normalized.answer,
    clues: normalized.clues,
    source: SOURCE,
    source_id: `mm:adivinha:${parsed.mmId}`,
    source_url: parsed.sourceUrl,
    license: LICENSE,
    confidence: parsed.classificationId === '6' ? 0.82 : 0.94,
    priority_pt: 98,
    age_bands: ageBands,
    allowed_formats: ['ADIVINHA'],
    tags: ['folclore', 'portugal', 'memoriamedia', 'giacometti'],
    verified_by: 'import-knowledge-adivinhas',
    metadata: {
      mm_id: parsed.mmId,
      numero_ficha: parsed.numeroFicha,
      title: parsed.title,
      classification_id: parsed.classificationId,
      localidade: parsed.localidade,
      concelho: parsed.concelho,
      distrito: parsed.distrito,
      data_recolha: parsed.dataRecolha,
    },
  };
}

function dedupeRecords(records) {
  const accepted = [];
  const rejected = [];
  const byAnswer = new Map();

  for (const item of records) {
    const ansKey = normalizeText(item.parsed.answer);
    const dup = byAnswer.get(ansKey);
    if (dup) {
      const sim = jaccard(item.parsed.fact, dup.parsed.fact);
      if (sim >= 0.72) {
        rejected.push({ ...item, issues: ['duplicate_answer_fact'] });
        continue;
      }
    }
    byAnswer.set(ansKey, item);
    accepted.push(item);
  }
  return { accepted, rejected };
}

async function fetchJsonPage(offset) {
  const url = `${LIST_JSON}&limitstart5=${offset}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ReinoMagicoKnowledgeImport/1.0 (+https://github.com/tbogas-online/reinomagicodosaber)',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  const data = await response.json();
  const rows = Array.isArray(data?.[0]) ? data[0] : (Array.isArray(data) ? data : []);
  return rows;
}

async function fetchAllMemoriaMediaRows(options = {}) {
  const max = options.maxRows || Infinity;
  const all = [];
  for (let offset = 0; offset < 500; offset += PAGE_SIZE) {
    const rows = await fetchJsonPage(offset);
    if (!rows.length) break;
    all.push(...rows);
    if (all.length >= max) return all.slice(0, max);
    if (rows.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, options.delayMs ?? 250));
  }
  return all;
}

function transformRows(rows, options = {}) {
  const accepted = [];
  const rejected = [];

  for (const row of rows) {
    const parsed = mapRawRow(row);
    const issues = validateParsed(parsed, options);
    const item = { parsed, raw: row };
    if (issues.length) {
      rejected.push({ ...item, issues });
    } else {
      accepted.push(item);
    }
  }

  const deduped = dedupeRecords(accepted);
  const queueItems = deduped.accepted.map((item, idx) => ({
    queueId: `q-mm-${item.parsed.mmId}`,
    status: 'pending',
    record: toKnowledgeRecord(item.parsed, idx + 1),
  }));

  return {
    stats: {
      fetched: rows.length,
      validated: accepted.length,
      rejectedValidation: rejected.length,
      rejectedDuplicate: deduped.rejected.length,
      queued: queueItems.length,
    },
    queueItems,
    rejected: [
      ...rejected.map((r) => ({
        mmId: r.parsed.mmId,
        title: r.parsed.title,
        answer: r.parsed.answer,
        issues: r.issues,
      })),
      ...deduped.rejected.map((r) => ({
        mmId: r.parsed.mmId,
        title: r.parsed.title,
        answer: r.parsed.answer,
        issues: r.issues,
      })),
    ],
  };
}

module.exports = {
  BASE_URL,
  LIST_JSON,
  PAGE_SIZE,
  stripHtml,
  normalizeText,
  clueLeaksAnswer,
  mapRawRow,
  validateParsed,
  toKnowledgeRecord,
  fetchAllMemoriaMediaRows,
  transformRows,
};
