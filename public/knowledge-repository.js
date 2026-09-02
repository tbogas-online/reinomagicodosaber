/**
 * Knowledge Repository — factos verificados no Supabase (KR-0).
 * A IA formula perguntas a partir destes registos; não inventa o facto.
 */
(function (global) {
  'use strict';

  const VALID_AGE_BANDS = new Set(['6-9', '10-15', '15+']);

  const HIGH_CONFIDENCE_TRUST = 0.92;

  const MIN_CONFIDENCE_BY_CATEGORY = {
    20: {
      default: 0.85,
      ADIVINHA: 0.9,
      CURIOSIDADE: 0.85,
      VERDADEIRO_FALSO: 0.85,
    },
  };

  const DEFAULT_MIN_CONFIDENCE = 0.85;

  const SOURCE_ALLOWLIST_BY_CATEGORY = {
    20: [
      'memoriamedia',
      'memoria media',
      'giacometti',
      'ditos',
      'manual',
      'sample',
      'rtp',
      'ciencia viva',
      'museu',
      'unesco',
      'wikidata',
      'academia',
      'bnp',
      'folclore',
      'pumpkin',
      'santander',
      'brinca',
      'quero bolsa',
      'curadoria',
      'repositorio',
    ],
  };

  function stripDiacritics(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeSourceKey(source) {
    return stripDiacritics(String(source || '').toLowerCase())
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getMinConfidence(categoryN, formatId) {
    const cat = MIN_CONFIDENCE_BY_CATEGORY[Number(categoryN)];
    if (!cat) return DEFAULT_MIN_CONFIDENCE;
    const fmt = String(formatId || '').trim().toUpperCase();
    if (fmt && cat[fmt] != null) return cat[fmt];
    return cat.default ?? DEFAULT_MIN_CONFIDENCE;
  }

  function getSourceAllowlist(categoryN) {
    return SOURCE_ALLOWLIST_BY_CATEGORY[Number(categoryN)] || [];
  }

  function isSourceAllowed(record, opts = {}) {
    const category = Number(opts.categoryN ?? record?.category ?? 0);
    const src = normalizeSourceKey(record?.source);
    if (!src) return false;

    const allowlist = getSourceAllowlist(category);
    if (allowlist.some((pattern) => src.includes(normalizeSourceKey(pattern)))) {
      return true;
    }

    return (Number(record?.confidence) || 0) >= HIGH_CONFIDENCE_TRUST;
  }

  function isRecordBlocked(record) {
    if (!record) return true;
    if (record.blocked === true) return true;
    if (record.isActive === false) return true;
    const superseded = record.supersededBy;
    return !!(superseded && String(superseded).trim());
  }

  function isRecordHighTrust(record) {
    const src = normalizeSourceKey(record?.source);
    if (
      src.includes('memoriamedia')
      || src.includes('memoria media')
      || src === 'manual'
      || /pumpkin|santander|brinca|ditos\.pt|ditos|quero bolsa/.test(src)
    ) {
      return true;
    }
    return (Number(record?.confidence) || 0) >= HIGH_CONFIDENCE_TRUST;
  }

  function evaluateRecordPolicy(record, opts = {}) {
    if (!record) return { ok: false, reason: 'missing_record' };
    if (isRecordBlocked(record)) return { ok: false, reason: 'blocked_or_superseded' };

    const category = Number(opts.categoryN ?? record.category ?? 0);
    const minConf = getMinConfidence(category, opts.formatId);
    const confidence = Number(record.confidence) || 0;
    if (confidence < minConf) {
      return { ok: false, reason: 'confidence_below_minimum', minConfidence: minConf, confidence };
    }

    if (!isSourceAllowed(record, { categoryN: category, formatId: opts.formatId })) {
      return { ok: false, reason: 'source_not_allowed' };
    }

    return { ok: true };
  }

  function isConfigured() {
    return !!global.ReinoSupabase?.isConfigured?.();
  }

  async function ensureClient() {
    return global.ReinoSupabase?.ensureClient?.() ?? null;
  }

  function normalizePickContext(arg1, arg2, arg3) {
    if (arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
      const ctx = arg1;
      const extra = arg2 && typeof arg2 === 'object' ? arg2 : {};
      return {
        categoryN: Number(ctx.category ?? ctx.categoryN),
        ageBandKey: ctx.ageBandKey ?? ctx.ageBand,
        opts: {
          topic: ctx.topic,
          subtopic: ctx.subtopic,
          formatId: ctx.formatId ?? ctx.format,
          excludeKnowledgeIds: ctx.excludeKnowledgeIds,
          minConfidence: ctx.minConfidence,
          sessionId: ctx.sessionId,
          maxPolicyRetries: ctx.maxPolicyRetries,
          ...extra,
        },
      };
    }
    return {
      categoryN: Number(arg1),
      ageBandKey: arg2,
      opts: arg3 || {},
    };
  }

  /**
   * Normaliza resposta RPC → objeto estável no cliente.
   */
  function rowToRecord(row) {
    if (!row || typeof row !== 'object') return null;
    const knowledgeId = row.knowledgeId || row.knowledge_id;
    if (!knowledgeId) return null;

    const isActive = row.isActive !== false && row.is_active !== false;
    const supersededBy = row.supersededBy || row.superseded_by || null;

    return {
      knowledgeId: String(knowledgeId),
      category: Number(row.category ?? row.category_n) || 0,
      topic: String(row.topic || ''),
      subtopic: row.subtopic ? String(row.subtopic) : '',
      fact: String(row.fact || ''),
      answer: String(row.answer || ''),
      clues: Array.isArray(row.clues) ? row.clues.map(String) : [],
      statement: row.statement ? String(row.statement) : '',
      isTrue: row.isTrue == null ? (row.is_true == null ? null : !!row.is_true) : !!row.isTrue,
      source: String(row.source || ''),
      sourceId: String(row.sourceId || row.source_id || ''),
      sourceUrl: row.sourceUrl || row.source_url ? String(row.sourceUrl || row.source_url) : '',
      license: row.license ? String(row.license) : '',
      confidence: Number(row.confidence) || 0,
      priorityPt: row.priorityPt == null ? (row.priority_pt == null ? null : Number(row.priority_pt)) : Number(row.priorityPt),
      ageBands: Array.isArray(row.ageBands)
        ? row.ageBands.map(String)
        : (Array.isArray(row.age_bands) ? row.age_bands.map(String) : []),
      allowedFormats: Array.isArray(row.allowedFormats)
        ? row.allowedFormats.map(String)
        : (Array.isArray(row.allowed_formats) ? row.allowed_formats.map(String) : []),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      verifiedAt: row.verifiedAt || row.verified_at || null,
      verifiedBy: row.verifiedBy || row.verified_by ? String(row.verifiedBy || row.verified_by) : '',
      isActive,
      blocked: row.blocked === true || !isActive || !!(supersededBy && String(supersededBy).trim()),
      supersededBy: supersededBy ? String(supersededBy) : null,
      usageCount: row.usageCount == null ? (row.usage_count == null ? null : Number(row.usage_count)) : Number(row.usageCount),
      createdAt: row.dbCreatedAt || row.createdAt || row.created_at || null,
    };
  }

  /**
   * Lista registos do repositório (paginado).
   * @param {number} categoryN
   * @param {{ topic?, subtopic?, formatId?, ageBand?, minConfidence?, limit?, offset? }} filters
   */
  async function loadRecords(categoryN, filters = {}) {
    const c = await ensureClient();
    if (!c || !categoryN) return [];

    const minConfidence = filters.minConfidence ?? getMinConfidence(categoryN, filters.formatId);

    const { data, error } = await c.rpc('list_knowledge_records', {
      p_category_n: categoryN,
      p_topic: filters.topic || null,
      p_subtopic: filters.subtopic || null,
      p_format: filters.formatId || filters.format || null,
      p_age_band: filters.ageBand || filters.ageBandKey || null,
      p_min_confidence: minConfidence,
      p_limit: filters.limit ?? 50,
      p_offset: filters.offset ?? 0,
    });

    if (error) {
      console.warn('[KnowledgeRepository] loadRecords falhou:', error.message, { categoryN });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    return rows.map(rowToRecord).filter(Boolean);
  }

  /**
   * Escolhe um facto verificado do repositório.
   * Aceita `pickRecord(ctx)` ou `pickRecord(categoryN, ageBand, opts)`.
   */
  async function pickRecord(arg1, arg2, arg3) {
    const { categoryN, ageBandKey, opts } = normalizePickContext(arg1, arg2, arg3);
    if (!VALID_AGE_BANDS.has(ageBandKey)) return null;

    const c = await ensureClient();
    if (!c) return null;

    const formatId = opts.formatId ?? opts.format ?? null;
    const minConfidence = opts.minConfidence ?? getMinConfidence(categoryN, formatId);
    const exclude = new Set(
      Array.isArray(opts.excludeKnowledgeIds) ? opts.excludeKnowledgeIds.map(String) : [],
    );
    const maxPolicyRetries = Math.min(Math.max(Number(opts.maxPolicyRetries) || 5, 1), 12);

    for (let attempt = 0; attempt < maxPolicyRetries; attempt += 1) {
      const { data, error } = await c.rpc('pick_knowledge_record', {
        p_category_n: categoryN,
        p_age_band: ageBandKey,
        p_topic: opts.topic || null,
        p_subtopic: opts.subtopic || null,
        p_format: formatId,
        p_exclude_knowledge_ids: [...exclude],
        p_min_confidence: minConfidence,
      });

      if (error) {
        console.warn('[KnowledgeRepository] pick falhou:', error.message, {
          categoryN,
          ageBand: ageBandKey,
          topic: opts.topic,
          formatId,
        });
        return null;
      }

      if (!data) {
        if (attempt === 0) {
          console.info('[KnowledgeRepository] pick sem resultados', {
            categoryN,
            ageBand: ageBandKey,
            topic: opts.topic,
            formatId,
            excluded: exclude.size,
          });
        }
        return null;
      }

      const record = rowToRecord(data);
      if (!record) {
        console.warn('[KnowledgeRepository] pick devolveu JSON inválido:', data);
        exclude.add(data.knowledgeId || data.knowledge_id || `invalid-${attempt}`);
        continue;
      }

      const policy = evaluateRecordPolicy(record, { categoryN, formatId });
      if (!policy.ok) {
        exclude.add(record.knowledgeId);
        continue;
      }

      return record;
    }

    return null;
  }

  /**
   * Obtém um registo por knowledgeId.
   */
  async function getRecordById(knowledgeId) {
    const kid = String(knowledgeId || '').trim();
    if (!kid) return null;

    const c = await ensureClient();
    if (!c) return null;

    const { data, error } = await c.rpc('get_knowledge_record', {
      p_knowledge_id: kid,
    });

    if (error) {
      console.warn('[KnowledgeRepository] getRecordById falhou:', error.message, { knowledgeId: kid });
      return null;
    }

    return rowToRecord(data);
  }

  /**
   * Marca facto como usado (anti-reuso global + sessão).
   */
  async function markUsed(knowledgeId, ageBandKey, sessionId, extra = {}) {
    const kid = String(knowledgeId || '').trim();
    if (!kid) return { ok: false };

    const c = await ensureClient();
    if (!c) return { ok: false };

    const { data, error } = await c.rpc('mark_knowledge_used', {
      p_knowledge_id: kid,
      p_age_band: ageBandKey || null,
      p_category_n: extra.categoryN ?? extra.category ?? null,
      p_session_id: sessionId || null,
    });

    if (error) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[KnowledgeRepository] markUsed:', error.message);
      }
      return { ok: false, error };
    }

    return data || { ok: true };
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
    HIGH_CONFIDENCE_TRUST,
    MIN_CONFIDENCE_BY_CATEGORY,
    DEFAULT_MIN_CONFIDENCE,
    SOURCE_ALLOWLIST_BY_CATEGORY,
    normalizeSourceKey,
    getMinConfidence,
    getSourceAllowlist,
    isSourceAllowed,
    isRecordBlocked,
    isRecordHighTrust,
    evaluateRecordPolicy,
    isConfigured,
    rowToRecord,
    loadRecords,
    pickRecord,
    getRecordById,
    markUsed,
    importBatch,
  };
})(typeof window !== 'undefined' ? window : globalThis);
