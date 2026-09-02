'use strict';

const { PHRASE_REPLACEMENTS, WORD_REPLACEMENTS } = require('./offensive-words-data');

const SEVERITY = Object.freeze({
  BLOCK: 'BLOCK',
  REWRITE: 'REWRITE',
  ALLOW_CONTEXT: 'ALLOW_CONTEXT',
});

const CATEGORY = Object.freeze({
  PROFANITY: 'PROFANITY',
  INSULT: 'INSULT',
  SEXUAL: 'SEXUAL',
  VIOLENCE: 'VIOLENCE',
  SUBSTANCES: 'SUBSTANCES',
  DISCRIMINATION: 'DISCRIMINATION',
});

const SEXUAL_TERMS = new Set([
  'cona', 'conas', 'conaça', 'piça', 'pixa', 'picha', 'pichota', 'pichotas',
  'colhão', 'colhões', 'colhoezinhos', 'punheta', 'punhetas', 'punheteiro', 'punheteiros',
  'mamada', 'mamadas', 'mamalhuda', 'caralhinho', 'caralhinhos', 'mamar', 'mamou', 'mamava', 'tesão', 'tesões',
]);

const DISCRIMINATION_TERMS = new Set([
  'paneleiro', 'paneleira', 'paneleiros', 'paneleiras', 'boiola', 'boiolas', 'maricas',
]);

function inferCategory(term) {
  const t = String(term || '').toLowerCase();
  if (SEXUAL_TERMS.has(t) || /\b(picha|pi[cç]a|cona|punhe|mamad)/i.test(t)) return CATEGORY.SEXUAL;
  if (DISCRIMINATION_TERMS.has(t)) return CATEGORY.DISCRIMINATION;
  if (/\b(puta|cabr[aã]o|idiota|imbecil|est[uú]pid|parvo|ot[aá]ri)/i.test(t)) return CATEGORY.INSULT;
  return CATEGORY.PROFANITY;
}

const PHRASE_RULES = PHRASE_REPLACEMENTS.map(([phrase, replacement]) => ({
  phrase,
  replacement,
  severity: SEVERITY.REWRITE,
  category: inferCategory(phrase),
  autoReplace: true,
}));

const WORD_RULES = WORD_REPLACEMENTS.map(([word, replacement, autoReplace, safeInGame]) => ({
  word,
  replacement,
  severity: safeInGame ? SEVERITY.ALLOW_CONTEXT : SEVERITY.REWRITE,
  category: inferCategory(word),
  autoReplace: autoReplace !== false,
  safeInGame: safeInGame === true,
}));

const PATTERN_RULES = [
  {
    id: 'violence_graphic',
    re: /\b(tortur\w*|mutil\w*|esquartej\w*|decapit\w*|despedaç\w*|despedac\w*)\b/i,
    severity: SEVERITY.BLOCK,
    category: CATEGORY.VIOLENCE,
    message: 'evita descrições gráficas de violência, tortura ou mutilação',
  },
  {
    id: 'substances_hard',
    re: /\b(hero[ií]na|coca[ií]na|metanfetamina|ecstasy|lsd|crack|ópio|opio)\b/i,
    severity: SEVERITY.BLOCK,
    category: CATEGORY.SUBSTANCES,
    message: 'evita referências a drogas ilícitas',
  },
  {
    id: 'substances_promo',
    re: /\b(?:fuma(?:r)?|fumem)\s+(?:cannabis|erva|charro|marijuana)|bebe(?:r)?\s+at[eé]\s+(?:à|a)\s+embriaguez\b/i,
    severity: SEVERITY.REWRITE,
    category: CATEGORY.SUBSTANCES,
    message: 'evita incentivar consumo de álcool, tabaco ou drogas',
  },
];

const EDUCATIONAL_CONTEXT_RE = /\b(hist[oó]ri|histor|cient[ií]fi|ciencia|significa|etimolog|origem (?:da palavra|do termo)|na idade|no s[eé]culo|seculo|antigamente|termo m[eé]dico|anatomia|educativ|lingu[ií]st|era chamad|chamava-se|designava|defini[cç][aã]o|voc[aá]bulo|sentido (?:da palavra|do termo)|em portugu[eê]s antigo)\b/i;

function buildContentSafetyPromptRules() {
  return `SEGURANÇA DE CONTEÚDO:
- O conteúdo deve ser adequado a um jogo familiar e a jogadores a partir da faixa etária definida.
- Não utilizar palavrões, insultos, linguagem sexual explícita ou conteúdo discriminatório.
- Não utilizar linguagem vulgar apenas para tornar a pergunta mais engraçada.
- Evitar descrições gráficas de violência, tortura, mutilação ou morte.
- Evitar conteúdo que incentive consumo de drogas, álcool ou tabaco.
- Palavras potencialmente ofensivas podem ser utilizadas quando forem indispensáveis ao contexto educativo, histórico, científico ou linguístico.
- Quando uma pergunta contiver linguagem inadequada, reformular a pergunta de forma neutra, preservando o conhecimento que está a ser testado.
- Nunca substituir uma palavra de forma a alterar o facto histórico ou científico perguntado.
- PT-PT: não transformar automaticamente linguagem coloquial portuguesa legítima em português brasileiro ou linguagem excessivamente formal. Limpa a ofensa mantendo o registo natural de português de Portugal.`;
}

module.exports = {
  SEVERITY,
  CATEGORY,
  PHRASE_RULES,
  WORD_RULES,
  PATTERN_RULES,
  EDUCATIONAL_CONTEXT_RE,
  buildContentSafetyPromptRules,
};
