// GET /api/knowledge-import-admin — estado da fila e repositório
// POST — { action: 'run' | 'dry-run' | 'import-source' | 'sync-seed' | 'reset-overrides' | 'search' | 'disable' | 'delete' }

const { json, validateAdminAuth } = require('./lib/report-utils');
const { getImportDashboard, runDailyImport, resetImportOverrides, syncImportQueueFromSeed, importSource } = require('./lib/knowledge-import-store');
const {
  searchKnowledgeRecords,
  disableKnowledgeRecords,
  deleteKnowledgeRecords,
  auditKnowledgeDuplicates,
  applyKnowledgeDedupe,
} = require('./lib/knowledge-repository-store');
const { getSupabaseAdmin } = require('./lib/rooms-store');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
    }

    const auth = validateAdminAuth(event);
    if (!auth.ok) {
      return json(auth.status, { error: auth.error });
    }

    if (event.httpMethod === 'GET') {
      try {
        const dashboard = await getImportDashboard();
        return json(200, dashboard);
      } catch (err) {
        console.error('[knowledge-import-admin] dashboard failed:', err);
        if (err.code === 'SCHEMA_MISSING') {
          return json(503, { error: err.message });
        }
        if (err.code === 'NOT_CONFIGURED') {
          return json(503, { error: err.message });
        }
        return json(503, { error: 'Não foi possível ler a fila de importação.' });
      }
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try {
        body = event.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { error: 'Corpo JSON inválido.' });
      }

      if (body.action === 'run' || body.action === 'dry-run') {
        if (!getSupabaseAdmin() && body.action !== 'dry-run' && !body.dryRun) {
          return json(503, {
            error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
          });
        }
        try {
          const result = await runDailyImport(event, {
            force: !!body.force,
            dryRun: body.action === 'dry-run' || !!body.dryRun,
          });
          return json(200, result);
        } catch (err) {
          console.error('[knowledge-import-admin] run failed:', err);
          if (err.code === 'NOT_CONFIGURED') {
            return json(503, { error: err.message });
          }
          if (err.code === 'INVALID_RECORD') {
            return json(400, { error: err.message });
          }
          return json(500, { error: err.message || 'Falha na importação.' });
        }
      }

      if (body.action === 'import-source') {
        if (!getSupabaseAdmin()) {
          return json(503, {
            error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
          });
        }
        try {
          const result = await importSource(event, {
            source: body.source || 'curiosidades-batch',
            batch: body.batch || 'all',
            dryRun: !!body.dryRun,
            categoryN: body.categoryN,
            words: body.words,
            preset: body.preset,
            knowledgeIds: body.knowledgeIds,
            records: body.records,
            excludeKnowledgeIds: body.excludeKnowledgeIds,
            briefing: body.briefing,
          });
          return json(200, result);
        } catch (err) {
          console.error('[knowledge-import-admin] import-source failed:', err);
          if (err.code === 'NOT_CONFIGURED') return json(503, { error: err.message });
          if (err.code === 'WIKIDATA_FETCH') return json(503, { error: err.message });
          if (err.code === 'INVALID_BATCH' || err.code === 'INVALID_SOURCE' || err.code === 'INVALID_RECORD'
            || err.code === 'INVALID_WORDS' || err.code === 'INVALID_CATEGORY' || err.code === 'INVALID_SELECTION'
            || err.code === 'COLLECTOR_UNAVAILABLE' || err.code === 'INVALID_BRIEFING') {
            return json(400, { error: err.message, details: err.details || null });
          }
          return json(500, { error: err.message || 'Falha na importação da fonte.' });
        }
      }

      if (body.action === 'reset-overrides') {
        try {
          const dashboard = await resetImportOverrides();
          return json(200, dashboard);
        } catch (err) {
          console.error('[knowledge-import-admin] reset failed:', err);
          return json(500, { error: err.message || 'Falha ao repor fila.' });
        }
      }

      if (body.action === 'sync-seed') {
        try {
          const dashboard = await syncImportQueueFromSeed();
          return json(200, dashboard);
        } catch (err) {
          console.error('[knowledge-import-admin] sync failed:', err);
          if (err.code === 'SCHEMA_MISSING') return json(503, { error: err.message });
          if (err.code === 'SEED_MISSING') return json(400, { error: err.message });
          return json(500, { error: err.message || 'Falha ao sincronizar fila.' });
        }
      }

      if (body.action === 'search') {
        if (!getSupabaseAdmin()) {
          return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
        }
        try {
          const result = await searchKnowledgeRecords({
            query: body.query,
            knowledgeId: body.knowledgeId,
            categoryN: body.categoryN,
            topic: body.topic,
            source: body.source,
            activeFilter: body.activeFilter || 'all',
            createdFrom: body.createdFrom,
            createdTo: body.createdTo,
            limit: body.limit,
            offset: body.offset,
          });
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[knowledge-import-admin] search failed:', err);
          return json(503, { error: 'Não foi possível pesquisar o repositório.' });
        }
      }

      if (body.action === 'dedupe-audit') {
        if (!getSupabaseAdmin()) {
          return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
        }
        try {
          const result = await auditKnowledgeDuplicates({
            categoryN: body.categoryN,
            adivinhas: !!body.adivinhas,
            curiosidades: body.curiosidades !== false,
          });
          return json(200, result);
        } catch (err) {
          console.error('[knowledge-import-admin] dedupe-audit failed:', err);
          return json(503, { error: err.message || 'Não foi possível auditar duplicados.' });
        }
      }

      if (body.action === 'dedupe-apply') {
        if (!getSupabaseAdmin()) {
          return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
        }
        try {
          const result = await applyKnowledgeDedupe({
            categoryN: body.categoryN,
            adivinhas: !!body.adivinhas,
            curiosidades: body.curiosidades !== false,
          });
          return json(200, result);
        } catch (err) {
          console.error('[knowledge-import-admin] dedupe-apply failed:', err);
          return json(503, { error: err.message || 'Não foi possível desactivar duplicados.' });
        }
      }

      if (body.action === 'disable') {
        if (!getSupabaseAdmin()) {
          return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
        }
        const knowledgeIds = Array.isArray(body.knowledgeIds) ? body.knowledgeIds : [];
        if (!knowledgeIds.length) {
          return json(400, { error: 'Indica pelo menos um knowledge_id.' });
        }
        try {
          const result = await disableKnowledgeRecords(knowledgeIds, { reason: body.reason });
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[knowledge-import-admin] disable failed:', err);
          const msg = String(err?.message || '');
          if (msg.includes('disable_knowledge_record') || msg.includes('PGRST202')) {
            return json(503, { error: 'Função disable_knowledge_record em falta — executa supabase/knowledge-repository.sql no Supabase.' });
          }
          return json(503, { error: 'Não foi possível desactivar registo(s).' });
        }
      }

      if (body.action === 'delete') {
        if (!getSupabaseAdmin()) {
          return json(503, { error: 'Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).' });
        }
        const knowledgeIds = Array.isArray(body.knowledgeIds) ? body.knowledgeIds : [];
        if (!knowledgeIds.length) {
          return json(400, { error: 'Indica pelo menos um knowledge_id.' });
        }
        try {
          const result = await deleteKnowledgeRecords(knowledgeIds);
          return json(200, { ok: true, ...result });
        } catch (err) {
          console.error('[knowledge-import-admin] delete failed:', err);
          const msg = String(err?.message || '');
          if (msg.includes('delete_knowledge_records') || msg.includes('PGRST202')) {
            return json(503, { error: 'Função delete_knowledge_records em falta — executa supabase/knowledge-delete-records.sql no Supabase.' });
          }
          return json(503, { error: 'Não foi possível apagar facto(s).' });
        }
      }

      return json(400, { error: 'Acção desconhecida. Usa action: "run", "dry-run", "import-source", "sync-seed", "reset-overrides", "search", "disable", "delete", "dedupe-audit" ou "dedupe-apply".' });
    }

    return json(405, { error: 'Método não permitido.' });
  } catch (err) {
    console.error('[knowledge-import-admin] unhandled:', err);
    return json(500, { error: 'Erro interno na importação do repositório.' });
  }
};
