'use strict';

const { getSupabaseAdmin } = require('./rooms-store');
const {
  buildAdivinhaDistractors,
  hasBadAdivinhaMcOptions,
  assembleMcOptions,
} = require('../../../scripts/lib/adivinha-distractors-node');

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function parseOptions(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function supabaseRequest(path, options = {}) {
  const cfg = getSupabaseAdmin();
  if (!cfg) throw new Error('Supabase admin não configurado.');

  const response = await fetch(`${cfg.url.replace(/\/$/, '')}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Supabase HTTP ${response.status}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAdivinhaBankRows(categoryN = 20) {
  const rows = [];
  const pageSize = 200;
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      select: 'question_hash,question,correct_answer,options,format,category_n,age_band,is_reported',
      category_n: `eq.${categoryN}`,
      format: 'eq.ADIVINHA',
      order: 'id.asc',
      limit: String(pageSize),
      offset: String(offset),
    });
    const batch = await supabaseRequest(`/question_bank?${params.toString()}`);
    if (!Array.isArray(batch) || !batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function needsAdivinhaOptionsFix(row) {
  if (row.is_reported) return false;
  const options = parseOptions(row.options);
  const answer = String(row.correct_answer || '').trim();
  if (!answer || !options || options.length !== 4) return true;
  return hasBadAdivinhaMcOptions(options, answer, stripTags);
}

function buildFixedOptions(row) {
  const answer = String(row.correct_answer || '').trim();
  const distractors = buildAdivinhaDistractors(answer);
  if (!distractors) return null;
  return assembleMcOptions(answer, distractors);
}

async function regenerateAdivinhaBankOptions({ categoryN = 20, dryRun = false } = {}) {
  const rows = await fetchAdivinhaBankRows(categoryN);
  const toFix = rows.filter(needsAdivinhaOptionsFix);
  const samples = [];
  let updated = 0;
  let failed = 0;

  for (const row of toFix) {
    const options = buildFixedOptions(row);
    if (!options) {
      failed += 1;
      continue;
    }
    if (samples.length < 5) {
      samples.push({
        questionHash: row.question_hash,
        answer: row.correct_answer,
        before: parseOptions(row.options),
        after: options,
      });
    }
    if (!dryRun) {
      await supabaseRequest(
        `/question_bank?question_hash=eq.${encodeURIComponent(row.question_hash)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ options }),
        },
      );
    }
    updated += 1;
  }

  return {
    scanned: rows.length,
    invalid: toFix.length,
    updated,
    failed,
    dryRun: !!dryRun,
    samples,
  };
}

module.exports = {
  regenerateAdivinhaBankOptions,
};
