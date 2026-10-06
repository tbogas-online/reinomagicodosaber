'use strict';

const { getCategoryTopic } = require('./wikidata-category-topics');
const { MAX_LIMIT } = require('./knowledge-import-briefing');
const {
  parseRssItems,
  isUsableTitle,
  isQuizLead,
  matchesWords,
  quizAnswerFromArticle,
  isUsableQuizAnswer,
  firstSentences,
  fetchText,
} = require('./rss-html');

const SOURCE = 'Ciência Viva';
const LICENSE = 'Ciência Viva — divulgação científica';
const RSS_URL = 'http://imprensaregional.cienciaviva.pt/home/destaques-rss.asp';

function listCienciaVivaImportSources() {
  return [{
    id: 'ciencia-viva',
    kind: 'ciencia-viva',
    label: 'Ciência Viva — briefing de curadoria',
    source: SOURCE,
  }];
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

function articleIdFromItem(item) {
  const blob = `${item.guid || ''} ${item.link || ''}`;
  const match = blob.match(/id_artigocir=(\d+)/i);
  return match ? match[1] : '';
}

function toRecord(categoryN, item) {
  const n = Number(categoryN) || 20;
  const lead = firstSentences(item.description);
  if (!isQuizLead(lead)) return null;
  const answer = quizAnswerFromArticle(item.title, lead, n, { allowTitle: false, chamaSeOnly: true });
  if (!isUsableQuizAnswer(answer, n)) return null;
  const id = articleIdFromItem(item);
  return {
    knowledge_id: `knw-cat${n}-cv-${id}`,
    category_n: n,
    topic: topicForCategory(n),
    subtopic: 'imprensa regional',
    fact: lead,
    answer,
    statement: `${String(lead).replace(/\.$/, '')}. Verdadeiro ou Falso?`,
    is_true: true,
    source: SOURCE,
    source_id: `cv:cir:${id}`,
    source_url: item.link,
    license: LICENSE,
    confidence: 0.93,
    priority_pt: 72,
    age_bands: n === 20 ? ['10-15', '15+'] : ['6-9', '10-15', '15+'],
    allowed_formats: formatsForCategory(n),
    tags: ['ciencia-viva', 'imprensa-regional'],
    verified_by: 'ciencia-viva-rss-v1',
    metadata: {
      pipeline: 'ciencia-viva-cir',
      articleId: id,
      title: item.title,
    },
  };
}

async function collectCienciaVivaRecords({
  categoryN = 20,
  words = [],
  limit = 10,
  fetchFn,
} = {}) {
  const cap = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 10));
  const n = Number(categoryN) || 20;
  const xml = await fetchText(RSS_URL, {
    fetchFn,
    timeoutMs: 20000,
    accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
  });
  const records = [];
  const seen = new Set();
  for (const item of parseRssItems(xml)) {
    const id = articleIdFromItem(item);
    if (!id || seen.has(id) || !isUsableTitle(item.title)) continue;
    if (!isQuizLead(item.description)) continue;
    if (!matchesWords(`${item.title} ${item.description}`, words)) continue;
    seen.add(id);
    const record = toRecord(n, item);
    if (!record) continue;
    records.push(record);
    if (records.length >= cap) break;
  }
  return records;
}

module.exports = {
  SOURCE,
  RSS_URL,
  listCienciaVivaImportSources,
  articleIdFromItem,
  toRecord,
  collectCienciaVivaRecords,
};
