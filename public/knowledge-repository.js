/**
 * Knowledge Repository — factos verificados no Supabase (KR-0).
 * A IA formula perguntas a partir destes registos; não inventa o facto.
 */
(function (global) {
  'use strict';

  const VALID_AGE_BANDS = new Set(['6-9', '10-15', '15+']);

  function isConfigured() {
    return !!global.ReinoSupabase?.isConfigured?.();
  }

  async function ensureClient() {
    return global.ReinoSupabase?.ensureClient?.() ?? null;
  }

  /**
   * Normaliza resposta RPC pick_knowledge_record → objeto estável no cliente.
   */
  function rowToRecord(row) {
    if (!row || typeof row !== 'object') return null;
    const knowledgeId = row.knowledgeId || row.knowledge_id;
    if (!knowledgeId) return null;
    return {
      knowledgeId: String(knowledgeId),
      category: Number(row.category) || 0,
      topic: String(row.topic || ''),
      subtopic: row.subtopic ? String(row.subtopic) : '',
      fact: String(row.fact || ''),
      answer: String(row.answer || ''),
      clues: Array.isArray(row.clues) ? row.clues.map(String) : [],
      statement: row.statement ? String(row.statement) : '',
      isTrue: row.isTrue == null ? null : !!row.isTrue,
      source: String(row.source || ''),
      sourceId: String(row.sourceId || ''),
      sourceUrl: row.sourceUrl ? String(row.sourceUrl) : '',
      license: row.license ? String(row.license) : '',
      confidence: Number(row.confidence) || 0,
      priorityPt: row.priorityPt == null ? null : Number(row.priorityPt),
      ageBands: Array.isArray(row.ageBands) ? row.ageBands.map(String) : [],
      allowedFormats: Array.isArray(row.allowedFormats) ? row.allowedFormats.map(String) : [],
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      verifiedAt: row.verifiedAt || null,
      verifiedBy: row.verifiedBy ? String(row.verifiedBy) : '',
      createdAt: row.dbCreatedAt || row.createdAt || null,
    };
  }

  /**
   * Escolhe um facto verificado do repositório Supabase.
   * @param {number} categoryN
   * @param {string} ageBand
   * @param {{ topic?, subtopic?, formatId?, excludeKnowledgeIds?, minConfidence? }} opts
   */
  async function pickRecord(categoryN, ageBand, opts = {}) {
    if (!VALID_AGE_BANDS.has(ageBand)) return null;
    const c = await ensureClient();
    if (!c) return null;

    const { data, error } = await c.rpc('pick_knowledge_record', {
      p_category_n: categoryN,
      p_age_band: ageBand,
      p_topic: opts.topic || null,
      p_subtopic: opts.subtopic || null,
      p_format: opts.formatId || null,
      p_exclude_knowledge_ids: Array.isArray(opts.excludeKnowledgeIds) ? opts.excludeKnowledgeIds : [],
      p_min_confidence: opts.minConfidence ?? 0.85,
    });

    if (error) {
      console.warn('[KnowledgeRepository] pick falhou:', error.message, { categoryN, ageBand, topic: opts.topic, formatId: opts.formatId });
      return null;
    }

    if (!data) {
      console.info('[KnowledgeRepository] pick sem resultados', { categoryN, ageBand, topic: opts.topic, formatId: opts.formatId, excluded: (opts.excludeKnowledgeIds || []).length });
      return null;
    }

    const record = rowToRecord(data);
    if (!record) {
      console.warn('[KnowledgeRepository] pick devolveu JSON inválido:', data);
    }
    return record;
  }

  /**
   * Importa lote de factos (requer service role — usar em scripts/admin).
   */
  async function importBatch(items, { client } = {}) {
    const c = client || await ensureClient();
    if (!c || !Array.isArray(items) || !items.length) {
      return { ok: false, upserted: 0, skipped: 0 };
    }

    const payload = items.map((item) => ({
      knowledge_id: item.knowledgeId || item.knowledge_id,
      category_n: item.category ?? item.category_n,
      topic: item.topic,
      subtopic: item.subtopic || null,
      fact: item.fact,
      answer: item.answer,
      clues: item.clues || [],
      statement: item.statement || null,
      is_true: item.isTrue ?? item.is_true ?? null,
      source: item.source,
      source_id: item.sourceId || item.source_id,
      source_url: item.sourceUrl || item.source_url || null,
      license: item.license || null,
      confidence: item.confidence ?? 0.9,
      priority_pt: item.priorityPt ?? item.priority_pt ?? null,
      age_bands: item.ageBands || item.age_bands || ['6-9', '10-15', '15+'],
      allowed_formats: item.allowedFormats || item.allowed_formats || ['RESPOSTA_DIRETA'],
      tags: item.tags || [],
      verified_at: item.verifiedAt || item.verified_at || null,
      verified_by: item.verifiedBy || item.verified_by || null,
      metadata: item.metadata || {},
    }));

    const { data, error } = await c.rpc('import_knowledge_batch', { p_items: payload });
    if (error) {
      console.warn('[KnowledgeRepository] import falhou:', error.message);
      return { ok: false, error };
    }
    return data || { ok: false };
  }

  global.ReinoKnowledgeRepository = {
    VALID_AGE_BANDS,
    isConfigured,
    rowToRecord,
    pickRecord,
    importBatch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
