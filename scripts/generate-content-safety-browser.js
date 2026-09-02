#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const data = require('./lib/content-safety-data');

const outPath = path.join(__dirname, '..', 'public', 'question-engine', 'content-safety-data.js');
const body = `(function (global) {
  'use strict';
  global.QuestionEngineContentSafetyData = Object.freeze({
    SEVERITY: Object.freeze(${JSON.stringify(data.SEVERITY)}),
    CATEGORY: Object.freeze(${JSON.stringify(data.CATEGORY)}),
    PHRASE_RULES: Object.freeze(${JSON.stringify(data.PHRASE_RULES)}),
    WORD_RULES: Object.freeze(${JSON.stringify(data.WORD_RULES)}),
    PATTERN_RULES: Object.freeze(${JSON.stringify(data.PATTERN_RULES.map((rule) => ({
      id: rule.id,
      severity: rule.severity,
      category: rule.category,
      message: rule.message,
      source: rule.re.source,
      flags: rule.re.flags,
    })) )}),
    EDUCATIONAL_CONTEXT_SOURCE: ${JSON.stringify(data.EDUCATIONAL_CONTEXT_RE.source)},
    EDUCATIONAL_CONTEXT_FLAGS: ${JSON.stringify(data.EDUCATIONAL_CONTEXT_RE.flags)},
    buildContentSafetyPromptRules: function buildContentSafetyPromptRules() {
      return ${JSON.stringify(data.buildContentSafetyPromptRules())};
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(outPath, body, 'utf8');
console.log(`Gerado ${outPath}`);
