/**
 * Extrai REPORTED_FACT_RULES de question-engine.js → public/question-engine/known-facts.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const enginePath = path.join(__dirname, '..', 'public', 'question-engine.js');
const src = fs.readFileSync(enginePath, 'utf8');
const marker = 'const REPORTED_FACT_RULES = ';
const start = src.indexOf(marker);
if (start < 0) throw new Error('REPORTED_FACT_RULES not found');
let i = start + marker.length;
if (src[i] !== '[') throw new Error('expected array');
let depth = 0;
let inStr = false;
let strCh = '';
let inTpl = false;
let rules;
for (; i < src.length; i++) {
  const ch = src[i];
  const prev = src[i - 1];
  if (inTpl) {
    if (ch === '`' && prev !== '\\') inTpl = false;
    continue;
  }
  if (inStr) {
    if (ch === strCh && prev !== '\\') inStr = false;
    continue;
  }
  if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
  if (ch === '`') { inTpl = true; continue; }
  if (ch === '[') depth++;
  if (ch === ']') {
    depth--;
    if (depth === 0) {
      const block = src.slice(start + marker.length, i + 1);
      rules = vm.runInNewContext(`(${block})`);
      break;
    }
  }
}
if (!rules) throw new Error('unterminated REPORTED_FACT_RULES');

const lines = [
  '/** Regras de factos/ambiguidades reportados — dados + runner (Fase 1 modularização). */',
  '(function (global) {',
  "  'use strict';",
  '',
  '  const LAYER = Object.freeze({ semantic: \'semantic\', factual: \'factual\', language: \'language\' });',
  '',
  '  const REPORTED_FACT_RULES = [',
];

rules.forEach((r, i) => {
  const slug = r.issue.slice(0, 36).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28);
  const code = `FACT_${String(i + 1).padStart(2, '0')}_${slug.toUpperCase()}`;
  const layer = /facto|factual|incorret|errad|disputad|dubioso|brasileir/i.test(r.issue) ? 'factual' : 'semantic';
  lines.push('    {');
  lines.push(`      code: ${JSON.stringify(code)},`);
  lines.push(`      layer: LAYER.${layer},`);
  lines.push(`      message: ${JSON.stringify(r.issue)},`);
  lines.push(`      when: ${r.when.toString().replace(/FORMAT_IDS\.O_QUE_E/g, "'O_QUE_E'")},`);
  lines.push('    },');
});

lines.push('  ];');
lines.push('');
lines.push('  const CONFUSING_FACT_CODES = new Set(');
lines.push('    REPORTED_FACT_RULES');
lines.push('      .filter((r) => /pergunta confusa|formulação|resposta ambígua — asfalto|pergunta circular/i.test(r.message))');
lines.push('      .map((r) => r.code),');
lines.push('  );');
lines.push('');
lines.push('  function runReportedFactRules(q, a, options, formatId, mkIssue) {');
lines.push('    const opts = (options || []).map((o) => String(o).toLowerCase());');
lines.push('    const issues = [];');
lines.push('    for (const rule of REPORTED_FACT_RULES) {');
lines.push('      if (rule.when(q, a, opts, q.toLowerCase(), a.toLowerCase(), formatId)) {');
lines.push('        issues.push(mkIssue(rule.code, rule.layer, rule.message));');
lines.push('      }');
lines.push('    }');
lines.push('    return issues;');
lines.push('  }');
lines.push('');
lines.push('  global.QuestionEngineKnownFacts = Object.freeze({');
lines.push('    LAYER,');
lines.push('    REPORTED_FACT_RULES,');
lines.push('    CONFUSING_FACT_CODES,');
lines.push('    runReportedFactRules,');
lines.push('  });');
lines.push("})(typeof window !== 'undefined' ? window : globalThis);");
lines.push('');

const outPath = path.join(__dirname, '..', 'public', 'question-engine', 'known-facts.js');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('Wrote', outPath, '—', rules.length, 'rules');
