'use strict';

const { getCategoryTopic } = require('./wikidata-category-topics');
const { MAX_LIMIT } = require('./knowledge-import-briefing');
const {
  parseRssItems,
  isUsableTitle,
  isUsableLead,
  matchesWords,
  quizAnswerFromArticle,
  isUsableQuizAnswer,
  firstSentences,
  stripHtml,
  fetchText,
  mapPool,
} = require('./rss-html');

const SOURCE = 'RTP Ensina';
const LICENSE = 'RTP Ensina — uso educativo';
const BASE = 'https://ensina.rtp.pt';

const TEMAS_BY_CATEGORY = {
  1: ['cidadania', 'estudo-do-meio'],
  2: ['geografia'],
  3: ['historia'],
  4: ['ciencia', 'fisico-quimica'],
  5: ['biologia', 'botanica', 'ciencias-naturais'],
  6: ['ciencia'],
  7: ['matematica'],
  8: ['portugues', 'literatura'],
  9: ['portugues'],
  10: ['artes', 'educacao-artistica'],
  11: ['artes'],
  12: ['musica'],
  13: ['artes'],
  14: ['estudo-do-meio'],
  15: ['educacao-fisica'],
  16: ['estudo-do-meio'],
  17: ['ciencia'],
  18: ['cidadania'],
  19: ['geografia'],
  20: ['ciencia', 'biologia', 'ciencias-naturais', 'geografia'],
};

function listRtpImportSources() {
  return [{
    id: 'rtp',
    kind: 'rtp',
    label: 'RTP Ensina — briefing de curadoria',
    source: SOURCE,
  }];
}

function temasForCategory(categoryN) {
  const n = Number(categoryN) || 20;
  return TEMAS_BY_CATEGORY[n] || TEMAS_BY_CATEGORY[20];
}

function topicForCategory(categoryN) {
  const n = Number(categoryN) || 20;
  if (n === 20) return 'curiosidade surpreendente';
  return getCategoryTopic(n)?.topic || 'ciência';
}

function formatsForCategory(categoryN) {
  const n = Number(categoryN) || 20;
  if (n === 20) return ['CURIOSIDADE', 'VERDADEIRO_FALSO'];
  if (n === 2) return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'ONDE_FICA'];
  return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO'];
}

function postIdFromItem(item) {
  const blob = `${item.guid || ''} ${item.link || ''}`;
  const match = blob.match(/[?&]p=(\d+)/i) || blob.match(/\/(\d+)\/?$/);
  return match ? match[1] : '';
}

function extractLead(html) {
  const cleaned = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const paras = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]))
    .filter((text) => isUsableLead(text));
  return paras[0] || '';
}

function toRecord(categoryN, item, lead, tema) {
  const n = Number(categoryN) || 20;
  const fact = firstSentences(lead);
  const answer = quizAnswerFromArticle(item.title, fact, n);
  if (!isUsableQuizAnswer(answer, n)) return null;
  const id = postIdFromItem(item);
  return {
    knowledge_id: `knw-cat${n}-rtp-${id}`,
    category_n: n,
    topic: topicForCategory(n),
    subtopic: tema || 'ensina',
    fact,
    answer,
    statement: `${String(fact).replace(/\.$/, '')}. Verdadeiro ou Falso?`,
    is_true: true,
    source: SOURCE,
    source_id: `rtp:ensina:${id}`,
    source_url: item.link,
    license: LICENSE,
    confidence: 0.93,
    priority_pt: 70,
    age_bands: n === 20 ? ['10-15', '15+'] : ['6-9', '10-15', '15+'],
    allowed_formats: formatsForCategory(n),
    tags: ['rtp', 'ensina', tema].filter(Boolean),
    verified_by: 'rtp-ensina-rss-v1',
    metadata: {
      pipeline: 'rtp-ensina',
      postId: id,
      tema,
      title: item.title,
    },
  };
}

async function collectRssItems({ categoryN, fetchFn, limit } = {}) {
  const temas = temasForCategory(categoryN);
  const feeds = await Promise.all(temas.map(async (tema) => {
    try {
      const xml = await fetchText(`${BASE}/tema/${tema}/feed/`, {
        fetchFn,
        accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      });
      return parseRssItems(xml).map((item) => ({ ...item, tema }));
    } catch {
      return [];
    }
  }));
  const seen = new Set();
  const items = [];
  for (const item of feeds.flat()) {
    const id = postIdFromItem(item);
    if (!id || seen.has(id) || !isUsableTitle(item.title)) continue;
    seen.add(id);
    items.push(item);
    if (items.length >= Math.max(24, Number(limit) || 10) * 2) break;
  }
  return items;
}

async function collectRtpRecords({
  categoryN = 20,
  words = [],
  limit = 10,
  fetchFn,
} = {}) {
  const cap = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 10));
  const n = Number(categoryN) || 20;
  const rssItems = await collectRssItems({ categoryN: n, fetchFn, limit: cap });
  const filtered = rssItems.filter((item) => matchesWords(`${item.title} ${item.tema}`, words));
  const fetchCap = Math.min(12, Math.max(cap, 6));
  const fetched = await mapPool(filtered.slice(0, fetchCap), 4, async (item) => {
    try {
      const html = await fetchText(item.link, { fetchFn, timeoutMs: 7000 });
      const lead = extractLead(html);
      if (!isUsableLead(lead)) return null;
      return toRecord(n, item, lead, item.tema);
    } catch {
      return null;
    }
  });
  return fetched.filter((row) => row?.knowledge_id && row.fact && row.answer).slice(0, cap);
}

module.exports = {
  SOURCE,
  TEMAS_BY_CATEGORY,
  listRtpImportSources,
  temasForCategory,
  extractLead,
  toRecord,
  collectRtpRecords,
};
