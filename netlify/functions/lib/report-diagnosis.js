const { loadQuestionEngine, stripTags, normalizeQ } = require('../../../scripts/lib/load-question-engine');

let cachedEngine = null;

function getEngineBundle() {
  if (!cachedEngine) cachedEngine = loadQuestionEngine();
  return cachedEngine;
}

function attachEngineDiagnosis(report) {
  if (!report || String(report.issueType || '').startsWith('site_') || report.source === 'site') {
    return null;
  }
  try {
    const { QE, ReportDiagnosis } = getEngineBundle();
    if (!QE || !ReportDiagnosis?.diagnoseReport) return null;
    const diagnosis = ReportDiagnosis.diagnoseReport(report, QE, {
      stripTags,
      normalizeFn: normalizeQ,
      validateTrueFalseQuestion: () => ({ ok: true, issues: [] }),
    });
    if (diagnosis) report.engineDiagnosis = diagnosis;
    return diagnosis;
  } catch (err) {
    console.warn('[report-diagnosis] failed:', err.message || err);
    return null;
  }
}

function aggregateDiagnosisStats(reports) {
  try {
    const { ReportDiagnosis } = getEngineBundle();
    return ReportDiagnosis?.aggregateDiagnosisStats
      ? ReportDiagnosis.aggregateDiagnosisStats(reports)
      : null;
  } catch (err) {
    console.warn('[report-diagnosis] stats failed:', err.message || err);
    return null;
  }
}

module.exports = {
  attachEngineDiagnosis,
  aggregateDiagnosisStats,
};
