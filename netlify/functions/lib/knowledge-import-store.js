'use strict';

const { getSupabaseAdmin } = require('./rooms-store');
const supa = require('../../../scripts/lib/knowledge-import-supabase');
const { listImportSources, importCuriosidadesBatches } = require('../../../scripts/lib/curiosidades-batch-import');
const { importWikidataCuriosidades, importWikidataFromOptions, listWikidataImportSources } = require('../../../scripts/lib/wikidata-curiosidades-import');
const { listCategoryTopics } = require('../../../scripts/lib/wikidata-category-topics');
const {
  listCollectors,
  parseBriefing,
  requireCollector,
} = require('../../../scripts/lib/knowledge-import-briefing');

function listAllImportSources() {
  return [...listImportSources(), ...listWikidataImportSources()];
}

function requireAdmin() {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  return cfg;
}

async function getImportDashboard() {
  const dashboard = await supa.getDashboard(requireAdmin());
  return {
    ...(dashboard && typeof dashboard === 'object' ? dashboard : {}),
    importSources: listAllImportSources(),
    importCollectors: listCollectors(),
    wikidataCategoryTopics: listCategoryTopics(),
  };
}

async function runDailyImport(_event, options = {}) {
  if (!options.dryRun) requireAdmin();
  const cfg = getSupabaseAdmin();
  if (!cfg && !options.dryRun) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!cfg) {
    const err = new Error('Supabase admin necessário para simular com fila real.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  return supa.runDailyImport(cfg, options);
}

async function resetImportOverrides() {
  return supa.resetQueuePending(requireAdmin());
}

async function syncImportQueueFromSeed() {
  return supa.syncSeedQueue(requireAdmin());
}

async function importSource(_event, { source, batch, dryRun, categoryN, words, preset, knowledgeIds, briefing } = {}) {
  const kind = String(source || 'curiosidades-batch').trim();
  requireCollector(kind);
  if (kind === 'wikidata') {
    const nested = briefing && typeof briefing === 'object' ? briefing : {};
    const parsed = parseBriefing({
      ...nested,
      source: kind,
      categoryN: nested.categoryN ?? categoryN,
      words: nested.words ?? words,
      preset: nested.preset ?? preset,
    });
    const hasDynamic = String(parsed.briefing.preset || '').trim()
      || parsed.briefing.words.length
      || parsed.briefing.categoryN;
    if (hasDynamic) {
      return importWikidataFromOptions(requireAdmin(), {
        dryRun,
        categoryN: parsed.briefing.categoryN,
        words: parsed.briefing.words,
        preset: parsed.briefing.preset,
        knowledgeIds,
        briefing: parsed.briefing,
        materializeQuestions: false,
      });
    }
    return importWikidataCuriosidades(requireAdmin(), { dryRun, materializeQuestions: false, knowledgeIds });
  }
  return importCuriosidadesBatches(requireAdmin(), { batch, dryRun });
}

module.exports = {
  getImportDashboard,
  runDailyImport,
  resetImportOverrides,
  syncImportQueueFromSeed,
  importSource,
  listAllImportSources,
};
