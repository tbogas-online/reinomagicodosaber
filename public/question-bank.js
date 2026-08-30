/**
 * Banco de perguntas Supabase — guardar IA, escolher em fallback, excluir reportadas.
 * Requer: @supabase/supabase-js, supabase-config.js, auth anónima activa.
 */
(function (global) {
  'use strict';

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

  /**
   * Escolhe uma pergunta do banco Supabase (não reportada).
   * @param {number} categoryN
   * @param {string} ageBand
   * @param {string[]} [excludeHashes]
   * @returns {Promise<object|null>}
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

  /**
   * Guarda pergunta validada por IA. Ignora se já existir ou estiver reportada.
   */
  async function save(meta) {
    const c = await ensureClient();
    if (!c || !meta?.questionHash) return { ok: false };
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

  /**
   * Marca pergunta como reportada — deixa de ser usada nem re-inserida.
   */
  async function markReported(questionHash) {
    const c = await ensureClient();
    if (!c || !questionHash) return { ok: false };
    const { data, error } = await c.rpc('mark_question_reported', {
      p_question_hash: questionHash,
    });
    if (error) {
      console.warn('[QuestionBank] markReported falhou:', error.message);
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  global.QuestionBank = {
    isConfigured,
    pick,
    save,
    markReported,
  };
})(typeof window !== 'undefined' ? window : globalThis);
