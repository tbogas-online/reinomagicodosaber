'use strict';

/**
 * Sugestões de palavras e atalhos SPARQL por categoria do jogo.
 * As palavras alimentam a pesquisa Wikidata; os atalhos são queries fechadas.
 */

const CATEGORY_TOPICS = {
  1: {
    topic: 'conhecimentos gerais',
    suggestions: ['Portugal', 'Europa', 'ONU', 'Nobel', 'olimpíadas'],
  },
  2: {
    topic: 'geografia',
    suggestions: ['Portugal', 'Lisboa', 'Tejo', 'Alpes', 'Amazonas', 'Sahara', 'Antárctida'],
    presets: [{ id: 'countryCapitals', label: 'Capitais de países' }],
  },
  3: {
    topic: 'história',
    suggestions: ['Viriato', 'Roma', 'Egipto', 'Napoleão', 'Descobrimentos'],
  },
  4: {
    topic: 'ciência',
    suggestions: ['Newton', 'Curie', 'átomo', 'vacina', 'oxigénio'],
  },
  5: {
    topic: 'natureza',
    suggestions: ['polvo', 'lobo', 'abelha', 'sobreiro', 'golfinho', 'girafa', 'carvalho'],
  },
  6: {
    topic: 'espaço',
    suggestions: ['Marte', 'Lua', 'Saturno', 'Júpiter', 'cometa'],
  },
  7: {
    topic: 'matemática',
    suggestions: ['Pitágoras', 'pi', 'triângulo', 'zero', 'Fibonacci'],
  },
  8: {
    topic: 'literatura',
    suggestions: ['Camões', 'Pessoa', 'Shakespeare', 'Saramago'],
  },
  9: {
    topic: 'português',
    suggestions: ['Camões', 'Pessoa', 'alfabeto', 'provérbio'],
  },
  10: {
    topic: 'arte',
    suggestions: ['Picasso', 'Van Gogh', 'Mona Lisa', 'azulejo'],
  },
  11: {
    topic: 'cinema',
    suggestions: ['Oscar', 'animação', 'documentário', 'filme'],
  },
  12: {
    topic: 'música',
    suggestions: ['fado', 'Amália', 'Mozart', 'piano', 'Beatles'],
  },
  13: {
    topic: 'moda',
    suggestions: ['seda', 'algodão', 'barrete', 'traje'],
  },
  14: {
    topic: 'gastronomia',
    suggestions: ['bacalhau', 'azeite', 'francesinha', 'nata'],
  },
  15: {
    topic: 'desporto',
    suggestions: ['futebol', 'Eusébio', 'natação', 'ténis', 'olimpíadas'],
  },
  16: {
    topic: 'jogos',
    suggestions: ['xadrez', 'damas', 'monopoly', 'sueca'],
  },
  17: {
    topic: 'tecnologia',
    suggestions: ['internet', 'GPS', 'telefone', 'lâmpada', 'robô'],
  },
  18: {
    topic: 'culturas',
    suggestions: ['fado', 'Carnaval', 'kimono', 'sari'],
  },
  19: {
    topic: 'transportes',
    suggestions: ['comboio', 'avião', 'bicicleta', 'navio', 'metro'],
  },
  20: {
    topic: 'curiosidade surpreendente',
    suggestions: ['polvo', 'girafa', 'colibri', 'azulejo', 'fado'],
    presets: [
      { id: 'unescoPt', label: 'Património UNESCO em Portugal' },
      { id: 'ichPt', label: 'Património imaterial PT' },
    ],
  },
};

function listCategoryTopics() {
  return Object.keys(CATEGORY_TOPICS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((categoryN) => {
      const row = CATEGORY_TOPICS[categoryN];
      return {
        categoryN,
        topic: row.topic,
        suggestions: [...row.suggestions],
        presets: Array.isArray(row.presets) ? row.presets.map((p) => ({ ...p, categoryN })) : [],
      };
    });
}

function getCategoryTopic(categoryN) {
  const n = Number(categoryN);
  const row = CATEGORY_TOPICS[n];
  if (!row) return null;
  return {
    categoryN: n,
    topic: row.topic,
    suggestions: [...row.suggestions],
    presets: Array.isArray(row.presets) ? row.presets.map((p) => ({ ...p, categoryN: n })) : [],
  };
}

module.exports = {
  CATEGORY_TOPICS,
  listCategoryTopics,
  getCategoryTopic,
};
