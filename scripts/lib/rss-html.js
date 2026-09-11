'use strict';

const USER_AGENT = 'ReinoMagicoDoSaber/1.0 (knowledge-import; educational quiz)';
const DEFAULT_TIMEOUT_MS = 12000;

const SKIP_TITLE_RE = /confer[eê]ncia|painel\s+\d|estamos a contratar|inscri[cç][oõ]es|bilheteira|voluntariado|manifesto de lisboa|pr[eé]mio atg|f[oó]rum nacional|clubes ci[eê]ncia viva|declara[cç][aã]o sobre|grande pr[eé]mio|apps? de rastreio|covid-?19|sars-cov|\b(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+20\d{2}\b/i;
const UNSAFE_TITLE_RE = /morte|cova|caix[aã]o|escrav|abuso|viol[eê]ncia|suic[ií]d|porn|estupro|aborto|droga/i;
const NEWSY_LEAD_RE = /^(estudo|investiga[cç][aã]o|um estudo|uma equipa|um grupo|uma recente|artigo|not[ií]cia|investigadores|cientistas|financiamento|agora lan[cç]ados|guia para|podendo|recorrendo a dados)\b/i;
const PRESS_RELEASE_RE = /foi publicado|revista do grupo|conceituada revista|estudo liderado|estudo internacional publicado|f[oó]rum nacional|clubes ci[eê]ncia viva na escola|em tempos de pandemia|picos da pandemia|universidade de \w+ (descobriu|est[aá] a desenvolver)|apresentou no dia|lan[cç]ados em formato|financiamento beneficia|declara[cç][aã]o sobre|vencedor do grande pr|apps de rastreio|h[aá] j[aá] um ano que o mundo|n[aã]o vamos falar|elefante na sala|limpe os olhos|projecte o olhar/i;
const PT_ACCENT_RE = /[áàâãéêíóôõúç]/i;
const HEADLINE_ANSWER_RE = /\b(para ajudar|descoberto novo|inauguram|solu[cç][aã]o para|comportamento escondido|horizonte infinito)\b/i;

function decodeXml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0*39;/g, "'");
}

function tidyText(text) {
  return String(text || '')
    .replace(/\uFEFF/g, '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function hasBrokenEncoding(text) {
  return /\uFFFD/.test(String(text || ''));
}

function stripHtml(html) {
  return tidyText(decodeXml(String(html || ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim());
}

function normalizeKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentences(text, maxChars = 240) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = parts[0] || clean;
  if (out.length < 70 && parts[1]) out = `${out} ${parts[1]}`.trim();
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars - 1);
    const lastSpace = cut.lastIndexOf(' ');
    out = `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}.`;
  }
  if (!/[.!?]$/.test(out)) out = `${out}.`;
  return out;
}

function parseRssItems(xml) {
  const blocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const tag = (name) => {
      const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
      return stripHtml(decodeXml(match ? match[1] : ''));
    };
    const guidMatch = block.match(/<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i);
    return {
      title: tag('title'),
      link: tag('link'),
      description: tag('description'),
      guid: stripHtml(decodeXml(guidMatch ? guidMatch[1] : '')),
      date: tag('pubDate') || tag('dc:date'),
    };
  }).filter((item) => item.title && item.link);
}

function isUsableTitle(title) {
  const text = String(title || '').trim();
  if (text.length < 8 || text.length > 140) return false;
  if (hasBrokenEncoding(text)) return false;
  if (SKIP_TITLE_RE.test(text) || UNSAFE_TITLE_RE.test(text)) return false;
  return true;
}

function isUsableLead(text) {
  const lead = String(text || '').trim();
  if (lead.length < 40 || lead.length > 600) return false;
  if (hasBrokenEncoding(lead)) return false;
  if (/^the post\b/i.test(lead)) return false;
  if (!/[a-záàâãéêíóôõúç]/i.test(lead)) return false;
  if (!PT_ACCENT_RE.test(lead)) return false;
  return true;
}

