/**
 * Topónimos PT-PT (países e cidades) — import Wikidata e validação do motor.
 * Canónico: Priberam / Infopédia. Variantes: PT-BR, inglês, grafias antigas.
 */
(function (global) {
  'use strict';

  const PLACE_FORMS = Object.freeze([
    { canonical: 'Bagdade', variants: ['Baguedade', 'Bagdá', 'Bagdad'] },
    { canonical: 'Moscovo', variants: ['Moscou', 'Moscow'] },
    { canonical: 'Teerão', variants: ['Teerã', 'Teheran', 'Tehran'] },
    { canonical: 'Riade', variants: ['Riad', 'Riyadh'] },
    { canonical: 'Nova Iorque', variants: ['Nova York', 'New York'] },
    { canonical: 'Pequim', variants: ['Beijing', 'Peking'] },
    { canonical: 'Banguecoque', variants: ['Bangcoc', 'Bangkok'] },
    { canonical: 'Tóquio', variants: ['Tokyo'] },
    { canonical: 'Quioto', variants: ['Kyoto'] },
    { canonical: 'Seul', variants: ['Seoul'] },
    { canonical: 'Pionguiangue', variants: ['Pyongyang'] },
    { canonical: 'Bombaim', variants: ['Mumbai', 'Bombay'] },
    { canonical: 'Calcutá', variants: ['Kolkata', 'Calcutta'] },
    { canonical: 'Meca', variants: ['Mecca'] },
    { canonical: 'Istambul', variants: ['Istanbul'] },
    { canonical: 'Argel', variants: ['Algiers'] },
    { canonical: 'Tunes', variants: ['Tunis'] },
    { canonical: 'Telavive', variants: ['Tel Aviv', 'Telaviv'] },
    { canonical: 'Montevideu', variants: ['Montevideo'] },
    { canonical: 'Camberra', variants: ['Canberra'] },
    { canonical: 'Hanói', variants: ['Hanoi'] },
    { canonical: 'Saigão', variants: ['Saigon'] },
    { canonical: 'Cantão', variants: ['Canton', 'Guangzhou'] },
    { canonical: 'Osaca', variants: ['Osaka'] },
    { canonical: 'Beirute', variants: ['Beirut'] },
    { canonical: 'Damasco', variants: ['Damascus'] },
    { canonical: 'Jerusalém', variants: ['Jerusalem'] },
    { canonical: 'Irão', variants: ['Irã', 'Iran'] },
    { canonical: 'Egipto', variants: ['Egito', 'Egypt'] },
    { canonical: 'Vietname', variants: ['Vietnã', 'Vietnam'] },
    { canonical: 'Quénia', variants: ['Quênia', 'Kenya'] },
    { canonical: 'Roménia', variants: ['Romênia', 'Romania'] },
    { canonical: 'Polónia', variants: ['Polônia', 'Poland'] },
    { canonical: 'Estónia', variants: ['Estônia', 'Estonia'] },
    { canonical: 'Letónia', variants: ['Letônia', 'Latvia'] },
    { canonical: 'Eslovénia', variants: ['Eslovênia', 'Slovenia'] },
    { canonical: 'Arménia', variants: ['Armênia', 'Armenia'] },
    { canonical: 'Mónaco', variants: ['Mônaco'] },
    { canonical: 'Zimbabué', variants: ['Zimbábue', 'Zimbabwe'] },
    { canonical: 'Usbequistão', variants: ['Uzbequistão', 'Uzbekistan'] },
    { canonical: 'Bangladeche', variants: ['Bangladesh'] },
    { canonical: 'Catar', variants: ['Qatar'] },
    { canonical: 'Chéquia', variants: ['Czechia', 'Czech Republic'] },
    { canonical: 'Cabo Verde', variants: ['Cape Verde'] },
    { canonical: 'Costa do Marfim', variants: ['Ivory Coast'] },
    { canonical: 'Coreia do Sul', variants: ['South Korea'] },
    { canonical: 'Coreia do Norte', variants: ['North Korea'] },
    { canonical: 'Estados Unidos', variants: ['United States'] },
    { canonical: 'Reino Unido', variants: ['United Kingdom'] },
    { canonical: 'Países Baixos', variants: ['Holland'] },
    { canonical: 'Mianmar', variants: ['Myanmar', 'Burma'] },
    { canonical: 'Essuatíni', variants: ['Eswatini', 'Swaziland'] },
    { canonical: 'Iraque', variants: ['Iraq'] },
  ]);

  function escapeRe(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyCase(template, sample) {
    const t = String(template || '');
    const s = String(sample || '');
    if (!s) return t;
    if (s === s.toUpperCase()) return t.toUpperCase();
    if (s[0] === s[0].toUpperCase()) return t.charAt(0).toUpperCase() + t.slice(1);
    return t;
  }

  function wholeWordRe(variant, flags) {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(variant)}(?![\\p{L}\\p{N}])`, flags);
  }

  function variantPairs() {
    const pairs = [];
    for (const form of PLACE_FORMS) {
      for (const variant of form.variants) {
        pairs.push({ variant, canonical: form.canonical, len: variant.length });
      }
    }
    pairs.sort((a, b) => b.len - a.len);
    return pairs;
  }

  function canonicalizePlaceText(text) {
    let out = String(text || '');
    if (!out) return out;
    for (const { variant, canonical } of variantPairs()) {
      out = out.replace(wholeWordRe(variant, 'giu'), (m) => applyCase(canonical, m));
    }
    return out;
  }

  function surfaceFormUsed(text, form) {
    const names = [form.canonical, ...form.variants];
    for (const name of names) {
      if (wholeWordRe(name, 'iu').test(text)) return name;
    }
    return '';
  }

  function findPlaceNameIssues(blob) {
    const text = String(blob || '');
    const issues = [];
    for (const form of PLACE_FORMS) {
      for (const variant of form.variants) {
        if (wholeWordRe(variant, 'iu').test(text)) {
          issues.push({ variant, canonical: form.canonical });
          break;
        }
      }
    }
    return issues;
  }

  function placeFormsMismatch(question, answer, options = []) {
    const q = String(question || '');
    const a = [String(answer || ''), ...(options || [])].join(' ');
    for (const form of PLACE_FORMS) {
      const inQ = surfaceFormUsed(q, form);
      const inA = surfaceFormUsed(a, form);
      if (inQ && inA && inQ.toLowerCase() !== inA.toLowerCase()) {
        return { canonical: form.canonical, question: inQ, answer: inA };
      }
    }
    return null;
  }

  const api = {
    PLACE_FORMS,
    canonicalizePlaceText,
    findPlaceNameIssues,
    placeFormsMismatch,
  };

  global.QuestionEnginePtPtPlaces = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
