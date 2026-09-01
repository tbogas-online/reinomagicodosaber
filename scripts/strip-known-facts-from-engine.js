const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'public', 'question-engine.js');
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  /** Factos/ambiguidades reportados');
const end = s.indexOf('  const CONFUSING_FACT_PREFIXES');
if (start < 0 || end < 0) throw new Error('markers not found');
const insert = [
  '  /** Factos reportados — ver question-engine/known-facts.js */',
  '  function runReportedFactRules(q, a, options, formatId) {',
  '    return KnownFacts.runReportedFactRules(q, a, options, formatId, mkIssue);',
  '  }',
  '',
].join('\n');
s = s.slice(0, start) + insert + s.slice(end);
fs.writeFileSync(p, s, 'utf8');
console.log('ok');
