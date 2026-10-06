'use strict';

const { normalizeRecord, validateRecord, importBatch } = require('./knowledge-import-core');
const { filterNewRecords } = require('./knowledge-dedupe');
const { fetchExistingCuriosidades, fetchExistingKnowledge } = require('./curiosidades-batch-import');
const { collectWikidataRecords, listWikidataImportSources } = require('./wikidata-curiosidades');
const { collectGeografiaRecords } = require('./wikidata-geografia');
const {
  collectKeywordRecords,
  sanitizeWords,
  applyKnowledgeIdFilter,
  coerceImportRecords,
  buildImportCandidates,
  normalizeKnowledgeIds,
} = require('./wikidata-keyword-search');
const { applyBriefingToRecords, MAX_LIMIT } = require('./knowledge-import-briefing');
const { filterRejectedRecords } = require('./knowledge-import-rejections');
const { loadImportRejections, rememberImportRejections } = require('./knowledge-import-rejection-store');
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

async function persistWikidataRecords(cfg, raw, {
  dryRun = false,
  fetchFn,
  existingRecords,
  materializeQuestions = true,
  enrichWithRest = false,
  labels = 'Wikidata',
  collectorId = 'wikidata',
  knowledgeIds,
  excludeKnowledgeIds,
  rejectedRecords,
  briefing = null,
} = {}) {
  const stamped = applyBriefingToRecords(raw, briefing);
  const records = stamped.map((row) => normalizeRecord(row));
  const invalid = records
    .map((record) => ({ knowledgeId: record.knowledge_id, missing: validateRecord(record) }))
    .filter((row) => row.missing.length);
  if (invalid.length) {
    const err = new Error(`${invalid.length} registo(s) ${labels} inválido(s).`);
    err.code = 'INVALID_RECORD';
    err.details = invalid.slice(0, 5);
    throw err;
  }

  const categoryN = records[0]?.category_n || 20;
  const existing = existingRecords !== undefined
    ? existingRecords
    : (categoryN === 20
      ? await fetchExistingCuriosidades(cfg)
      : await fetchExistingKnowledge(cfg, { categoryN }));
  const filtered = filterNewRecords(records, existing);
  let accepted = filtered.accepted;
  const skipped = filtered.skipped;
  const storedRejections = await loadImportRejections(cfg);
  const learned = filterRejectedRecords(accepted, storedRejections);
  accepted = learned.kept;
  const learnedSkipped = learned.rejected.length;
  const candidates = buildImportCandidates(accepted, skipped, briefing?.limit, excludeKnowledgeIds);
  const selectedIds = Array.isArray(knowledgeIds) ? normalizeKnowledgeIds(knowledgeIds) : null;
  const toRemember = Array.isArray(rejectedRecords) ? rejectedRecords : [];
  let remembered = 0;
  if (!dryRun && toRemember.length) {
    const saved = await rememberImportRejections(cfg, toRemember);
    remembered = Number(saved?.remembered) || 0;
  }

  if (!dryRun && selectedIds) {
    if (!selectedIds.length) {
      const err = new Error('Selecciona pelo menos um facto da lista para importar.');
      err.code = 'INVALID_SELECTION';
      throw err;
    }
    const picked = applyKnowledgeIdFilter(accepted, selectedIds);
    accepted = picked.records;
  }

  const curiosityRecords = accepted.filter((row) => Number(row.category_n) === 20);
  const plannedQuestions = buildCuriosityBankItems(curiosityRecords, { source: 'wikidata-template' });
  const rejectedByUser = Math.max(remembered, toRemember.length);

  const summary = {
    ok: true,
    action: 'import-source',
    source: collectorId,
    batch: 'pt',
    labels,
    dryRun: !!dryRun,
    total: records.length,
    newCount: filtered.accepted.length,
    skipped: skipped.length,
    learnedSkipped,
    remembered,
    rejected: rejectedByUser,
    imported: 0,
    questionsPrepared: plannedQuestions.items.length,
    questionsSkipped: plannedQuestions.skipped.length,
    questionsInserted: 0,
    materializeQuestions: !!materializeQuestions,
    candidates,
    preview: candidates.filter((row) => row.status === 'new'),
    questionPreview: questionPreview(plannedQuestions.items),
    skippedPreview: skipped.slice(0, 10).map((item) => ({
      knowledgeId: item.record?.knowledge_id,
      reason: item.reason,
      of: item.of,
    })),
    briefing: briefing || null,
  };

  if (!records.length) {
    summary.message = `${labels} não devolveu factos desta categoria. Tenta outras palavras ou outra categoria.`;
    return summary;
  }

  if (dryRun) {
    const selectable = candidates.filter((row) => row.selectable).length;
    if (!selectable && (skipped.length || learnedSkipped)) {
      const parts = [];
      if (skipped.length) parts.push(`${skipped.length} já no repositório`);
      if (learnedSkipped) parts.push(`${learnedSkipped} já rejeitado(s)`);
      summary.message = `Nenhum facto novo para validar — ${parts.join(', ')} (ocultos).`;
    } else {
      const hidden = skipped.length ? ` ${skipped.length} já no repositório (ocultos).` : '';
      const learnedNote = learnedSkipped ? ` ${learnedSkipped} já rejeitado(s) (ocultos).` : '';
      const skippedSeen = (normalizeKnowledgeIds(excludeKnowledgeIds).length || learnedSkipped)
        ? ' Simular outra vez mostra os seguintes, não os mesmos.'
        : '';
      summary.message = `Lista ${labels} (até ${briefing?.limit || 10}): ${selectable} novo(s) para validar.${hidden}${learnedNote}${skippedSeen} Aceita ou rejeita e confirma: a lista limpa e só entram os aceites.`;
    }
    return summary;
  }

  if (!accepted.length) {
    summary.message = selectedIds
      ? 'Nenhum dos factos seleccionados pode ser importado (já existem ou a pesquisa mudou).'
      : `Nada a importar (${labels}) — todos os factos obtidos já estão no repositório.`;
    return summary;
  }

  let toImport = accepted;
  if (enrichWithRest) {
    toImport = await enrichRecordsWithRest(accepted, { fetchFn });
    summary.restEnriched = toImport.filter((row) => row?.metadata?.restId).length;
  }

  const result = await importBatch(cfg.url, cfg.key, toImport);
  summary.result = result;
  summary.imported = Number(result?.upserted) || 0;
  summary.rpcSkipped = Number(result?.skipped) || 0;

  if (!summary.imported) {
    summary.message = summary.rpcSkipped
      ? `Nenhum facto novo gravado (${summary.rpcSkipped} ignorado(s) — já existe um facto ${labels} com o mesmo identificador).`
      : 'Nenhum facto foi gravado no repositório.';
    return summary;
  }

  if (!materializeQuestions || !curiosityRecords.length) {
    const skippedNote = skipped.length ? `, ${skipped.length} duplicado(s)` : '';
    const rpcNote = summary.rpcSkipped ? `, ${summary.rpcSkipped} já existia(m)` : '';
    summary.message = `Importados ${summary.imported} facto(s) ${labels}${skippedNote}${rpcNote}${rejectedByUser ? `, ${rejectedByUser} rejeitado(s)` : ''}. No jogo, o template ou a IA formula a pergunta e grava no banco.`;
    return summary;
  }

  try {
    const questions = await materializeCuriosityQuestions(cfg, curiosityRecords);
    summary.questionsInserted = questions.inserted;
    summary.questionsExists = questions.exists;
    summary.questionsBankSkipped = questions.batchSkipped;
    summary.questionResult = questions;
    summary.message = `Importados ${summary.imported} facto(s) ${labels} e ${questions.inserted} pergunta(s) no banco (${skipped.length} duplicado(s)${rejectedByUser ? `, ${rejectedByUser} rejeitado(s)` : ''}).`;
  } catch (err) {
    summary.questionError = err.message || String(err);
    summary.message = `Importados ${summary.imported} facto(s) ${labels}, mas a materialização no banco falhou: ${summary.questionError}`;
  }
  return summary;
}

