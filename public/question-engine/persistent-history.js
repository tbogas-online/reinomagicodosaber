/**
 * Histórico persistente — localStorage v2→v3, persistência por faixa etária (Fase 8).
 */
(function (global) {
  'use strict';

  const Config = global.QuestionEngineConfig;
  if (!Config) {
    throw new Error('persistent-history: carrega engine-config.js antes deste módulo');
  }
  const { ENGINE_CONFIG, FORMAT_IDS } = Config;

  const KnowledgeKeyCompute = global.QuestionEngineKnowledgeKeyCompute;
  if (!KnowledgeKeyCompute) {
    throw new Error('persistent-history: carrega knowledge-key-compute.js antes deste módulo');
  }
  const { computeKnowledgeKey, knowledgeKeysMatch } = KnowledgeKeyCompute;

  const PERSISTENT_HISTORY_KEY = 'reino_magico_q_history_v3';
  const PERSISTENT_HISTORY_KEY_V2 = 'reino_magico_q_history_v2';
  const PERSISTENT_HISTORY_MAX = ENGINE_CONFIG.PERSISTENT_HISTORY_MAX;

  function getLocalStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (err) {
      warnHistoryStorage('localStorage indisponível', err);
    }
    return null;
  }

  function warnHistoryStorage(context, err) {
    try {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[QuestionEngine] ${context}`, err || '');
      }
    } catch { /* ignore */ }
  }

  function migrateHistoryV2() {
    const storage = getLocalStorage();
    if (!storage || !computeKnowledgeKey) return;
    try {
      const raw = storage.getItem(PERSISTENT_HISTORY_KEY_V2);
      if (!raw || storage.getItem(PERSISTENT_HISTORY_KEY)) return;
      const v2 = JSON.parse(raw);
      const v3 = {};
      for (const [age, bucket] of Object.entries(v2)) {
        const entries = [];
        const qs = bucket.questions || [];
        const as = bucket.answers || [];
        for (let i = 0; i < Math.max(qs.length, as.length); i += 1) {
          entries.push({
            q: qs[i] || '',
            a: as[i] || '',
            category: 0,
            format: '',
            knowledgeKey: computeKnowledgeKey(qs[i] || '', as[i] || '', FORMAT_IDS.RESPOSTA_DIRETA),
            difficulty: 2,
            subtopic: '',
            ts: Date.now() - (Math.max(qs.length, as.length) - i) * 1000,
          });
        }
        v3[age] = { entries };
      }
      storage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(v3));
    } catch (err) {
      warnHistoryStorage('migração de histórico persistente falhou', err);
    }
  }

  function loadPersistentHistory() {
    migrateHistoryV2();
    const storage = getLocalStorage();
    if (!storage) return {};
    try { return JSON.parse(storage.getItem(PERSISTENT_HISTORY_KEY) || '{}'); }
    catch (err) {
      warnHistoryStorage('histórico persistente corrompido ou ilegível', err);
      return {};
    }
  }

  function trimHistoryEntries(entries) {
    while (entries.length > PERSISTENT_HISTORY_MAX) entries.shift();
    return entries;
  }

  function getPersistentSlice(ageBandKey) {
    const bucket = loadPersistentHistory()[ageBandKey] || { entries: [] };
    const entries = (bucket.entries || []).slice(-ENGINE_CONFIG.MAX_RECENT_QUESTIONS);
    return {
      questions: entries.map((e) => e.q).filter(Boolean),
      answers: entries.map((e) => e.a).filter(Boolean),
      knowledgeKeys: entries.map((e) => e.knowledgeKey).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_KNOWLEDGE_KEYS),
      formats: entries.map((e) => e.format).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_FORMATS),
      categories: entries.map((e) => e.category).filter((c) => c > 0),
      subtopics: entries.map((e) => e.subtopic).filter(Boolean),
      difficulties: entries.map((e) => e.difficulty).filter((d) => d > 0),
      entries,
    };
  }

  function persistQuestion(ageBandKey, question, answer, normalizeFn, meta) {
    const storage = getLocalStorage();
    if (!storage || !computeKnowledgeKey || !knowledgeKeysMatch) return;
    try {
      const store = loadPersistentHistory();
      if (!store[ageBandKey]) store[ageBandKey] = { entries: [] };
      const normQ = normalizeFn(question);
      const formatId = meta?.format || '';
      const entry = {
        q: question,
        a: answer,
        category: meta?.category || 0,
        format: formatId,
        knowledgeKey: meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn, {
          knowledgeMeta: meta?.knowledge,
          categoryNumber: meta?.category,
        }),
        difficulty: meta?.difficulty || 2,
        subtopic: meta?.subtopic || '',
        ts: Date.now(),
      };
      const entries = store[ageBandKey].entries || [];
      const kKey = meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn, {
        knowledgeMeta: meta?.knowledge,
        categoryNumber: meta?.category,
      });
      const dup = entries.some((e) => normalizeFn(e.q) === normQ)
        || entries.some((e) => e.knowledgeKey && knowledgeKeysMatch(e.knowledgeKey, kKey, normalizeFn));
      if (!dup) entries.push(entry);
      store[ageBandKey].entries = trimHistoryEntries(entries);
      storage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(store));
    } catch (err) {
      warnHistoryStorage('persistência de pergunta falhou (quota ou storage cheio?)', err);
    }
  }

  global.QuestionEnginePersistentHistory = Object.freeze({
    getPersistentSlice,
    persistQuestion,
    PERSISTENT_HISTORY_KEY,
  });
})(typeof window !== 'undefined' ? window : globalThis);
