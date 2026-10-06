#!/usr/bin/env node
/**
 * Importar curiosidades da Wikidata (SPARQL) para o repositório e o question_bank.
 *
 *   node scripts/import-knowledge-wikidata.js --dry-run
 *   node scripts/import-knowledge-wikidata.js
 */
'use strict';

require('./load-env').loadEnvLocal();

const { importWikidataCuriosidades } = require('./lib/wikidata-curiosidades-import');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Define SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const summary = await importWikidataCuriosidades({ url, key }, {
    dryRun,
    enrichWithRest: !dryRun,
  });
  console.log(summary.message);
  console.log({
    obtained: summary.total,
    newFacts: summary.newCount,
    skippedFacts: summary.skipped,
    importedFacts: summary.imported,
    questionsPrepared: summary.questionsPrepared,
    questionsInserted: summary.questionsInserted,
  });
  if (summary.preview?.length) {
    summary.preview.forEach((row) => {
      console.log(`  ${row.knowledgeId}  ${row.fact}  ${row.sourceUrl}`);
    });
  }
  if (summary.skippedPreview?.length) {
    summary.skippedPreview.slice(0, 8).forEach((row) => {
      console.log(`  ignorado ${row.knowledgeId} (${row.reason}) — já existe ${row.of}`);
    });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