function wikidataUnavailableError(err) {
  const msg = String(err?.message || err || '');
  if (err?.name === 'AbortError' || /aborted|abortado/i.test(msg)) {
    const wrapped = new Error('Wikidata demorou demasiado. Tenta simular outra vez daqui a um momento.');
    wrapped.code = 'WIKIDATA_FETCH';
    return wrapped;
  }
  const wrapped = new Error(`Wikidata indisponível: ${msg}`);
  wrapped.code = 'WIKIDATA_FETCH';
  return wrapped;
}

async function importWikidataCuriosidades(cfg, {
  dryRun = false,
  fetchFn,
  existingRecords,
  materializeQuestions = true,
  enrichWithRest = false,
  knowledgeIds,
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
    throw wikidataUnavailableError(err);
  }

  return persistWikidataRecords(cfg, raw, {
    dryRun,
    fetchFn,
    existingRecords,
    materializeQuestions,
    enrichWithRest,
    labels: 'Wikidata UNESCO PT',
    knowledgeIds,
  });
}

function labelsForWikidataPreset(presetId, categoryN, words) {
  if (presetId === 'countryCapitals') return 'Wikidata — capitais';
  if (presetId === 'ichPt') return 'Wikidata — património imaterial PT';
  if (presetId === 'unescoPt') return 'Wikidata — UNESCO PT';
  if (presetId === 'unesco') return 'Wikidata — UNESCO e imaterial PT';
  const n = Number(categoryN) || 20;
  const list = Array.isArray(words) ? words.filter(Boolean) : [];
  return list.length ? `Wikidata — cat. ${n} (${list.join(', ')})` : `Wikidata — cat. ${n}`;
}

