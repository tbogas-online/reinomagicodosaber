'use strict';

const { getCategoryTopic } = require('./wikidata-category-topics');
const { MAX_LIMIT } = require('./knowledge-import-briefing');
const {
  stripHtml,
  decodeXml,
  tidyText,
  firstSentences,
  isUsableTitle,
  isUsableLead,
  matchesWords,
  quizAnswerFromArticle,
  isUsableQuizAnswer,
  fetchText,
  mapPool,
  normalizeKey,
} = require('./rss-html');

const SOURCE = 'Biblioteca Nacional';
const LICENSE = 'BNP Open Data — CC0 1.0';
const CATALOG_SEARCH = 'https://catalogo.bnportugal.gov.pt/ipac20/ipac.jsp';
const OAI_URL = 'https://oai.bnportugal.gov.pt/servlet/OAIHandler';
const DEFAULT_QUERY = {
  1: 'Portugal',
  2: 'rio Tejo',
  3: 'Afonso Henriques',
  4: 'ciência',
  5: 'lobo ibérico',
  6: 'sistema solar',
  8: 'Luís de Camões',
  9: 'língua portuguesa',
  10: 'azulejo',
  12: 'fado',
  14: 'pastel de nata',
  15: 'futebol em Portugal',
  17: 'Bartolomeu de Gusmão',
  20: 'curiosidades de Portugal',
};

const SKIP_CREATOR_RE = /col[oó]quio|congresso|confer[eê]ncia|simp[oó]sio|exposi[cç][aã]o|universidade|instituto|funda[cç][aã]o|minist[eé]rio|estado-maior|biblioteca|associa[cç][aã]o|c[aâ]mara municipal|centro cient/i;
const SKIP_TYPE_RE = /cartogr|imagem fixa|grava[cç][aã]o sonora|v[ií]deo|filme|partitura/i;