function isRhetoricalLead(text) {
  const lead = String(text || '').replace(/\s+/g, ' ').trim();
  return /[?]/.test(lead) || /por que raz[aã]o|ter-se-|devir-feminino/i.test(lead);
}

function isQuizLead(text) {
  const lead = String(text || '').replace(/\s+/g, ' ').trim();
  if (!isUsableLead(lead)) return false;
  if (PRESS_RELEASE_RE.test(lead) || isRhetoricalLead(lead)) return false;
  if (!NEWSY_LEAD_RE.test(lead)) return true;
  return /\b(é|são|tem|fica|produz|gera|chama-se|pertence|ajuda|regula)\b/i.test(lead);
}

function matchesWords(haystack, words) {
  const list = (Array.isArray(words) ? words : []).map((w) => normalizeKey(w)).filter((w) => w.length >= 2);
  if (!list.length) return true;
  const hay = normalizeKey(haystack);
  return list.some((word) => hay.includes(word));
}

function answerFromTitle(title) {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  const beforeColon = text.split(':')[0].trim();
  if (beforeColon.length >= 2 && beforeColon.length <= 32 && beforeColon !== text) return beforeColon;
  const beforeComma = text.split(',')[0].trim();
  if (beforeComma.length >= 2 && beforeComma.length <= 32) return beforeComma;
  if (text.length <= 32) return text;
  return '';
}

function isShortNounAnswer(text) {
  const value = String(text || '').trim();
  if (value.length < 2 || value.length > 28) return false;
  if (value.split(/\s+/).length > 3) return false;
  if (HEADLINE_ANSWER_RE.test(value)) return false;
  if (/\b(para|com|nas|nos|pelo|pela|descobert|inaugur|ajudar|publicado)\b/i.test(value)) return false;
  return true;
}

const SHOW_TITLE_RE = /jovens talentos|hist[oó]rias do lucas|mexa esses neur[oó]nios|primeira aula|primeiros toques|\b[eé] aqui\b|os primeiros toques/i;

function isQuestionTitle(title) {
  const text = String(title || '').trim();
  return /[?]/.test(text) || /^(quem|qual|quais|como|onde|quando|o que|porque|porqu[eê])\b/i.test(text);
}

function isShowTitle(title) {
  return SHOW_TITLE_RE.test(String(title || ''));
}

function cleanQuizAnswer(raw) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'“”«»]+|["'“”«»]+$/g, '').trim();
  text = text.replace(/^(o|a|os|as|um|uma)\s+/i, '').trim();
  text = text.replace(/[.,;:!?]+$/g, '').trim();
  if (text.length < 2 || text.length > 32) return '';
  if (text.split(/\s+/).length > 4) return '';
  if (/^(jogo|desporto|aula|programa|hist[oó]ria|tabuleiro)$/i.test(text)) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function extractNamedAnswer(fact, { chamaSeOnly = false } = {}) {
  const text = String(fact || '').trim();
  const chamaSe = /\bchama-se\s+["“«']?((?:o|a|os|as|um|uma)\s+)?([^"“”»',.!?]+?)(?=\s+(?:e|que|foi|é|são)\b|["”»]|[,.!?]|$)/i;
  const patterns = chamaSeOnly ? [chamaSe] : [
    chamaSe,
    /\baula de\s+((?:o|a)\s+)?([^\s,.!?]+)/i,
    /\bjogo(?:\s+de|\s+da|\s+do)\s+((?:o|a|os|as)\s+)?([^\s,.!?]+)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) {
      const answer = cleanQuizAnswer(match[match.length - 1]);
      if (answer) return answer;
    }
  }
  return '';
}

