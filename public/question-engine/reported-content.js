/**
 * Conteúdo reportado — bloqueio local + sincronização com hashes do Supabase.
 * Perguntas reportadas só voltam após correcção explícita no servidor.
 */
(function (global) {
  'use strict';

  const REPORTED_CONTENT_KEY = 'reino_magico_reported_content_v1';
  const MAX_ENTRIES = 500;

  function getLocalStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch { /* ignore */ }
    return null;
  }

  function hashQuestionKey(text) {
    const s = String(text || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function questionHashFromPair(question, answer) {
    return hashQuestionKey(`${String(question || '')}|${String(answer || '')}`);
  }

  function loadStore() {
    const storage = getLocalStorage();
    if (!storage) return { entries: [] };
    try {
      const parsed = JSON.parse(storage.getItem(REPORTED_CONTENT_KEY) || '{}');
      return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    } catch {
      return { entries: [] };
    }
  }

  function saveStore(store) {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      const entries = (store.entries || []).slice(-MAX_ENTRIES);
      storage.setItem(REPORTED_CONTENT_KEY, JSON.stringify({ entries }));
    } catch { /* quota */ }
  }

  function normalizeQuestionNorm(question, normalizeFn) {
    const norm = typeof normalizeFn === 'function'
      ? normalizeFn(question)
      : String(question || '').trim().toLowerCase();
    return norm;
  }

  function registerReportedQuestion(meta, normalizeFn) {
    const question = String(meta?.question || '').trim();
    const answer = String(meta?.answer || '').trim();
    const questionHash = String(meta?.questionHash || '').trim()
      || (question && answer ? questionHashFromPair(question, answer) : '');
    if (!questionHash && !question) return null;

    const entry = {
      questionHash,
      questionNorm: normalizeQuestionNorm(question, normalizeFn),
      knowledgeId: String(meta?.knowledgeId || '').trim(),
      ts: Date.now(),
    };

    const store = loadStore();
    const entries = store.entries || [];
    const dup = entries.some((e) => (
      (questionHash && e.questionHash === questionHash)
      || (entry.questionNorm && e.questionNorm === entry.questionNorm)
      || (entry.knowledgeId && e.knowledgeId === entry.knowledgeId)
    ));
    if (!dup) entries.push(entry);
    store.entries = entries;
    saveStore(store);
    return entry;
  }

  function mergeReportedHashesFromServer(hashes) {
    if (!Array.isArray(hashes) || !hashes.length) return;
    const store = loadStore();
    const known = new Set((store.entries || []).map((e) => e.questionHash).filter(Boolean));
    for (const hash of hashes) {
      const h = String(hash || '').trim();
      if (!h || known.has(h)) continue;
      store.entries.push({ questionHash: h, questionNorm: '', knowledgeId: '', ts: Date.now() });
      known.add(h);
    }
    saveStore(store);
  }

  function getReportedSnapshot(normalizeFn) {
    const hashes = new Set();
    const questionNorms = new Set();
    const knowledgeIds = new Set();

    for (const entry of loadStore().entries || []) {
      const h = String(entry.questionHash || '').trim();
      if (h) hashes.add(h);
      const norm = String(entry.questionNorm || '').trim()
        || (entry.question ? normalizeQuestionNorm(entry.question, normalizeFn) : '');
      if (norm) questionNorms.add(norm);
      const kid = String(entry.knowledgeId || '').trim();
      if (kid) knowledgeIds.add(kid);
    }

    return {
      hashes: [...hashes],
      questionNorms: [...questionNorms],
      knowledgeIds: [...knowledgeIds],
    };
  }

  function getReportedContentValidationCtx(normalizeFn) {
    const snap = getReportedSnapshot(normalizeFn);
    return {
      blockedQuestionHashes: snap.hashes,
      blockedQuestionNorms: snap.questionNorms,
      blockedKnowledgeIds: snap.knowledgeIds,
    };
  }

  global.QuestionEngineReportedContent = Object.freeze({
    registerReportedQuestion,
    mergeReportedHashesFromServer,
    getReportedSnapshot,
    getReportedContentValidationCtx,
    questionHashFromPair,
    REPORTED_CONTENT_KEY,
  });
})(typeof window !== 'undefined' ? window : globalThis);
