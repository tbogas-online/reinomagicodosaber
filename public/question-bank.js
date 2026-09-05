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

  function isConfigured() {
    return !!global.ReinoSupabase?.isConfigured?.();
  }

  async function ensureClient() {
    return global.ReinoSupabase?.ensureClient?.() ?? null;
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
    if (format === 'VERDADEIRO_FALSO' || format === 'CURIOSIDADE' || norm === 'verdadeiro' || norm === 'falso') {
      return 2;
    }
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
    if (!normalized.includes(stripTags(correctAnswer).toLowerCase())) return false;
    if (format === 'VERDADEIRO_FALSO' || format === 'CURIOSIDADE') {
      const normA = stripTags(correctAnswer).toLowerCase();
      if (normA !== 'verdadeiro' && normA !== 'falso') return false;
      return normalized.includes('verdadeiro') && normalized.includes('falso');
    }
    const adivinhaDistractors = global.QuestionEngineAdivinhaDistractors;
    if (format === 'ADIVINHA' && adivinhaDistractors?.hasBadAdivinhaMcOptions
      && adivinhaDistractors.hasBadAdivinhaMcOptions(cleaned, correctAnswer, stripTags)) {
      return false;
    }
    return true;
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
   * @param {string[]} excludeHashes — question_hash já vistos nesta ronda
   * @param {string[]} excludeKnowledgeIds — knowledgeId já usados (sessão + histórico)
   */
  async function pick(categoryN, ageBand, excludeHashes, excludeKnowledgeIds, requestedDifficulty = null) {
    const c = await ensureClient();
    if (!c) return null;
    const req = Number(requestedDifficulty);
    const args = {
      p_category_n: categoryN,
      p_age_band: ageBand,
      p_exclude_hashes: Array.isArray(excludeHashes) ? excludeHashes : [],
      p_exclude_knowledge_ids: Array.isArray(excludeKnowledgeIds) ? excludeKnowledgeIds : [],
      p_requested_difficulty: Number.isFinite(req)
        ? Math.max(1, Math.min(5, Math.round(req)))
        : null,
    };
    let { data, error } = await c.rpc('pick_question_from_bank', args);
    if (error && /could not choose the best candidate function/i.test(String(error.message || ''))) {
      console.warn(
        '[QuestionBank] pick falhou: overload ambíguo em pick_question_from_bank — executa supabase/question-bank-pick-drop-4arg-overload.sql no Supabase.',
      );
    }
    if (error && /p_requested_difficulty|reino_bank_effective_difficulty/i.test(String(error.message || ''))) {
      const fallbackArgs = { ...args };
      delete fallbackArgs.p_requested_difficulty;
      ({ data, error } = await c.rpc('pick_question_from_bank', fallbackArgs));
    }
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
    const roundDifficulty = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : null;
    };
    const rpcArgs = {
      p_category_n: meta.categoryN,
      p_age_band: meta.ageBand,
      p_question: meta.question,
      p_correct_answer: meta.correctAnswer,
      p_question_hash: meta.questionHash,
      p_options: meta.options || null,
      p_format: meta.format || null,
      p_knowledge_key: meta.knowledgeKey || null,
      p_source: meta.source || 'ai',
      p_knowledge_id: meta.knowledgeId || null,
      p_source_id: meta.sourceId || null,
      p_confidence: meta.confidence ?? null,
      p_difficulty: roundDifficulty(meta.difficulty),
      p_estimated_difficulty: roundDifficulty(meta.estimatedDifficulty),
    };
    let { data, error } = await c.rpc('save_question_to_bank', rpcArgs);
    if (error && /p_estimated_difficulty/i.test(String(error.message || ''))) {
      const fallbackArgs = { ...rpcArgs };
      delete fallbackArgs.p_estimated_difficulty;
      ({ data, error } = await c.rpc('save_question_to_bank', fallbackArgs));
    }
    if (error) {
      console.warn('[QuestionBank] save falhou:', error.message);
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  async function markReported(questionHashValue, knowledgeId) {
    const c = await ensureClient();
    if (!c || !questionHashValue) return { ok: false };
    const { data, error } = await c.rpc('mark_question_reported', {
      p_question_hash: questionHashValue,
      p_knowledge_id: knowledgeId || null,
    });
    if (error) {
      console.warn('[QuestionBank] markReported falhou:', error.message);
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  async function fetchReportedHashes() {
    const c = await ensureClient();
    if (!c) return [];
    const { data, error } = await c.rpc('get_reported_question_hashes');
    if (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[QuestionBank] fetchReportedHashes:', error.message);
      }
      return [];
    }
    const hashes = data?.hashes;
    return Array.isArray(hashes) ? hashes.filter(Boolean) : [];
  }

  /**
   * Regista pergunta mostrada ao jogador (anti-reuso global 30 dias no Supabase).
   */
  async function recordPlay(meta) {
    const c = await ensureClient();
    if (!c || !meta?.questionHash) return { ok: false };
    const { data, error } = await c.rpc('record_question_reuse', {
      p_question_hash: meta.questionHash,
      p_knowledge_id: meta.knowledgeId || null,
      p_category_n: meta.categoryN ?? null,
      p_age_band: meta.ageBand || null,
    });
    if (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[QuestionBank] recordPlay:', error.message);
      }
      return { ok: false, error };
    }
    return data || { ok: true };
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

  const VALID_AGE_BANDS_LIST = ['6-9', '10-15', '15+'];

  async function getCoverage() {
    const c = await ensureClient();
    if (!c) return [];
    const { data, error } = await c.rpc('get_question_bank_coverage');
    if (error) {
      console.warn('[QuestionBank] coverage falhou:', error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  }

  async function pickSparseTarget(categories, { fixedCategoryN = null, fixedAgeBand = null } = {}) {
    const cats = Array.isArray(categories) ? categories : [];
    if (!cats.length) return null;
    const coverage = await getCoverage();
    const counts = new Map();
    for (const row of coverage) {
      const cat = Number(row.category_n);
      const age = String(row.age_band || '');
      if (!cat || !VALID_AGE_BANDS.has(age)) continue;
      counts.set(`${cat}|${age}`, Number(row.count) || 0);
    }
    const candidates = [];
    for (const cat of cats) {
      const catN = Number(cat.n ?? cat.categoryN ?? cat);
      if (!catN) continue;
      if (fixedCategoryN && catN !== fixedCategoryN) continue;
      for (const age of VALID_AGE_BANDS_LIST) {
        if (fixedAgeBand && age !== fixedAgeBand) continue;
        candidates.push({
          categoryN: catN,
          ageBand: age,
          count: counts.get(`${catN}|${age}`) || 0,
        });
      }
    }
    if (!candidates.length) return null;
    const min = Math.min(...candidates.map((item) => item.count));
    const tied = candidates.filter((item) => item.count === min);
    return tied[Math.floor(Math.random() * tied.length)];
  }

  async function countPlayable(categoryN, ageBand) {
    const c = await ensureClient();
    if (!c) return null;
    const { data, error } = await c.rpc('count_playable_bank_questions', {
      p_category_n: categoryN,
      p_age_band: ageBand,
    });
    if (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[QuestionBank] countPlayable:', error.message);
      }
      return null;
    }
    return Number(data) || 0;
  }

  async function replenishFromKnowledge({ categoryN = 20, ageBand, limit = 40, force = false } = {}) {
    if (!VALID_AGE_BANDS.has(ageBand)) return { ok: false, reason: 'invalid_age_band' };
    try {
      const response = await fetch('/api/bank-replenish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryN, ageBand, limit, force }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: data.error || `HTTP ${response.status}` };
      }
      return data;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function queuePendingReview(meta) {
    const issueCodes = Array.isArray(meta.issueCodes) ? meta.issueCodes.filter(Boolean) : [];
    if (!meta?.questionHash && (!meta?.question || !meta?.correctAnswer)) {
      return { ok: false, reason: 'missing_content' };
    }
    const payload = {
      questionHash: meta.questionHash,
      categoryN: meta.categoryN,
      ageBand: meta.ageBand,
      question: meta.question,
      correctAnswer: meta.correctAnswer,
      options: meta.options || null,
      format: meta.format || null,
      requestedDifficulty: meta.requestedDifficulty,
      estimatedDifficulty: meta.estimatedDifficulty,
      issueCodes,
      knowledgeKey: meta.knowledgeKey || null,
      knowledgeId: meta.knowledgeId || null,
      source: meta.source || null,
      sourceId: meta.sourceId || null,
      confidence: meta.confidence ?? null,
      gameMode: meta.gameMode || 'local',
    };

    try {
      const response = await fetch('/api/pending-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
    } catch { /* fallback RPC */ }

    const c = await ensureClient();
    if (!c || !meta?.questionHash) return { ok: false };
    const { data, error } = await c.rpc('queue_question_pending_review', {
      p_question_hash: meta.questionHash,
      p_category_n: meta.categoryN,
      p_age_band: meta.ageBand,
      p_question: meta.question,
      p_correct_answer: meta.correctAnswer,
      p_options: meta.options || null,
      p_format_id: meta.format || null,
      p_requested_difficulty: meta.requestedDifficulty != null
        ? Math.round(Number(meta.requestedDifficulty))
        : null,
      p_estimated_difficulty: meta.estimatedDifficulty != null
        ? Math.round(Number(meta.estimatedDifficulty))
        : null,
      p_issue_codes: issueCodes,
      p_knowledge_key: meta.knowledgeKey || null,
      p_knowledge_id: meta.knowledgeId || null,
      p_source: meta.source || null,
      p_source_id: meta.sourceId || null,
      p_confidence: meta.confidence ?? null,
      p_game_mode: meta.gameMode || 'local',
    });
    if (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[QuestionBank] queuePendingReview:', error.message);
      }
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  global.QuestionBank = {
    isConfigured,
    stripTags,
    hashQuestionKey,
    questionHash,
    hasValidMcOptions,
    getCoverage,
    pickSparseTarget,
    collectLocalStorageQuestions,
    importFromLocalStorage,
    countPlayable,
    replenishFromKnowledge,
    pick,
    save,
    queuePendingReview,
    markReported,
    fetchReportedHashes,
    recordPlay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
