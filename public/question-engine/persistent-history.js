/**
 * Histórico persistente — localStorage v2→v3, persistência por faixa etária (Fase 8).
 * Anti-reuso entre sessões: entradas com ts nos últimos ANTI_REUSE_DAYS dias.
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
  const GAME_HISTORY_KEY = 'reino_magico_game_history_v1';
  const PERSISTENT_HISTORY_MAX = ENGINE_CONFIG.PERSISTENT_HISTORY_MAX;
  const ANTI_REUSE_DAYS = ENGINE_CONFIG.ANTI_REUSE_DAYS ?? 30;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

  function antiReuseCutoffMs(days = ANTI_REUSE_DAYS) {
    return Date.now() - days * MS_PER_DAY;
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

  function pruneEntriesByAge(entries, cutoff) {
    return trimHistoryEntries(
      (entries || []).filter((e) => (Number(e.ts) || 0) >= cutoff),
    );
  }

  function pruneStoreByAge(store, cutoff) {
    for (const age of Object.keys(store)) {
      store[age].entries = pruneEntriesByAge(store[age]?.entries || [], cutoff);
    }
    return store;
  }

  function collectGameHistoryEntries(cutoff) {
    const storage = getLocalStorage();
    const entries = [];
    if (!storage) return entries;
    try {
      const games = JSON.parse(storage.getItem(GAME_HISTORY_KEY) || '[]');
      if (!Array.isArray(games)) return entries;
      for (const game of games) {
        const gameTs = Date.parse(game.startedAt || '') || 0;
        if (gameTs < cutoff) continue;
        for (const round of game.rounds || []) {
          const question = round.question || '';
          const answer = round.correctAnswer || '';
          if (!question || !answer) continue;
          entries.push({
            q: question,
            a: answer,
            category: 0,
            format: round.format || '',
            knowledgeKey: '',
            knowledgeId: '',
            questionHash: questionHashFromPair(question, answer),
            ts: gameTs,
          });
        }
      }
    } catch (err) {
      warnHistoryStorage('histórico de partidas ilegível para anti-reuso', err);
    }
    return entries;
  }

  function getPersistentSlice(ageBandKey) {
    const bucket = loadPersistentHistory()[ageBandKey] || { entries: [] };
    const entries = (bucket.entries || []).slice(-ENGINE_CONFIG.MAX_RECENT_QUESTIONS);
    return {
      questions: entries.map((e) => e.q).filter(Boolean),
      answers: entries.map((e) => e.a).filter(Boolean),
      knowledgeKeys: entries.map((e) => e.knowledgeKey).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_KNOWLEDGE_KEYS),
      knowledgeIds: entries.map((e) => e.knowledgeId).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_KNOWLEDGE_KEYS),
      formats: entries.map((e) => e.format).filter(Boolean).slice(-ENGINE_CONFIG.MAX_RECENT_FORMATS),
      categories: entries.map((e) => e.category).filter((c) => c > 0),
      subtopics: entries.map((e) => e.subtopic).filter(Boolean),
      difficulties: entries.map((e) => e.difficulty).filter((d) => d > 0),
      entries,
    };
  }

  /**
   * Todas as perguntas jogadas nos últimos N dias (todas as faixas etárias).
   * Usado para impedir repetição entre sessões.
   */
  function getAntiReuseSnapshot(days = ANTI_REUSE_DAYS) {
    const cutoff = antiReuseCutoffMs(days);
    const store = loadPersistentHistory();
    const byHash = new Map();

    function addEntry(entry) {
      const ts = Number(entry.ts) || 0;
      if (ts < cutoff) return;
      const hash = String(entry.questionHash || '').trim()
        || questionHashFromPair(entry.q, entry.a);
      const prev = byHash.get(hash);
      if (!prev || ts > (Number(prev.ts) || 0)) {
        byHash.set(hash, { ...entry, questionHash: hash, ts });
      }
    }

    for (const bucket of Object.values(store)) {
      for (const entry of bucket?.entries || []) addEntry(entry);
    }
    for (const entry of collectGameHistoryEntries(cutoff)) addEntry(entry);

    const entries = [...byHash.values()];
    return {
      days,
      cutoff,
      entries,
      questionHashes: entries.map((e) => e.questionHash).filter(Boolean),
      knowledgeIds: [...new Set(entries.map((e) => String(e.knowledgeId || '').trim()).filter(Boolean))],
      knowledgeKeys: [...new Set(entries.map((e) => e.knowledgeKey).filter(Boolean))],
      questions: entries.map((e) => e.q).filter(Boolean),
    };
  }

  function persistQuestion(ageBandKey, question, answer, normalizeFn, meta) {
    const storage = getLocalStorage();
    if (!storage || !computeKnowledgeKey || !knowledgeKeysMatch) return;
    try {
      const cutoff = antiReuseCutoffMs();
      const store = pruneStoreByAge(loadPersistentHistory(), cutoff);
      if (!store[ageBandKey]) store[ageBandKey] = { entries: [] };
      const normQ = normalizeFn(question);
      const formatId = meta?.format || '';
      const qHash = meta?.questionHash || questionHashFromPair(question, answer);
      const entry = {
        q: question,
        a: answer,
        category: meta?.category || 0,
        format: formatId,
        knowledgeKey: meta?.knowledgeKey || computeKnowledgeKey(question, answer, formatId, normalizeFn, {
          knowledgeMeta: meta?.knowledge,
          categoryNumber: meta?.category,
        }),
        knowledgeId: meta?.knowledgeId ? String(meta.knowledgeId) : '',
        questionHash: qHash,
        difficulty: meta?.difficulty || 2,
        subtopic: meta?.subtopic || '',
        ts: Date.now(),
      };
      const entries = store[ageBandKey].entries || [];
      const kKey = entry.knowledgeKey;
      const kId = entry.knowledgeId;
      const dup = entries.some((e) => normalizeFn(e.q) === normQ)
        || entries.some((e) => e.knowledgeKey && knowledgeKeysMatch(e.knowledgeKey, kKey, normalizeFn))
        || (kId && entries.some((e) => e.knowledgeId && e.knowledgeId === kId))
        || (qHash && entries.some((e) => e.questionHash === qHash));
      if (!dup) entries.push(entry);
      store[ageBandKey].entries = trimHistoryEntries(entries);
      storage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(store));
    } catch (err) {
      warnHistoryStorage('persistência de pergunta falhou (quota ou storage cheio?)', err);
    }
  }

  global.QuestionEnginePersistentHistory = Object.freeze({
    getPersistentSlice,
    getAntiReuseSnapshot,
    persistQuestion,
    PERSISTENT_HISTORY_KEY,
    ANTI_REUSE_DAYS,
    questionHashFromPair,
  });
})(typeof window !== 'undefined' ? window : globalThis);
