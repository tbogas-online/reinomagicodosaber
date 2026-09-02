/**
 * Overrides manuais de regras de validação (admin → motor).
 */
(function (global) {
  'use strict';

  let overrides = [];

  function normalizeOverride(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const issueCode = String(raw.issueCode || raw.issue_code || '').trim();
    if (!issueCode) return null;
    return {
      id: raw.id || null,
      issueCode,
      message: String(raw.message || '').trim(),
      ageBandKey: String(raw.ageBandKey || raw.age_band_key || '').trim(),
      formatId: String(raw.formatId || raw.format_id || '').trim(),
      note: String(raw.note || '').trim(),
    };
  }

  function setOverrides(list) {
    overrides = (Array.isArray(list) ? list : [])
      .map(normalizeOverride)
      .filter(Boolean);
  }

  function matchesOverride(issue, ctx) {
    const code = String(issue?.code || '').trim();
    const message = String(issue?.message || '').trim();
    const ageBandKey = String(ctx?.ageBandKey || '').trim();
    const formatId = String(ctx?.formatId || '').trim();

    for (const ov of overrides) {
      if (ov.issueCode !== code) continue;
      if (ov.message && ov.message !== message) continue;
      if (ov.ageBandKey && ov.ageBandKey !== ageBandKey) continue;
      if (ov.formatId && ov.formatId !== formatId) continue;
      return true;
    }
    return false;
  }

  function filterIssueDetails(issueDetails, ctx) {
    if (!overrides.length || !Array.isArray(issueDetails) || !issueDetails.length) {
      return issueDetails || [];
    }
    return issueDetails.filter((issue) => !matchesOverride(issue, ctx));
  }

  global.QuestionEngineIssueOverrides = Object.freeze({
    setOverrides,
    getOverrides: () => overrides.slice(),
    matchesOverride,
    filterIssueDetails,
  });
})(typeof window !== 'undefined' ? window : globalThis);
