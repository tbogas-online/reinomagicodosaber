'use strict';

const { getCategoryTopic } = require('./wikidata-category-topics');
const { MAX_LIMIT } = require('./knowledge-import-briefing');
const {
  stripHtml,
  firstSentences,
  isUsableTitle,
  isUsableLead,
  isArchiveLead,
  matchesWords,
  quizAnswerFromArticle,
  isUsableQuizAnswer,
  fetchJson,
  fetchText,
  mapPool,
} = require('./rss-html');

const SOURCE = 'Arquivo.pt';
const LICENSE = 'Arquivo.pt — CC BY 4.0 (conteúdo arquivado)';
const CDX_URL = 'https://arquivo.pt/wayback/cdx';
const REPLAY_BASE = 'https://arquivo.pt/noFrame/replay';
const WIKI_OPENSEARCH = 'https://pt.wikipedia.org/w/api.php';
const DEFAULT_QUERY = {
  1: 'Portugal',
  2: 'rio Tejo',
  3: 'Afonso Henriques',
  4: 'ciclo da água',
  5: 'lobo ibérico',
  6: 'sistema solar',
  7: 'teorema de Pitágoras',
  8: 'Luís de Camões',
  9: 'língua portuguesa',
  10: 'azulejo',
  12: 'fado',
  14: 'pastel de nata',
  15: 'futebol em Portugal',
  17: 'Bartolomeu de Gusmão',
  20: 'curiosidades de Portugal',
};

function listArquivoImportSources() {
  return [{
    id: 'arquivo-pt',
    kind: 'arquivo-pt',
    label: 'Arquivo.pt — briefing de curadoria',
    source: SOURCE,
  }];
}

function topicForCategory(categoryN) {
  const n = Number(categoryN) || 20;
  if (n === 20) return 'curiosidade surpreendente';
  return getCategoryTopic(n)?.topic || 'história';
}

function formatsForCategory(categoryN) {
  const n = Number(categoryN) || 20;
  if (n === 20) return ['CURIOSIDADE', 'VERDADEIRO_FALSO'];
  if (n === 2) return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO', 'ONDE_FICA'];
  return ['RESPOSTA_DIRETA', 'ESCOLHA_MULTIPLA', 'VERDADEIRO_FALSO'];
}

function searchQuery(categoryN, words) {
  const list = (Array.isArray(words) ? words : []).map((w) => String(w || '').trim()).filter((w) => w.length >= 2);
  if (list.length) return list.slice(0, 4).join(' ');
  return DEFAULT_QUERY[Number(categoryN)] || DEFAULT_QUERY[3];
}

function itemDigest(item) {
  const digest = String(item?.digest || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (digest.length >= 8) return digest.slice(0, 16);
  const url = String(item?.originalURL || item?.originalUrl || '');
  return url.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-16) || '';
}

function canonicalUrl(item) {
  return String(item?.originalURL || item?.originalUrl || item?.url || '').replace(/\/+$/, '').toLowerCase();
}

function replayUrl(timestamp, pageUrl) {
  const ts = String(timestamp || '').replace(/\D/g, '');
  const url = String(pageUrl || '').trim();
  if (!ts || !url) return '';
  return `${REPLAY_BASE}/${ts}id_/${url}`;
}

function parseCdxJsonl(text) {
  const rows = [];
  for (const line of String(text || '').split(/\n+/)) {
    const raw = line.trim();
    if (!raw || raw[0] !== '{') continue;
    try {
      const row = JSON.parse(raw);
      if (row?.timestamp && row?.url) rows.push(row);
    } catch {
      /* ignore truncated CDX lines */
    }
  }
  return rows;
}

function isProseFact(text) {
  const lead = String(text || '').replace(/\s+/g, ' ').trim();
  if (lead.length < 40 || lead.length > 320) return false;
  if (/reinado|antecessor|religi[aã]o|enterro|saltar para|c[oô]njuge|mosteiro de santa cruz|compendio/i.test(lead)) return false;
  return true;
}

function cleanArchivedLead(html) {
  let text = stripHtml(html);
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/saltar para a (navega[cç][aã]o|pesquisa)\.?/gi, ' ');
  text = text.replace(/\[\s*\d+\s*\]/g, '');
  text = text.replace(/\s*(?:\.{3}|…)\s*/g, ' ');
  const window = text.slice(0, 8000);
  const re = /([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^.]{0,280}?\b(?:foi|são|era|nasceu|fica|chama-se|é um|é uma|foi o|foi a)\b[^.!]{8,180}\.)/gi;
  let found = re.exec(window);
  while (found) {
    const candidate = firstSentences(found[1]);
    if (isProseFact(candidate) && isArchiveLead(candidate)) return candidate;
    found = re.exec(window);
  }
  const fallback = firstSentences(window);
  return isProseFact(fallback) && isArchiveLead(fallback) ? fallback : '';
}

function extractHtmlLead(html) {
  const cleaned = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const paras = [...cleaned.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripHtml(m[1]).replace(/\[\s*\d+\s*\]/g, '').replace(/\s+/g, ' ').trim())
    .filter((text) => isUsableLead(text) && isArchiveLead(text) && isProseFact(firstSentences(text)));
  return paras[0] ? firstSentences(paras[0]) : cleanArchivedLead(cleaned.slice(0, 12000));
}

