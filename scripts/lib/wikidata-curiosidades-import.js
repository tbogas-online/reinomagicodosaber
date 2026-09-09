'use strict';

const { normalizeRecord, validateRecord, importBatch } = require('./knowledge-import-core');
const { filterNewRecords } = require('./knowledge-dedupe');
const { fetchExistingCuriosidades } = require('./curiosidades-batch-import');
const { collectWikidataRecords, listWikidataImportSources } = require('./wikidata-curiosidades');
const { buildCuriosityBankItems } = require('./curiosidade-question-from-fact');
const { importQuestionBatch } = require('../../netlify/functions/lib/bank-from-knowledge');
const { enrichRecordsWithRest } = require('./wikidata-rest');

const QUESTION_BATCH_SIZE = 40;

function questionPreview(items) {
  return items.slice(0, 6).map((row) => ({
    knowledgeId: row.knowledge_id,
    ageBand: row.age_band,
    format: row.format,
    question: row.question,
    answer: row.correct_answer,
  }));
}

async function materializeCuriosityQuestions(cfg, records) {
  const { items, skipped } = buildCuriosityBankItems(records, { source: 'wikidata-template' });
  let inserted = 0;
  let exists = 0;
  let batchSkipped = 0;
  for (let i = 0; i < items.length; i += QUESTION_BATCH_SIZE) {
    const batch = items.slice(i, i + QUESTION_BATCH_SIZE);
    const result = await importQuestionBatch(cfg.url, cfg.key, batch);
    inserted += Number(result?.inserted) || 0;
    exists += Number(result?.exists) || 0;
    batchSkipped += Number(result?.skipped) || 0;
  }
  return {
    prepared: items.length,
    skipped: skipped.length,
    inserted,
    exists,
    batchSkipped,
    preview: questionPreview(items),
  };
}

async function importWikidataCuriosidades(cfg, {
  dryRun = false,
  fetchFn,
  existingRecords,
  materializeQuestions = true,
  enrichWithRest = false,
} = {}) {
  if (!cfg?.url || !cfg?.key) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  let raw;
  try {
    raw = await collectWikidataRecords({ fetchFn });
  } catch (err) {
    const wrapped = new Error(`Wikidata indisponível: ${err.message || err}`);
    wrapped.code = 'WIKIDATA_FETCH';
    throw wrapped;
  }

  const records = raw.map((row) => normalizeRecord(row));
  const invalid = records
    .map((record) => ({ knowledgeId: record.knowledge_id, missing: validateRecord(record) }))
    .filter((row) => row.missing.length);
  if (invalid.length) {
    const err = new Error(`${invalid.length} registo(s) Wikidata inválido(s).`);
    err.code = 'INVALID_RECORD';
    err.details = invalid.slice(0, 5);
    throw err;
  }

  const existing = existingRecords !== undefined
    ? existingRecords
    : await fetchExistingCuriosidades(cfg);
  const { accepted, skipped } = filterNewRecords(records, existing);
  const plannedQuestions = buildCuriosityBankItems(accepted, { source: 'wikidata-template' });

  const summary = {
    ok: true,
    action: 'import-source',
    source: 'wikidata',
    batch: 'pt',
    labels: 'Wikidata',
    dryRun: !!dryRun,
    total: records.length,
    newCount: accepted.length,
    skipped: skipped.length,
    imported: 0,
    questionsPrepared: plannedQuestions.items.length,
    questionsSkipped: plannedQuestions.skipped.length,
    questionsInserted: 0,
    materializeQuestions: !!materializeQuestions,
    preview: accepted.slice(0, 8).map((row) => ({
      knowledgeId: row.knowledge_id,
      fact: row.fact,
      sourceId: row.source_id,
      sourceUrl: row.source_url,
    })),
    questionPreview: questionPreview(plannedQuestions.items),
    skippedPreview: skipped.slice(0, 8).map((item) => ({
      knowledgeId: item.record?.knowledge_id,
      reason: item.reason,
      of: item.of,
    })),
  };

  if (!records.length) {
    summary.message = 'Wikidata não devolveu factos utilizáveis (rótulos PT). Tenta mais tarde.';
    return summary;
  }

  if (dryRun) {
    if (materializeQuestions) {
      summary.message = `Simulação (Wikidata): ${accepted.length} facto(s) novo(s), ${skipped.length} já no repositório, ${plannedQuestions.items.length} pergunta(s) de template.`;
    } else {
      summary.message = `Simulação (Wikidata): ${accepted.length} facto(s) novo(s), ${skipped.length} já no repositório. As perguntas V/F geram-se no jogo (template/IA) ou com npm run import:wikidata.`;
    }
    return summary;
  }

  if (!accepted.length) {
    summary.message = 'Nada a importar (Wikidata) — todos os factos obtidos já estão no repositório.';
    return summary;
  }

  let toImport = accepted;
  if (enrichWithRest) {
    toImport = await enrichRecordsWithRest(accepted, { fetchFn });
    summary.restEnriched = toImport.filter((row) => row?.metadata?.restId).length;
  }

  const result = await importBatch(cfg.url, cfg.key, toImport);
  summary.imported = toImport.length;
  summary.result = result;

  if (!materializeQuestions) {
    summary.message = `Importados ${accepted.length} facto(s) Wikidata (${skipped.length} ignorado(s) por duplicado). No jogo, o template ou a IA formula a pergunta e grava no banco.`;
    return summary;
  }

  try {
    const questions = await materializeCuriosityQuestions(cfg, toImport);
    summary.questionsInserted = questions.inserted;
    summary.questionsExists = questions.exists;
    summary.questionsBankSkipped = questions.batchSkipped;
    summary.questionResult = questions;
    summary.message = `Importados ${accepted.length} facto(s) Wikidata e ${questions.inserted} pergunta(s) no banco (${skipped.length} facto(s) duplicado(s)).`;
  } catch (err) {
    summary.questionError = err.message || String(err);
    summary.message = `Importados ${accepted.length} facto(s) Wikidata, mas a materialização no banco falhou: ${summary.questionError}`;
  }
  return summary;
}

module.exports = {
  importWikidataCuriosidades,
  listWikidataImportSources,
  materializeCuriosityQuestions,
};