async function importWikidataFromOptions(cfg, {
  dryRun = false,
  fetchFn,
  categoryN,
  words,
  preset,
  knowledgeIds,
  records,
  excludeKnowledgeIds,
  rejectedRecords,
  briefing = null,
  materializeQuestions = false,
  enrichWithRest = false,
} = {}) {
  if (!cfg?.url || !cfg?.key) {
    const err = new Error('Supabase admin não configurado (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const presetId = String(preset || '').trim();
  const cleanWords = sanitizeWords(words);
  const labels = labelsForWikidataPreset(presetId, categoryN, cleanWords);
  const fromPreview = applyKnowledgeIdFilter(
    coerceImportRecords(Array.isArray(records) ? records : []),
    knowledgeIds,
  ).records;
  let raw;

  try {
    if (!dryRun && fromPreview.length) {
      raw = fromPreview;
    } else if (presetId === 'countryCapitals') {
      raw = await collectGeografiaRecords({ fetchFn });
    } else if (presetId === 'unescoPt' || presetId === 'ichPt') {
      raw = await collectWikidataRecords({ fetchFn, queryIds: [presetId] });
    } else if (presetId === 'unesco') {
      raw = await collectWikidataRecords({ fetchFn });
    } else {
      const n = Number(categoryN) || 20;
      raw = await collectKeywordRecords({
        categoryN: n,
        words: cleanWords,
        fetchFn,
        limit: MAX_LIMIT,
      });
    }
  } catch (err) {
    if (err.code === 'INVALID_WORDS' || err.code === 'INVALID_CATEGORY') throw err;
    throw wikidataUnavailableError(err);
  }

  return persistWikidataRecords(cfg, raw, {
    dryRun,
    fetchFn,
    materializeQuestions,
    enrichWithRest,
    labels,
    knowledgeIds,
    excludeKnowledgeIds,
    rejectedRecords,
    briefing,
  });
}

module.exports = {
  importWikidataCuriosidades,
  importWikidataFromOptions,
  persistWikidataRecords,
  listWikidataImportSources,
  materializeCuriosityQuestions,
};
