const REVIEWABLE_TELEMETRY_OUTCOMES = new Set(['rejected', 'parse_error', 'api_error']);
const REVIEWABLE_TELEMETRY_OUTCOME_FILTER = 'in.(rejected,parse_error,api_error)';

function stripTags(str) {
  return String(str || '').replace(/<[^>]*>/g, '').trim();
}

function hashQuestionKey(text) {
  const s = String(text || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function telemetryContentHash(question, answer) {
  const q = stripTags(question);
  const a = stripTags(answer);
  if (!q || !a) return '';
  return hashQuestionKey(`${q}|${a}`);
}

function isReviewableTelemetryOutcome(outcome) {
  return REVIEWABLE_TELEMETRY_OUTCOMES.has(String(outcome || ''));
}

function isTelemetryRowOpenBase(row) {
  if (!row) return false;
  if (row.dismissed_at || row.bank_validated_at || row.dismissedAt || row.bankValidatedAt) return false;
  const outcome = String(row.outcome || 'rejected');
  return isReviewableTelemetryOutcome(outcome);
}

function isTelemetryOpenForReview(row, pendingReviewHashes = null) {
  if (!isTelemetryRowOpenBase(row)) return false;
  const hash = row.questionHash
    || row.question_hash
    || telemetryContentHash(row.question_text || row.questionSnapshot?.q, row.answer_text || row.questionSnapshot?.a);
  if (hash && pendingReviewHashes?.has(hash)) return false;
  return true;
}

module.exports = {
  REVIEWABLE_TELEMETRY_OUTCOMES,
  REVIEWABLE_TELEMETRY_OUTCOME_FILTER,
  telemetryContentHash,
  isReviewableTelemetryOutcome,
  isTelemetryRowOpenBase,
  isTelemetryOpenForReview,
};
