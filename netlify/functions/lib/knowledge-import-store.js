'use strict';

const { getSupabaseAdmin } = require('./rooms-store');
const supa = require('../../../scripts/lib/knowledge-import-supabase');

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
  return supa.getDashboard(requireAdmin());
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

module.exports = {
  getImportDashboard,
  runDailyImport,
  resetImportOverrides,
  syncImportQueueFromSeed,
};
