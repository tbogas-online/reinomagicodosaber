/**
 * Wikidata no motor: SPARQL obtém conjuntos (import);
 * REST v1 confirma um Q-id (labels/descrições/aliases).
 * Falha de rede = segue; contradição clara = rejeita o facto.
 * Docs: https://www.wikidata.org/w/rest.php/wikibase/v1
 */
(function (global) {
  'use strict';

  const WIKIDATA_REST = 'https://www.wikidata.org/w/rest.php/wikibase/v1';
  const DEFAULT_TIMEOUT_MS = 4000;
  const USER_AGENT = 'ReinoMagicoDoSaber/1.0 (knowledge-verify; educational quiz)';
  const PT_LANGS = ['pt', 'pt-pt', 'pt-br', 'en'];

  function normalizePlain(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function tokens(value) {
    return normalizePlain(value).split(' ').filter((tok) => tok.length >= 4);
  }

  function extractWikidataQid(...values) {
    for (const value of values) {
      const match = String(value || '').match(/\bQ\d+\b/i);
      if (match) return match[0].toUpperCase();
    }
    return '';
  }

  function isWikidataSource(record) {
    if (!record) return false;
    if (extractWikidataQid(record.sourceId, record.source_id, record.sourceUrl, record.source_url, record.source)) {
      return true;
    }
    const blob = [
      record.source,
      record.sourceId,
      record.source_id,
      record.sourceUrl,
      record.source_url,
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    return blob.includes('wikidata');
  }

  function shouldRequestWikidataVerify(record, ctx = {}) {
    if (!record || !isWikidataSource(record)) return false;
    const fmt = String(ctx.formatId || record.formatId || record.format || '').trim().toUpperCase();
    if (fmt === 'ADIVINHA') return false;
    return true;
  }

  function pushLangValue(texts, entry) {
    if (entry == null) return;
    if (typeof entry === 'string') {
      if (entry.trim()) texts.push(entry);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item) => pushLangValue(texts, item));
      return;
    }
    if (typeof entry === 'object' && entry.value) texts.push(String(entry.value));
  }

  function collectEntityTexts(entity) {
    const texts = [];
    ['labels', 'descriptions'].forEach((key) => {
      const bag = entity?.[key];
      if (!bag || typeof bag !== 'object') return;
      Object.keys(bag).forEach((lang) => pushLangValue(texts, bag[lang]));
    });
    const aliases = entity?.aliases;
    if (aliases && typeof aliases === 'object') {
      Object.keys(aliases).forEach((lang) => pushLangValue(texts, aliases[lang]));
    }
    return texts;
  }

  function langValue(bag, langs = PT_LANGS) {
    if (!bag || typeof bag !== 'object') return '';
    for (const lang of langs) {
      const raw = bag[lang];
      if (typeof raw === 'string' && raw.trim()) return raw.trim();
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.value) return String(raw.value).trim();
      if (Array.isArray(raw) && raw[0]) {
        const first = raw[0];
        if (typeof first === 'string') return first.trim();
        if (first?.value) return String(first.value).trim();
      }
    }
    return '';
  }

  function evaluateWikidataSupport(record, entity) {
    if (!entity) return { ok: true, skipped: true, reason: 'no_entity' };
    const answer = normalizePlain(record?.answer);
    if (!answer) return { ok: true, skipped: true, reason: 'no_answer' };
    if (/^(verdadeiro|falso)$/.test(answer)) {
      return { ok: true, skipped: true, reason: 'true_false' };
    }
    const texts = collectEntityTexts(entity).map(normalizePlain).filter(Boolean);
    if (!texts.length) return { ok: true, skipped: true, reason: 'empty_entity' };
    if (texts.some((text) => text === answer || text.includes(answer) || answer.includes(text))) {
      return { ok: true, matched: true, qid: entity.id || '' };
    }
    const answerTokens = tokens(answer);
    const blob = texts.join(' ');
    const overlap = answerTokens.filter((tok) => blob.includes(tok));
    if (answerTokens.length && overlap.length >= Math.min(2, answerTokens.length)) {
      return { ok: true, matched: true, qid: entity.id || '' };
    }
    return {
      ok: false,
      qid: entity.id || '',
      code: 'WIKIDATA_CONTRADICTION',
      issues: [`Wikidata (${entity.id || 'entidade'}) não confirma a resposta «${String(record.answer || '').trim()}».`],
    };
  }

  function itemUrl(qid, fields = ['labels', 'descriptions', 'aliases']) {
    const id = String(qid || '').trim().toUpperCase();
    const fieldList = encodeURIComponent((fields || []).join(','));
    return `${WIKIDATA_REST}/entities/items/${id}?_fields=${fieldList}`;
  }

  async function fetchJson(url, fetchFn, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: controller?.signal,
      });
      if (!response?.ok) throw new Error(`Wikidata REST HTTP ${response?.status || 0}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchItem(qid, fetchFn, timeoutMs) {
    return fetchJson(itemUrl(qid), fetchFn, timeoutMs);
  }

  function buildVerifiedAiInput(record, item) {
    const qid = extractWikidataQid(
      record?.sourceId,
      record?.source_id,
      record?.sourceUrl,
      record?.source_url,
      item?.id,
    );
    return {
      knowledgeId: record?.knowledgeId || record?.knowledge_id || '',
      qid,
      fact: String(record?.fact || '').trim(),
      answer: String(record?.answer || '').trim(),
      label: langValue(item?.labels),
      description: langValue(item?.descriptions) || String(record?.metadata?.restDescription || ''),
      source: 'Wikidata',
      sourceId: qid,
      sourceUrl: qid ? `https://www.wikidata.org/wiki/${qid}` : '',
      instruction: 'NÃO inventes factos. Formula a pergunta só a partir deste facto verificado.',
    };
  }

  async function verifyAgainstWikidata(record, opts = {}) {
    if (!shouldRequestWikidataVerify(record, opts)) {
      return { ok: true, skipped: true, reason: 'not_applicable' };
    }
    const answer = normalizePlain(record?.answer);
    if (/^(verdadeiro|falso)$/.test(answer)) {
      return { ok: true, skipped: true, reason: 'true_false' };
    }
    const fetchFn = opts.fetch || global.fetch;
    if (typeof fetchFn !== 'function') {
      return { ok: true, skipped: true, reason: 'no_fetch' };
    }
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
    try {
      const qid = extractWikidataQid(record.sourceId, record.source_id, record.sourceUrl, record.source_url, record.source);
      if (!qid) return { ok: true, skipped: true, reason: 'no_qid' };
      const entity = await fetchItem(qid, fetchFn, timeoutMs);
      return evaluateWikidataSupport(record, entity);
    } catch (err) {
      return { ok: true, skipped: true, reason: 'network', error: String(err?.message || err) };
    }
  }

  global.QuestionEngineWikidataVerify = Object.freeze({
    REST_BASE: WIKIDATA_REST,
    isWikidataSource,
    extractWikidataQid,
    shouldRequestWikidataVerify,
    evaluateWikidataSupport,
    itemUrl,
    fetchItem,
    buildVerifiedAiInput,
    verifyAgainstWikidata,
    verifyCuriosityAgainstWikidata: verifyAgainstWikidata,
  });
})(typeof window !== 'undefined' ? window : globalThis);