function toRecord(categoryN, item, lead) {
  const n = Number(categoryN) || 20;
  const fact = firstSentences(lead);
  if (!isArchiveLead(fact)) return null;
  const answer = quizAnswerFromArticle(item.title, fact, n);
  if (!isUsableQuizAnswer(answer, n)) return null;
  const id = itemDigest(item);
  if (!id) return null;
  const site = (() => {
    try {
      return new URL(item.originalURL || item.originalUrl || item.url || '').hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  return {
    knowledge_id: `knw-cat${n}-arq-${id}`,
    category_n: n,
    topic: topicForCategory(n),
    subtopic: site || 'arquivo',
    fact,
    answer,
    statement: `${String(fact).replace(/\.$/, '')}. Verdadeiro ou Falso?`,
    is_true: true,
    source: SOURCE,
    source_id: `arquivo:${id}`,
    source_url: item.linkToArchive || replayUrl(item.tstamp || item.timestamp, item.originalURL || item.url),
    license: LICENSE,
    confidence: 0.9,
    priority_pt: 62,
    age_bands: n === 20 ? ['10-15', '15+'] : ['6-9', '10-15', '15+'],
    allowed_formats: formatsForCategory(n),
    tags: ['arquivo-pt', 'cdx', site].filter(Boolean),
    verified_by: 'arquivo-pt-cdx-v1',
    metadata: {
      pipeline: 'arquivo-pt-cdx',
      digest: id,
      tstamp: item.tstamp || item.timestamp || '',
      title: item.title,
      originalUrl: item.originalURL || item.originalUrl || item.url,
      collection: item.collection || '',
    },
  };
}

async function resolveWikiUrls(query, fetchFn) {
  const url = `${WIKI_OPENSEARCH}?action=opensearch&search=${encodeURIComponent(query)}&limit=6&namespace=0&format=json`;
  const json = await fetchJson(url, { fetchFn, timeoutMs: 8000 });
  const titles = Array.isArray(json?.[1]) ? json[1] : [];
  const links = Array.isArray(json?.[3]) ? json[3] : [];
  const out = [];
  for (let i = 0; i < links.length; i += 1) {
    const title = String(titles[i] || '');
    if (!isUsableTitle(title) && title.length < 8) continue;
    if (/desambigua[cç][aã]o/i.test(title)) continue;
    out.push({ title, url: String(links[i] || '').trim() });
  }
  return out.filter((row) => row.url);
}

async function latestCapture(pageUrl, fetchFn) {
  const cdx = `${CDX_URL}?url=${encodeURIComponent(pageUrl)}&output=json&filter=status:200&filter=mimetype:text/html&sort=reverse&limit=5`;
  const text = await fetchText(cdx, {
    fetchFn,
    timeoutMs: 10000,
    accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
  });
  return parseCdxJsonl(text)[0] || null;
}

async function collectArquivoRecords({
  categoryN = 3,
  words = [],
  limit = 10,
  fetchFn,
} = {}) {
  const cap = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 10));
  const n = Number(categoryN) || 3;
  const query = searchQuery(n, words);
  let pages = [];
  try {
    pages = await resolveWikiUrls(query, fetchFn);
  } catch {
    pages = [];
  }
  if (!pages.length) {
    const slug = query.replace(/\s+/g, '_');
    pages = [{ title: query, url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(slug)}` }];
  }

  const seen = new Set();
  const captures = [];
  for (const page of pages.slice(0, Math.max(cap, 6))) {
    let row;
    try {
      row = await latestCapture(page.url, fetchFn);
    } catch {
      row = null;
    }
    if (!row?.timestamp || !row.url) continue;
    const id = itemDigest(row);
    const url = canonicalUrl(row);
    if (!id || !url || seen.has(url) || seen.has(id)) continue;
    if (words.length && !matchesWords(`${page.title} ${row.url}`, words) && !matchesWords(query, words)) continue;
    seen.add(url);
    seen.add(id);
    captures.push({
      ...row,
      title: page.title,
      originalURL: row.url,
      tstamp: row.timestamp,
      linkToArchive: replayUrl(row.timestamp, row.url),
    });
    if (captures.length >= cap) break;
  }

  const fetched = await mapPool(captures, 3, async (item) => {
    try {
      const html = await fetchText(item.linkToArchive, { fetchFn, timeoutMs: 12000 });
      const lead = extractHtmlLead(html);
      if (!lead) return null;
      return toRecord(n, item, lead);
    } catch {
      return null;
    }
  });
  return fetched.filter((row) => row?.knowledge_id && row.fact && row.answer).slice(0, cap);
}

module.exports = {
  SOURCE,
  CDX_URL,
  REPLAY_BASE,
  listArquivoImportSources,
  searchQuery,
  itemDigest,
  parseCdxJsonl,
  replayUrl,
  cleanArchivedLead,
  extractHtmlLead,
  toRecord,
  collectArquivoRecords,
};
