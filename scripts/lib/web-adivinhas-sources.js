'use strict';

const { stripHtml } = require('./adivinha-web-utils');

const USER_AGENT = 'ReinoMagicoKnowledgeImport/1.0 (+https://github.com/tbogas-online/reinomagicodosaber)';

const SOURCES = [
  {
    slug: 'pumpkin',
    name: 'Pumpkin.pt',
    url: 'https://pumpkin.pt/familia/atividades-com-miudos/brincar-brinquedos-criancas/adivinhas/',
    locale: 'pt-PT',
    subtopic: 'infantil',
    license: 'Pumpkin.pt — uso educativo',
  },
  {
    slug: 'santander',
    name: 'Santander Salto',
    url: 'https://www.santander.pt/salto/adivinhas-para-criancas-e-adultos',
    locale: 'pt-PT',
    subtopic: 'família',
    license: 'Santander Salto — uso educativo',
  },
  {
    slug: 'brincacomigo',
    name: 'Brinca Comigo',
    url: 'https://www.brincacomigo.pt/adivinhas-infantis-para-brincar-entreter-e-aprender/',
    locale: 'pt-PT',
    subtopic: 'infantil',
    license: 'BrincaComigo.pt — uso educativo',
  },
  {
    slug: 'ditos',
    name: 'Ditos.pt',
    url: 'https://ditos.pt/adivinhas/',
    locale: 'pt-PT',
    subtopic: 'tradicional',
    license: 'Ditos.pt — uso educativo',
  },
  {
    slug: 'querobolsa',
    name: 'Quero Bolsa',
    url: 'https://querobolsa.com.br/revista/charadas-infantis',
    locale: 'pt-BR',
    subtopic: 'charadas',
    license: 'QueroBolsa.com.br — uso educativo (PT-BR)',
  },
];

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ao obter ${url}`);
  return response.text();
}

function parsePumpkin(html) {
  const text = stripHtml(html);
  const items = [];
  const re = /(?:^|\n)\s*(\d+)\.\s+([\s\S]*?)\n\s*([A-ZÀ-Ú][^\n.]{1,80})\./g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const question = match[2].replace(/\s+/g, ' ').trim();
    const answer = match[3].trim();
    if (question.length < 15 || !answer) continue;
    items.push({ question, answer });
  }
  return items;
}

function parseSantander(html) {
  const text = stripHtml(html);
  const items = [];
  const re = /([^\n?]{12,}\?)\s*\n\s*Resposta:\s*([^\n.]+)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const question = match[1].replace(/\s+/g, ' ').trim();
    const answer = match[2].trim().replace(/\.$/, '');
    if (question.length < 12 || !answer) continue;
    if (/^resposta$/i.test(question)) continue;
    items.push({ question, answer });
  }
  return items;
}

function parseBrincaComigo(html) {
  const text = stripHtml(html);
  const start = text.indexOf('Divirta-se com estas');
  const end = text.indexOf('Sabe mais adivinhas');
  let slice = start >= 0 ? text.slice(start, end > start ? end : undefined) : text;
  const emojiSplit = slice.split('🙂');
  if (emojiSplit.length > 1) slice = emojiSplit.slice(1).join('🙂');

  const items = [];
  const re = /([A-ZÀ-ÚÁÉÍÓÚÃÕÂÊÔÇ][^?]{10,}\?)\s+([A-ZÀ-ÚÁÉÍÓÚÃÕÂÊÔÇ][A-Za-zÀ-úáéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ\s-]{1,48})(?=\s+[A-ZÀ-ÚÁÉÍÓÚÃÕÂÊÔÇ]|$)/g;
  let match;
  while ((match = re.exec(slice)) !== null) {
    const question = match[1].replace(/\s+/g, ' ').trim();
    let answer = match[2].trim();
    if (/divirta-se|conhece alguma|brincacomigo/i.test(question)) continue;
    if (answer.includes('?')) continue;
    if (question.length < 12 || answer.length < 2) continue;
    items.push({ question, answer });
  }
  return items;
}

function parseDitos(html) {
  const items = [];
  const re = /"@type":"Question","name":"((?:\\.|[^"\\])*)","text":"(?:\\.|[^"\\])*","inLanguage":"pt-PT","acceptedAnswer":\{"@type":"Answer","text":"((?:\\.|[^"\\])*)"\}/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const question = match[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    const answer = match[2].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    if (question.length < 10 || !answer) continue;
    items.push({ question, answer });
  }
  return items;
}

function parseQueroBolsa(html) {
  const text = stripHtml(html);
  const items = [];
  const re = /(?:^|\s)\d+\.\s*([\s\S]*?)\?\s*Resposta:\s*([^.\n\[]+?)(?:\.|\s*\[|\s+\d+\.\s|$)/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const question = match[1].replace(/\s+/g, ' ').trim();
    const answer = match[2].trim().replace(/\.$/, '');
    if (question.length < 10 || !answer) continue;
    items.push({ question, answer });
  }
  return items;
}

const PARSERS = {
  pumpkin: parsePumpkin,
  santander: parseSantander,
  brincacomigo: parseBrincaComigo,
  ditos: parseDitos,
  querobolsa: parseQueroBolsa,
};

async function fetchSourceItems(source, options = {}) {
  const parser = PARSERS[source.slug];
  if (!parser) throw new Error(`Parser em falta: ${source.slug}`);

  let html;
  if (options.htmlBySlug?.[source.slug]) {
    html = options.htmlBySlug[source.slug];
  } else {
    html = await fetchHtml(source.url);
  }

  const rawItems = parser(html);
  return rawItems.map((item, index) => ({
    ...item,
    sourceSlug: source.slug,
    sourceName: source.name,
    sourceUrl: source.url,
    locale: source.locale,
    subtopic: source.subtopic,
    license: source.license,
    index,
  }));
}

async function fetchAllSources(options = {}) {
  const slugs = options.sources || SOURCES.map((s) => s.slug);
  const selected = SOURCES.filter((s) => slugs.includes(s.slug));
  const all = [];
  for (const source of selected) {
    const items = await fetchSourceItems(source, options);
    all.push(...items);
    if (!options.htmlBySlug) {
      await new Promise((r) => setTimeout(r, options.delayMs ?? 400));
    }
  }
  return all;
}

module.exports = {
  SOURCES,
  USER_AGENT,
  fetchHtml,
  fetchSourceItems,
  fetchAllSources,
  PARSERS,
};
