#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const data = require('./lib/offensive-words-data');

const outPath = path.join(__dirname, '..', 'public', 'question-engine', 'offensive-words-data.js');
const body = `(function (global) {
  'use strict';
  global.QuestionEngineOffensiveWordsData = Object.freeze({
    PHRASE_REPLACEMENTS: Object.freeze(${JSON.stringify(data.PHRASE_REPLACEMENTS)}),
    WORD_REPLACEMENTS: Object.freeze(${JSON.stringify(data.WORD_REPLACEMENTS)}),
  });
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(outPath, body, 'utf8');
console.log(`Gerado ${outPath}`);
