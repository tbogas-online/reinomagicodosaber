'use strict';

const { getSupabaseAdmin } = require('./rooms-store');
const { replenishBankFromKnowledge } = require('./bank-from-knowledge');

async function replenishCategory20Bank({ ageBand, limit = 50, dryRun = false } = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) {
    const err = new Error('Supabase admin não configurado.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  return replenishBankFromKnowledge(cfg.url, cfg.key, {
    categoryN: 20,
    ageBand,
    limit,
    dryRun,
  });
}

module.exports = {
  replenishCategory20Bank,
};
