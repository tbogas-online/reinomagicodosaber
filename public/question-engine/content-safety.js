/**
 * Segurança de conteúdo — normalização anti-bypass, categorias e severidade.
 */
(function (global) {
  'use strict';

  const Data = global.QuestionEngineContentSafetyData;
  if (!Data) {
    throw new Error('content-safety: carrega content-safety-data.js antes deste módulo');
  }

  const {
    SEVERITY,
    CATEGORY,
    PHRASE_RULES,
    WORD_RULES,
    PATTERN_RULES,
    EDUCATIONAL_CONTEXT_SOURCE,
    EDUCATIONAL_CONTEXT_FLAGS,
    buildContentSafetyPromptRules,
  } = Data;

  const EDUCATIONAL_CONTEXT_RE = new RegExp(EDUCATIONAL_CONTEXT_SOURCE, EDUCATIONAL_CONTEXT_FLAGS);
  const COMPILED_PATTERN_RULES = PATTERN_RULES.map((rule) => ({
    ...rule,
    re: new RegExp(rule.source, rule.flags),
  }));

  const LETTER_BOUNDARY = '(?<![a-z0-9à-ÿ])';
  const LETTER_END = '(?![a-z0-9à-ÿ])';
  const LEET_MAP = Object.freeze({
    '@': 'a', '4': 'a', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '5': 's', '$': 's', '7': 't',
  });

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripAccents(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function applyCaseLike(replacement, match) {
    if (!match) return replacement;
    if (match === match.toUpperCase()) return replacement.toUpperCase();
    if (match[0] === match[0].toUpperCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  }

  function normalizeToken(text) {
    return stripAccents(String(text || '').toLowerCase()).replace(/[^a-z0-9]/g, '');
  }

  function normalizeAntiBypass(text) {
    let raw = String(text || '').toLowerCase();
    raw = stripAccents(raw);
    for (const [from, to] of Object.entries(LEET_MAP)) {
      raw = raw.split(from).join(to);
    }
    const spaced = raw.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const compact = spaced.replace(/\s+/g, '');
    return { raw, spaced, compact };
  }

  function flexiblePhraseRegex(phrase) {
    const parts = stripAccents(String(phrase).toLowerCase()).split(/\s+/).filter(Boolean).map(escapeRegex);
    if (!parts.length) return null;
    return new RegExp(`${LETTER_BOUNDARY}${parts.join('[\\s.\\-_@*0-9]+')}${LETTER_END}`, 'gi');
  }

  function flexibleWordRegex(word) {
    const chars = stripAccents(String(word).toLowerCase()).split('').map(escapeRegex);
    if (!chars.length) return null;
    return new RegExp(`${LETTER_BOUNDARY}${chars.join('[\\s.\\-_@*0-9]*')}${LETTER_END}`, 'gi');
  }

  const COMPILED_PHRASE_RULES = PHRASE_RULES
    .slice()
    .sort((a, b) => b.phrase.length - a.phrase.length)
    .map((rule) => ({
      ...rule,
      regex: flexiblePhraseRegex(rule.phrase),
      compact: normalizeToken(rule.phrase),
      spaced: stripAccents(rule.phrase).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((rule) => rule.regex);

  const COMPILED_WORD_RULES = WORD_RULES
    .slice()
    .sort((a, b) => b.word.length - a.word.length)
    .map((rule) => ({
      ...rule,
      regex: flexibleWordRegex(rule.word),
      compact: normalizeToken(rule.word),
    }))
    .filter((rule) => rule.regex);

  function extractAbbreviationTokens(spaced) {
    const tokens = String(spaced || '').split(' ').filter(Boolean);
    const abbreviations = [];
    let current = '';
    for (const token of tokens) {
      if (token.length === 1) current += token;
      else {
        if (current.length >= 2) abbreviations.push(current);
        current = '';
      }
    }
    if (current.length >= 2) abbreviations.push(current);
    return abbreviations;
  }

  function matchesWord(norm, rule, source) {
    const { compact, spaced } = norm;
    const token = rule.compact;
    if (!token) return false;
    if (rule.regex && source && rule.regex.test(source)) return true;
    if (token.length <= 3) {
      if (compact === token) return true;
      if (extractAbbreviationTokens(spaced).includes(token)) return true;
      const re = new RegExp(`(^|[\\s.,;:!?])${escapeRegex(rule.word)}([\\s.,;:!?]|$)`, 'i');
      return re.test(spaced);
    }
    if (spaced.split(' ').some((word) => normalizeToken(word) === token)) return true;
    return extractAbbreviationTokens(spaced).includes(token);
  }

  function hasEducationalContext(text) {
    return EDUCATIONAL_CONTEXT_RE.test(String(text || ''));
  }

  function shouldAllowContextualMatch(text, match) {
    if (match.severity !== SEVERITY.ALLOW_CONTEXT) return false;
    return hasEducationalContext(text);
  }

  function findPatternMatches(text) {
    const source = String(text || '');
    const matches = [];
    for (const rule of COMPILED_PATTERN_RULES) {
      if (rule.re.test(source)) {
        matches.push({
          type: 'pattern',
          term: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: rule.message,
          autoReplace: false,
        });
      }
    }
    return matches;
  }

  function findContentSafetyMatches(text) {
    const source = String(text || '');
    if (!source.trim()) return [];
    const norm = normalizeAntiBypass(source);
    const matches = [...findPatternMatches(source)];

    for (const rule of COMPILED_PHRASE_RULES) {
      if ((rule.compact && rule.compact.length >= 5 && norm.compact.includes(rule.compact))
        || (rule.spaced && norm.spaced.includes(rule.spaced))) {
        matches.push({
          type: 'phrase',
          term: rule.phrase,
          replacement: rule.replacement,
          severity: rule.severity,
          category: rule.category,
          autoReplace: rule.autoReplace,
        });
      }
    }

    for (const rule of COMPILED_WORD_RULES) {
      if (rule.safeInGame) continue;
      if (!matchesWord(norm, rule, source)) continue;
      matches.push({
        type: 'word',
        term: rule.word,
        replacement: rule.replacement,
        severity: rule.severity,
        category: rule.category,
        autoReplace: rule.autoReplace,
      });
    }

    const seen = new Set();
    return matches.filter((item) => {
      const key = `${item.type}:${item.term}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function filterActionableMatches(text, matches) {
    return matches.filter((match) => {
      if (shouldAllowContextualMatch(text, match)) return false;
      if (match.severity === SEVERITY.ALLOW_CONTEXT && !hasEducationalContext(text)) return true;
      return match.severity === SEVERITY.BLOCK || match.severity === SEVERITY.REWRITE;
    });
  }

  function applyReplacementRules(text) {
    let out = String(text || '');
    for (const rule of COMPILED_PHRASE_RULES) {
      if (rule.severity !== SEVERITY.REWRITE || !rule.autoReplace) continue;
      out = out.replace(rule.regex, (match) => applyCaseLike(rule.replacement, match));
    }
    for (const rule of COMPILED_WORD_RULES) {
      if (!rule.autoReplace || rule.severity !== SEVERITY.REWRITE) continue;
      out = out.replace(rule.regex, (match) => applyCaseLike(rule.replacement, match));
    }
    return out;
  }

  function sanitizeQuestionText(text, options = {}) {
    const source = String(text || '');
    if (!source) {
      return { text: source, changed: false, matches: [], actionable: [], needsReformulation: false, blocked: false, ok: true };
    }

    const initialMatches = findContentSafetyMatches(source);
    const actionable = filterActionableMatches(source, initialMatches);
    if (!actionable.length) {
      return { text: source, changed: false, matches: initialMatches, actionable, needsReformulation: false, blocked: false, ok: true };
    }

    const blocked = actionable.some((match) => match.severity === SEVERITY.BLOCK);
    if (options.detectOnly || blocked) {
      return {
        text: source,
        changed: false,
        matches: initialMatches,
        actionable,
        needsReformulation: !blocked && actionable.length > 0,
        blocked,
        ok: false,
      };
    }

    const out = applyReplacementRules(source);
    const remaining = filterActionableMatches(out, findContentSafetyMatches(out));
    return {
      text: out,
      changed: out !== source,
      matches: initialMatches,
      actionable,
      remaining,
      needsReformulation: remaining.length > 0,
      blocked: false,
      ok: remaining.length === 0,
    };
  }

  function findOffensiveMatches(text) {
    return findContentSafetyMatches(text);
  }

  function containsOffensiveLanguage(text) {
    return filterActionableMatches(text, findContentSafetyMatches(text)).length > 0;
  }

  function isOffensiveWord(text) {
    const norm = normalizeToken(text);
    if (!norm) return false;
    return COMPILED_WORD_RULES.some((rule) => {
      if (rule.safeInGame && norm === rule.compact) return false;
      return rule.compact === norm && rule.severity !== SEVERITY.ALLOW_CONTEXT;
    });
  }

  function containsOffensiveWord(text) {
    return containsOffensiveLanguage(text);
  }

  function sanitizeFamilySafeText(text) {
    return sanitizeQuestionText(text).text;
  }

  function sanitizeFamilySafeParsed(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const out = { ...parsed };
    if (out.q) out.q = sanitizeFamilySafeText(out.q);
    if (out.a) out.a = sanitizeFamilySafeText(out.a);
    if (Array.isArray(out.options)) out.options = out.options.map(sanitizeFamilySafeText);
    if (Array.isArray(out.clues)) out.clues = out.clues.map(sanitizeFamilySafeText);
    return out;
  }

  function collectContentSafetyIssues(q, a, options = [], clues = []) {
    const fields = [
      { label: 'pergunta', text: q },
      { label: 'resposta', text: a },
      ...options.map((opt, index) => ({ label: `opção ${index + 1}`, text: opt })),
      ...clues.map((clue, index) => ({ label: `pista ${index + 1}`, text: clue })),
    ];
    const issues = [];

    for (const field of fields) {
      const result = sanitizeQuestionText(field.text, { detectOnly: true });
      if (!result.actionable?.length) continue;

      const blocked = result.actionable.filter((match) => match.severity === SEVERITY.BLOCK);
      if (blocked.length) {
        const detail = blocked[0].message || blocked[0].term;
        issues.push({
          code: 'CONTENT_BLOCKED',
          layer: 'ptPt',
          message: `conteúdo inadequado na ${field.label} (${detail})`,
          terms: blocked.map((match) => match.term),
          severity: SEVERITY.BLOCK,
        });
        continue;
      }

      const terms = result.actionable.map((match) => match.term).slice(0, 3).join(', ');
      issues.push({
        code: 'PT_OFFENSIVE_LANGUAGE',
        layer: 'ptPt',
        message: `linguagem inadequada na ${field.label}${terms ? ` (${terms})` : ''} — reformula a frase inteira com vocabulário adequado, preservando o conhecimento testado`,
        terms: result.actionable.map((match) => match.term),
        severity: SEVERITY.REWRITE,
      });
    }

    return issues;
  }

  const collectFamilySafeIssues = collectContentSafetyIssues;

  const api = Object.freeze({
    SEVERITY,
    CATEGORY,
    normalizeAntiBypass,
    hasEducationalContext,
    findContentSafetyMatches,
    findOffensiveMatches,
    sanitizeQuestionText,
    sanitizeFamilySafeText,
    sanitizeFamilySafeParsed,
    containsOffensiveLanguage,
    containsOffensiveWord,
    isOffensiveWord,
    collectContentSafetyIssues,
    collectFamilySafeIssues,
    buildContentSafetyPromptRules,
  });

  global.QuestionEngineContentSafety = api;
  global.QuestionEngineFamilySafeWords = api;
})(typeof window !== 'undefined' ? window : globalThis);