function listBnpImportSources() {
  return [{
    id: 'bnp',
    kind: 'bnp',
    label: 'Biblioteca Nacional — briefing de curadoria',
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

function catalogSearchUrl(query) {
  const term = encodeURIComponent(String(query || '').trim());
  return `${CATALOG_SEARCH}?profile=bn&aspect=basic_search&menu=search&ipp=20&spp=20&index=.TW&term=${term}`;
}

function catalogPermalink(bibId) {
  const id = String(bibId || '').replace(/\D/g, '');
  if (!id) return '';
  return `${CATALOG_SEARCH}?profile=bn&uri=full=3100024~!${id}~!0`;
}

function oaiGetUrl(bibId) {
  const id = String(bibId || '').replace(/\D/g, '');
  return `${OAI_URL}?verb=GetRecord&metadataPrefix=oai_dc&identifier=${encodeURIComponent(`oai:oai.bn.pt:catalogo/${id}`)}`;
}

function tidyCatalogText(value) {
  return tidyText(stripHtml(decodeXml(String(value || ''))))
    .replace(/[\u0098\u009C\u009D\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCatalogBibIds(html) {
  const text = String(html || '');
  const seen = new Set();
  const ids = [];
  const patterns = [
    /uri%3Dfull%3D3100024%7E%21(\d+)%7E%21\d+/gi,
    /uri=full=3100024~!(\d+)~!\d+/gi,
  ];
  for (const re of patterns) {
    let match = re.exec(text);
    while (match) {
      const id = match[1];
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
      match = re.exec(text);
    }
  }
  return ids;
}

function dcValues(xml, name) {
  const re = new RegExp(`<dc:${name}(?:\\s[^>]*)?>([\\s\\S]*?)</dc:${name}>`, 'gi');
  const out = [];
  let match = re.exec(xml);
  while (match) {
    const value = tidyCatalogText(match[1]);
    if (value) out.push(value);
    match = re.exec(xml);
  }
  return out;
}

function parseOaiDc(xml) {
  const text = String(xml || '');
  if (/<error[\s>]/i.test(text)) return null;
  const headerId = (text.match(/<identifier>([^<]+)<\/identifier>/i) || [])[1] || '';
  const bibId = (headerId.match(/\/(\d+)\s*$/) || [])[1] || '';
  if (!bibId) return null;
  const titles = dcValues(text, 'title');
  const creators = dcValues(text, 'creator');
  const dates = dcValues(text, 'date');
  const languages = dcValues(text, 'language');
  const types = dcValues(text, 'type');
  const identifiers = dcValues(text, 'identifier');
  return {
    bibId,
    headerId,
    title: titles[0] || '',
    creators,
    dates,
    languages,
    types,
    identifiers,
  };
}

function isPortuguese(languages) {
  const list = Array.isArray(languages) ? languages : [];
  if (!list.length) return true;
  return list.some((lang) => /^(por|pt)([-_]|$)/i.test(String(lang || '').trim()));
}

function yearFromDate(value) {
  const match = String(value || '').match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : '';
}

function displayAuthor(raw) {
  const text = tidyCatalogText(raw);
  if (!text || SKIP_CREATOR_RE.test(text)) return '';
  const inverted = text.match(/^([^,]+),\s*([^,0-9]+?)(?:\s*,\s*.*)?$/);
  if (inverted) {
    const family = inverted[1].trim();
    const given = inverted[2].trim();
    if (family.length >= 2 && given.length >= 2 && given.split(/\s+/).length <= 4) {
      return `${given} ${family}`;
    }
  }
  const plain = text.replace(/,?\s*\d{4}.*$/, '').trim();
  if (plain.split(/\s+/).length >= 2 && plain.split(/\s+/).length <= 4 && !SKIP_CREATOR_RE.test(plain)) {
    return plain;
  }
  return '';
}

function pickAuthor(creators) {
  for (const raw of Array.isArray(creators) ? creators : []) {
    const author = displayAuthor(raw);
    if (author) return author;
  }
  return '';
}

function buildFact(title, author, year) {
  const book = String(title || '').replace(/\.$/, '').trim();
  if (!book || !author) return '';
  if (year) {
    return `A obra «${book}», de ${author}, foi publicada em ${year} e está no catálogo da Biblioteca Nacional de Portugal.`;
  }
  return `A obra «${book}» foi escrita por ${author} e está no catálogo da Biblioteca Nacional de Portugal.`;
}

function answerFromBnp(title, fact, author, categoryN, words) {
  if (Number(categoryN) === 20) return 'Verdadeiro';
  const blob = `${title} ${fact}`;
  for (const word of Array.isArray(words) ? words : []) {
    const text = String(word || '').trim();
    if (text.length < 3 || text.length > 32) continue;
    if (!normalizeKey(blob).includes(normalizeKey(text))) continue;
    if (isUsableQuizAnswer(text, categoryN)) {
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }
  const fromArticle = quizAnswerFromArticle(title, fact, categoryN);
  if (fromArticle) return fromArticle;
  const name = String(author || '').trim();
  if (name && name.split(/\s+/).length <= 3 && normalizeKey(fact).includes(normalizeKey(name)) && isUsableQuizAnswer(name, categoryN)) {
    return name;
  }
  return '';
}

function toRecord(categoryN, item, { words = [] } = {}) {
  const n = Number(categoryN) || 20;
  if (!item?.bibId || !isUsableTitle(item.title)) return null;
  if (!isPortuguese(item.languages)) return null;
  if ((item.types || []).some((type) => SKIP_TYPE_RE.test(type))) return null;
  const author = pickAuthor(item.creators);
  const year = yearFromDate((item.dates || [])[0]);
  const fact = firstSentences(buildFact(item.title, author, year));
  if (!isUsableLead(fact)) return null;
  const answer = answerFromBnp(item.title, fact, author, n, words);
  if (!isUsableQuizAnswer(answer, n)) return null;
  if (words.length && !matchesWords(`${item.title} ${fact} ${author}`, words)) return null;
  return {
    knowledge_id: `knw-cat${n}-bnp-${item.bibId}`,
    category_n: n,
    topic: topicForCategory(n),
    subtopic: 'catálogo BNP',
    fact,
    answer,
    statement: `${String(fact).replace(/\.$/, '')}. Verdadeiro ou Falso?`,
    is_true: true,
    source: SOURCE,
    source_id: `bnp:${item.bibId}`,
    source_url: catalogPermalink(item.bibId),
    license: LICENSE,
    confidence: 0.94,
    priority_pt: 76,
    age_bands: n === 20 ? ['10-15', '15+'] : ['6-9', '10-15', '15+'],
    allowed_formats: formatsForCategory(n),
    tags: ['bnp', 'oai-dc', 'catalogo'],
    verified_by: 'bnp-oai-dc-v1',
    metadata: {
      pipeline: 'bnp-catalog-oai',
      bibId: item.bibId,
      title: item.title,
      author,
      year,
      language: (item.languages || [])[0] || '',
    },
  };
}

async function collectBnpRecords({
  categoryN = 3,
  words = [],
  limit = 10,
  fetchFn,
} = {}) {
  const cap = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 10));
  const n = Number(categoryN) || 3;
  const query = searchQuery(n, words);
  const html = await fetchText(catalogSearchUrl(query), {
    fetchFn,
    timeoutMs: 20000,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  });
  const ids = parseCatalogBibIds(html).slice(0, Math.max(cap * 2, 12));
  const fetched = await mapPool(ids, 4, async (bibId) => {
    try {
      const xml = await fetchText(oaiGetUrl(bibId), {
        fetchFn,
        timeoutMs: 10000,
        accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      });
      const item = parseOaiDc(xml);
      if (!item) return null;
      return toRecord(n, item, { words });
    } catch {
      return null;
    }
  });
  return fetched.filter((row) => row?.knowledge_id && row.fact && row.answer).slice(0, cap);
}

module.exports = {
  SOURCE,
  CATALOG_SEARCH,
  OAI_URL,
  listBnpImportSources,
  searchQuery,
  catalogSearchUrl,
  catalogPermalink,
  oaiGetUrl,
  parseCatalogBibIds,
  parseOaiDc,
  displayAuthor,
  yearFromDate,
  buildFact,
  toRecord,
  collectBnpRecords,
};
