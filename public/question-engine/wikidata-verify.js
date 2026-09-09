/**
 * KR-2.3 — verificação Wikidata em último recurso para curiosidades.
 * Não usa LLM. Falha de rede = segue; contradição clara = rejeita o facto.
 */
(function (global) {
  'use strict';

  const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
  const DEFAULT_TIMEOUT_MS = 4000;
  const USER_AGENT = 'ReinoMagicoDoSaber/1.0 (knowledge-verify; educational quiz)';

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
    const cat = Number(ctx.categoryNumber ?? ctx.category ?? record.category ?? record.category_n ?? 20);
    if (cat !== 20) return false;
    const fmt = String(ctx.formatId || record.formatId || record.format || '').trim().toUpperCase();
    if (fmt && fmt !== 'CURIOSIDADE' && fmt !== 'VERDADEIRO_FALSO') return false;
    return true;
  }

  function collectEntityTexts(entity) {
    const texts = [];
    const pushValue = (item) => {
      const value = item && typeof item === 'object' ? item.value : item;
      if (value) texts.push(String(value));
    };
    ['labels', 'descriptions'].forEach((key) => {
      const bag = entity?.[key];
      if (!bag || typeof bag !== 'object') return;
      Object.keys(bag).forEach((lang) => pushValue(bag[lang]));
    });
    const aliases = entity?.aliases;
    if (aliases && typeof aliases === 'object') {
      Object.keys(aliases).forEach((lang) => {
        (aliases[lang] || []).forEach(pushValue);
      });
    }
    return texts;
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

  function apiUrl(params) {
    const search = new URLSearchParams({ format: 'json', origin: '*', ...params });
    return `${WIKIDATA_API}?${search.toString()}`;
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
      if (!response?.ok) throw new Error(`Wikidata HTTP ${response?.status || 0}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchEntity(qid, fetchFn, timeoutMs) {
    const data = await fetchJson(apiUrl({
      action: 'wbgetentities',
      ids: qid,
      props: 'labels|aliases|descriptions',
      languages: 'pt|en|pt-br',
    }), fetchFn, timeoutMs);
    return data?.entities?.[qid] || data?.entities?.[qid.toUpperCase()] || null;
  }

  async function searchEntity(query, fetchFn, timeoutMs) {
    const data = await fetchJson(apiUrl({
      action: 'wbsearchentities',
      search: String(query || '').slice(0, 80),
      language: 'pt',
      uselang: 'pt',
      type: 'item',
      limit: '1',
    }), fetchFn, timeoutMs);
    const hit = Array.isArray(data?.search) ? data.search[0] : null;
    const qid = hit?.id;
    if (!qid) return null;
    return fetchEntity(qid, fetchFn, timeoutMs);
  }

  async function verifyCuriosityAgainstWikidata(record, opts = {}) {
    if (!shouldRequestWikidataVerify(record, opts)) {
      return { ok: true, skipped: true, reason: 'not_applicable' };
    }
    const fetchFn = opts.fetch || global.fetch;
    if (typeof fetchFn !== 'function') {
      return { ok: true, skipped: true, reason: 'no_fetch' };
    }
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
    try {
      const qid = extractWikidataQid(record.sourceId, record.source_id, record.sourceUrl, record.source_url, record.source);
      const entity = qid
        ? await fetchEntity(qid, fetchFn, timeoutMs)
        : await searchEntity(record.answer, fetchFn, timeoutMs);
      return evaluateWikidataSupport(record, entity);
    } catch (err) {
      return { ok: true, skipped: true, reason: 'network', error: String(err?.message || err) };
    }
  }

  global.QuestionEngineWikidataVerify = Object.freeze({
    isWikidataSource,
    extractWikidataQid,
    shouldRequestWikidataVerify,
    evaluateWikidataSupport,
    verifyCuriosityAgainstWikidata,
  });
})(typeof window !== 'undefined' ? window : globalThis);