function isUsableQuizAnswer(answer, categoryN) {
  const text = String(answer || '').trim();
  if (hasBrokenEncoding(text)) return false;
  if (Number(categoryN) === 20) return /^(verdadeiro|falso)$/i.test(text);
  if (!text || text.length < 2 || text.length > 32) return false;
  if (/[?]/.test(text) || isQuestionTitle(text) || isShowTitle(text) || HEADLINE_ANSWER_RE.test(text)) return false;
  if (/^(quem|qual|quais|como|onde|quando|o que|porque|porqu[eê])\b/i.test(text)) return false;
  return true;
}

function quizAnswerFromArticle(title, fact, categoryN, { allowTitle = true, chamaSeOnly = false } = {}) {
  if (Number(categoryN) === 20) return 'Verdadeiro';
  const named = extractNamedAnswer(fact, { chamaSeOnly });
  if (named && isUsableQuizAnswer(named, categoryN)) return named;
  if (!allowTitle || isShowTitle(title) || isQuestionTitle(title)) return '';
  const fromTitle = answerFromTitle(title);
  if (!isShortNounAnswer(fromTitle) || !isUsableQuizAnswer(fromTitle, categoryN)) return '';
  if (!normalizeKey(fact).includes(normalizeKey(fromTitle))) return '';
  return fromTitle;
}

function charsetFromContentType(contentType) {
  const match = String(contentType || '').match(/charset\s*=\s*["']?([a-z0-9_-]+)/i);
  return match ? match[1] : '';
}

function charsetFromXmlOrHtml(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1600));
  const xml = head.match(/encoding\s*=\s*["']\s*([a-z0-9_-]+)\s*["']/i);
  if (xml) return xml[1];
  const html = head.match(/charset\s*=\s*["']?\s*([a-z0-9_-]+)/i);
  return html ? html[1] : '';
}

function normalizeCharset(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw || raw === 'utf8' || raw === 'utf-8') return 'utf-8';
  if (raw === 'utf-16' || raw === 'utf16') return 'utf-16le';
  if (['windows-1252', 'cp1252', 'iso-8859-1', 'iso8859-1', 'latin1', 'latin-1'].includes(raw)) {
    return 'windows-1252';
  }
  return raw;
}

function decodeWithCharset(bytes, charset) {
  try {
    return new TextDecoder(normalizeCharset(charset), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function replacementRatio(text) {
  const value = String(text || '');
  if (!value) return 0;
  return (value.match(/\uFFFD/g) || []).length / value.length;
}

function decodeBytes(input, contentType = '') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const hinted = charsetFromContentType(contentType) || charsetFromXmlOrHtml(bytes) || 'utf-8';
  let text = decodeWithCharset(bytes, hinted);
  if (replacementRatio(text) > 0.002) {
    const fallback = decodeWithCharset(bytes, 'windows-1252');
    if (replacementRatio(fallback) < replacementRatio(text)) text = fallback;
  }
  return tidyText(text);
}

async function readResponseText(response) {
  const contentType = typeof response?.headers?.get === 'function'
    ? (response.headers.get('content-type') || '')
    : '';
  if (typeof response?.arrayBuffer === 'function') {
    const buf = await response.arrayBuffer();
    return decodeBytes(buf, contentType);
  }
  return tidyText(String(await response.text()));
}

async function fetchText(url, { fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, accept = 'text/html,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8' } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: accept,
        'User-Agent': USER_AGENT,
      },
      signal: controller?.signal,
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status || 0} em ${url}`);
    return await readResponseText(response);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapPool(items, limit, mapper) {
  const out = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = {
  USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  decodeXml,
  tidyText,
  hasBrokenEncoding,
  stripHtml,
  normalizeKey,
  firstSentences,
  parseRssItems,
  isUsableTitle,
  isUsableLead,
  isQuizLead,
  matchesWords,
  answerFromTitle,
  isShortNounAnswer,
  isQuestionTitle,
  isShowTitle,
  extractNamedAnswer,
  isUsableQuizAnswer,
  quizAnswerFromArticle,
  decodeBytes,
  fetchText,
  mapPool,
};
