'use strict';

const BANK_AGE_BANDS = ['6-9', '10-15', '15+'];

const CATEGORY_NAMES = {
  1: 'Conhecimentos Gerais',
  2: 'Geografia',
  3: 'História',
  4: 'Ciência',
  5: 'Natureza',
  6: 'Espaço',
  7: 'Matemática e Lógica',
  8: 'Literatura',
  9: 'Português',
  10: 'Arte',
  11: 'Cinema e Séries',
  12: 'Música',
  13: 'Moda',
  14: 'Gastronomia',
  15: 'Desporto',
  16: 'Jogos',
  17: 'Tecnologia',
  18: 'Culturas do Mundo',
  19: 'Transportes',
  20: 'Adivinhas e Curiosidades',
};

function categoryNameFromN(categoryN) {
  return CATEGORY_NAMES[Number(categoryN)] || '';
}

function uniqueSorted(nums) {
  return [...new Set(nums)].sort((a, b) => a - b);
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeCategoryNs(input, fallbackSingle, existingRow) {
  let list = [];
  if (Array.isArray(input) && input.length) {
    list = input.map((n) => Number(n)).filter((n) => n >= 1 && n <= 20);
  } else if (fallbackSingle != null && fallbackSingle !== '') {
    const n = Number(fallbackSingle);
    if (n >= 1 && n <= 20) list = [n];
  } else if (existingRow) {
    if (Array.isArray(existingRow.category_ns) && existingRow.category_ns.length) {
      list = existingRow.category_ns.map((n) => Number(n)).filter((n) => n >= 1 && n <= 20);
    } else {
      const n = Number(existingRow.category_n);
      if (n >= 1 && n <= 20) list = [n];
    }
  }
  return uniqueSorted(list);
}

function normalizeAgeBands(input, fallbackSingle, existingRow) {
  let list = [];
  if (Array.isArray(input) && input.length) {
    list = input.map((b) => String(b || '').trim()).filter((b) => BANK_AGE_BANDS.includes(b));
  } else if (fallbackSingle != null && String(fallbackSingle).trim()) {
    const b = String(fallbackSingle).trim();
    if (BANK_AGE_BANDS.includes(b)) list = [b];
  } else if (existingRow) {
    if (Array.isArray(existingRow.age_bands) && existingRow.age_bands.length) {
      list = existingRow.age_bands.map((b) => String(b || '').trim()).filter((b) => BANK_AGE_BANDS.includes(b));
    } else {
      const b = String(existingRow.age_band || '').trim();
      if (BANK_AGE_BANDS.includes(b)) list = [b];
    }
  }
  return [...new Set(list)];
}

function normalizeReportCategoryNs(report) {
  if (Array.isArray(report?.categoryNs) && report.categoryNs.length) {
    return uniqueSorted(report.categoryNs.map((n) => Number(n)).filter((n) => n >= 1 && n <= 20));
  }
  if (Array.isArray(report?.categories) && report.categories.length) {
    return uniqueSorted(report.categories.map((c) => Number(c?.n)).filter((n) => n >= 1 && n <= 20));
  }
  const n = Number(report?.category?.n);
  return n >= 1 && n <= 20 ? [n] : [];
}

function normalizeReportAgeBands(report) {
  if (Array.isArray(report?.ageBands) && report.ageBands.length) {
    return [...new Set(report.ageBands.map((b) => String(b || '').trim()).filter((b) => BANK_AGE_BANDS.includes(b)))];
  }
  const b = String(report?.ageBand || '').trim();
  return BANK_AGE_BANDS.includes(b) ? [b] : [];
}

function buildBankTaxonomyPatch(categoryNs, ageBands) {
  const cats = uniqueSorted(categoryNs);
  const ages = normalizeAgeBands(ageBands);
  return {
    category_ns: cats,
    age_bands: ages,
    category_n: cats[0] || null,
    age_band: ages[0] || null,
  };
}

function expandBankRowTaxonomy(row) {
  const categoryNs = normalizeCategoryNs(null, null, row);
  const ageBands = normalizeAgeBands(null, null, row);
  return { categoryNs, ageBands };
}

function formatCategoryList(categoryNs) {
  return uniqueSorted(categoryNs).map((n) => `${n}. ${categoryNameFromN(n) || n}`).join(' · ');
}

module.exports = {
  BANK_AGE_BANDS,
  CATEGORY_NAMES,
  categoryNameFromN,
  normalizeCategoryNs,
  normalizeAgeBands,
  normalizeReportCategoryNs,
  normalizeReportAgeBands,
  buildBankTaxonomyPatch,
  expandBankRowTaxonomy,
  formatCategoryList,
  arraysEqual,
};
