/**
 * Banco de perguntas Supabase — guardar IA, escolher em fallback, excluir reportadas.
 * Requer: @supabase/supabase-js, supabase-config.js, auth anónima activa.
 */
(function (global) {
  'use strict';

  const VALID_AGE_BANDS = new Set(['6-9', '10-15', '15+']);
  const GAME_HISTORY_KEY = 'reino_magico_game_history_v1';
  const ENGINE_HISTORY_KEY = 'reino_magico_q_history_v3';
  const ENGINE_HISTORY_KEY_V2 = 'reino_magico_q_history_v2';

  const CATEGORY_NAME_TO_N = {
    'Conhecimentos Gerais': 1,
    Geografia: 2,
    História: 3,
    Ciência: 4,
    Natureza: 5,
    Espaço: 6,
    'Matemática e Lógica': 7,
    Literatura: 8,
    Português: 9,
    Arte: 10,
    'Cinema e Séries': 11,
    Música: 12,
    Moda: 13,
    Gastronomia: 14,
    Desporto: 15,
    Jogos: 16,
    Tecnologia: 17,
    'Culturas do Mundo': 18,
    Transportes: 19,
    'Adivinhas e Curiosidades': 20,
  };

  let client = null;

  function getConfig() {
    const cfg = global.SUPABASE_CONFIG || {};
    return {
      url: (cfg.url || '').trim(),
      anonKey: (cfg.anonKey || '').trim(),
    };
  }

  function isConfigured() {
    const { url, anonKey } = getConfig();
    return !!(url && anonKey && global.supabase?.createClient);
  }

  function getAuthStorage() {
    try {
      if (global.sessionStorage) return global.sessionStorage;
    } catch { /* ignore */ }
    return undefined;
  }

  function getLocalStorage() {
    try {
      if (global.localStorage) return global.localStorage;
    } catch { /* ignore */ }
    return null;
  }

  function stripTags(str) {
    return String(str || '').replace(/<[^>]*>/g, '').trim();
  }

  function parseOptionsArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch { /* ignore */ }
    }
    return null;
  }

  function expectedOptionCount(format, correctAnswer) {
    const norm = stripTags(correctAnswer).toLowerCase();
    if (format === 'VERDADEIRO_FALSO' || norm === 'verdadeiro' || norm === 'falso') return 2;
    return 4;
  }

  function hasValidMcOptions(options, format, correctAnswer) {
    const opts = parseOptionsArray(options);
    if (!opts || !opts.length) return false;
    const expected = expectedOptionCount(format, correctAnswer);
    const cleaned = opts.map((o) => String(o || '').trim()).filter((o) => o.length > 0);
    if (cleaned.length !== expected) return false;
    const normalized = cleaned.map((o) => stripTags(o).toLowerCase());
    if (new Set(normalized).size !== expected) return false;
    return normalized.includes(stripTags(correctAnswer).toLowerCase());
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

  function questionHash(question, answer) {
    return hashQuestionKey(`${stripTags(question)}|${stripTags(answer)}`);
  }

  function categoryNameToN(name) {
    return CATEGORY_NAME_TO_N[String(name || '').trim()] || null;
  }

  async function ensureClient() {
    if (!isConfigured()) return null;
    if (client) return client;
    const { url, anonKey } = getConfig();
    const authStorage = getAuthStorage();
    client = global.supabase.createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(authStorage ? { storage: authStorage } : {}),
      },
    });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const signIn = await client.auth.signInAnonymously();
      if (signIn.error) throw signIn.error;
    }
    return client;
  }

  function collectFromGameHistory(storage, byHash) {
    let raw;
    try {
      raw = storage.getItem(GAME_HISTORY_KEY);
    } catch { return; }
    let games;
    try {
      games = raw ? JSON.parse(raw) : [];
    } catch { return; }
    if (!Array.isArray(games)) return;

    for (const game of games) {
      for (const round of game.rounds || []) {
        const categoryN = categoryNameToN(round.category);
        const ageBand = round.ageBand || '';
        const question = round.question || '';
        const correctAnswer = round.correctAnswer || '';
        if (!categoryN || !VALID_AGE_BANDS.has(ageBand) || !question || !correctAnswer) continue;
        const h = questionHash(question, correctAnswer);
        if (byHash.has(h)) continue;
        byHash.set(h, {
          categoryN,
          ageBand,
          question,
          correctAnswer,
          options: Array.isArray(round.options) ? round.options : null,
          format: round.format || null,
          knowledgeKey: null,
          questionHash: h,
          source: 'local-history',
        });
      }
    }
  }

  function collectFromEngineHistory(storage, byHash) {
    let store;
    try {
      const raw = storage.getItem(ENGINE_HISTORY_KEY);
      store = raw ? JSON.parse(raw) : {};
    } catch { return; }
    if (!store || typeof store !== 'object') return;

    for (const [ageBand, bucket] of Object.entries(store)) {
      if (!VALID_AGE_BANDS.has(ageBand)) continue;
      for (const entry of bucket?.entries || []) {
        const categoryN = Number(entry.category) || 0;
        const question = entry.q || '';
        const correctAnswer = entry.a || '';
        if (categoryN < 1 || categoryN > 20 || !question || !correctAnswer) continue;
        const h = questionHash(question, correctAnswer);
        if (byHash.has(h)) continue;
        byHash.set(h, {
          categoryN,
          ageBand,
          question,
          correctAnswer,
          options: null,
          format: entry.format || null,
          knowledgeKey: entry.knowledgeKey || null,
          questionHash: h,
          source: 'local-engine',
        });
      }
    }
  }

  function collectFromEngineHistoryV2(storage, byHash) {
    let store;
    try {
      const raw = storage.getItem(ENGINE_HISTORY_KEY_V2);
      if (!raw || storage.getItem(ENGINE_HISTORY_KEY)) return;
      store = JSON.parse(raw);
    } catch { return; }
    if (!store || typeof store !== 'object') return;

    for (const [ageBand, bucket] of Object.entries(store)) {
      if (!VALID_AGE_BANDS.has(ageBand)) continue;
      const qs = bucket?.questions || [];
      const as = bucket?.answers || [];
      const len = Math.max(qs.length, as.length);
      for (let i = 0; i < len; i++) {
        const question = qs[i] || '';
        const correctAnswer = as[i] || '';
        if (!question || !correctAnswer) continue;
        const h = questionHash(question, correctAnswer);
        if (byHash.has(h)) continue;
        byHash.set(h, {
          categoryN: 0,
          ageBand,
          question,
          correctAnswer,
          options: null,
          format: null,
          knowledgeKey: null,
          questionHash: h,
          source: 'local-engine-v2',
        });
      }
    }
  }

  /**
   * Lê perguntas únicas do localStorage deste dispositivo.
   */
  function collectLocalStorageQuestions() {
    const storage = getLocalStorage();
    const byHash = new Map();
    if (!storage) return [];

    collectFromGameHistory(storage, byHash);
    collectFromEngineHistory(storage, byHash);
    collectFromEngineHistoryV2(storage, byHash);

    return [...byHash.values()].filter((item) => item.categoryN >= 1 && item.categoryN <= 20);
  }

  /**
   * Escolhe uma pergunta do banco Supabase (não reportada).
   */
  async function pick(categoryN, ageBand, excludeHashes) {
    const c = await ensureClient();
    if (!c) return null;
    const { data, error } = await c.rpc('pick_question_from_bank', {
      p_category_n: categoryN,
      p_age_band: ageBand,
      p_exclude_hashes: Array.isArray(excludeHashes) ? excludeHashes : [],
    });
    if (error) {
      console.warn('[QuestionBank] pick falhou:', error.message);
      return null;
    }
    if (!data || typeof data !== 'object' || !data.q) return null;
    return data;
  }

  async function save(meta) {
    const c = await ensureClient();
    if (!c || !meta?.questionHash) return { ok: false };
    if (!hasValidMcOptions(meta.options, meta.format, meta.correctAnswer)) {
      return { ok: false, reason: 'missing_options' };
    }
    const { data, error } = await c.rpc('save_question_to_bank', {
      p_category_n: meta.categoryN,
      p_age_band: meta.ageBand,
      p_question: meta.question,
      p_correct_answer: meta.correctAnswer,
      p_question_hash: meta.questionHash,
      p_options: meta.options || null,
      p_format: meta.format || null,
      p_knowledge_key: meta.knowledgeKey || null,
      p_source: meta.source || 'ai',
    });
    if (error) {
      console.warn('[QuestionBank] save falhou:', error.message);
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  async function markReported(questionHashValue) {
    const c = await ensureClient();
    if (!c || !questionHashValue) return { ok: false };
    const { data, error } = await c.rpc('mark_question_reported', {
      p_question_hash: questionHashValue,
    });
    if (error) {
      console.warn('[QuestionBank] markReported falhou:', error.message);
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  /**
   * Envia o histórico local deste browser para o banco Supabase.
   */
  async function importFromLocalStorage({ batchSize = 40, onProgress } = {}) {
    const items = collectLocalStorageQuestions();
    const result = {
      ok: false,
      scanned: items.length,
      inserted: 0,
      exists: 0,
      skipped: 0,
      batches: 0,
    };
    if (!items.length) {
      result.ok = true;
      return result;
    }

    const c = await ensureClient();
    if (!c) {
      result.error = 'Supabase não configurado';
      return result;
    }

    const validItems = items.filter((item) =>
      hasValidMcOptions(item.options, item.format, item.correctAnswer)
    );
    result.skipped += items.length - validItems.length;

    for (let i = 0; i < validItems.length; i += batchSize) {
      const batch = validItems.slice(i, i + batchSize).map((item) => ({
        category_n: item.categoryN,
        age_band: item.ageBand,
        question: item.question,
        correct_answer: item.correctAnswer,
        question_hash: item.questionHash,
        options: item.options,
        format: item.format,
        knowledge_key: item.knowledgeKey,
        source: item.source,
      }));
      const { data, error } = await c.rpc('import_questions_batch', { p_items: batch });
      result.batches += 1;
      if (error) {
        console.warn('[QuestionBank] import batch falhou:', error.message);
        result.error = error.message;
        return result;
      }
      result.inserted += Number(data?.inserted) || 0;
      result.exists += Number(data?.exists) || 0;
      result.skipped += Number(data?.skipped) || 0;
      if (typeof onProgress === 'function') {
        onProgress({
          done: Math.min(i + batch.length, validItems.length),
          total: validItems.length,
          ...result,
        });
      }
    }

    result.ok = true;
    return result;
  }

  global.QuestionBank = {
    isConfigured,
    stripTags,
    hashQuestionKey,
    questionHash,
    hasValidMcOptions,
    collectLocalStorageQuestions,
    importFromLocalStorage,
    pick,
    save,
    markReported,
  };
})(typeof window !== 'undefined' ? window : globalThis);
