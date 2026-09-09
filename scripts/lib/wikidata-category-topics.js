'use strict';

/**
 * Sugestões de palavras e atalhos SPARQL por categoria do jogo.
 * As palavras alimentam a pesquisa Wikidata; os atalhos são queries fechadas.
 */

const CATEGORY_TOPICS = {
  1: {
    topic: 'conhecimentos gerais',
    suggestions: ['Portugal', 'Europa', 'ONU', 'Nobel', 'olimpíadas', 'cruz vermelha'],
  },
  2: {
    topic: 'geografia',
    suggestions: ['Portugal', 'Lisboa', 'Tejo', 'Alpes', 'Amazonas', 'Sahara', 'Antárctida', 'Reno'],
    presets: [{ id: 'countryCapitals', label: 'Capitais de países' }],
  },
  3: {
    topic: 'história',
    suggestions: ['Viriato', 'D. Afonso Henriques', 'Descobrimentos', 'revolução de 25 de Abril', 'Roma antiga', 'Egipto'],
  },
  4: {
    topic: 'ciência',
    suggestions: ['gravidade', 'átomo', 'DNA', 'vacina', 'fotossíntese', 'Newton', 'Curie'],
  },
  5: {
    topic: 'natureza',
    suggestions: ['lince-ibérico', 'sobreiro', 'polvo', 'abelha', 'golfinho', 'carvalho', 'lobo'],
  },
  6: {
    topic: 'espaço',
    suggestions: ['Marte', 'Lua', 'Saturno', 'Via Láctea', 'cometa', 'ISS', 'Júpiter'],
  },
  7: {
    topic: 'matemática',
    suggestions: ['zero', 'pi', 'Pitágoras', 'Fibonacci', 'primo', 'triângulo'],
  },
  8: {
    topic: 'literatura',
    suggestions: ['Camões', 'Pessoa', 'Os Lusíadas', 'Shakespeare', 'Saramago', 'Eça de Queirós'],
  },
  9: {
    topic: 'português',
    suggestions: ['Camões', 'Pessoa', 'acordo ortográfico', 'provérbio', 'alfabeto'],
  },
  10: {
    topic: 'arte',
    suggestions: ['Picasso', 'Van Gogh', 'Mona Lisa', 'Azulejo', 'Nuno Gonçalves', 'Amadeo'],
  },
  11: {
    topic: 'cinema',
    suggestions: ['Manoel de Oliveira', 'Oscar', 'Cinema português', 'animação', 'documentário'],
  },
  12: {
    topic: 'música',
    suggestions: ['fado', 'Amália', 'guitarra portuguesa', 'Mozart', 'Beatles', 'piano'],
  },
  13: {
    topic: 'moda',
    suggestions: ['lenço dos namorados', 'barrete', 'seda', 'algodão', 'traje'],
  },
  14: {
    topic: 'gastronomia',
    suggestions: ['pastel de nata', 'bacalhau', 'francesinha', 'azeite', 'queijo da Serra', 'vinho do Porto'],
  },
  15: {
    topic: 'desporto',
    suggestions: ['futebol', 'Eusébio', 'Jogos Olímpicos', 'ténis', 'natação', 'Tour de France'],
  },
  16: {
    topic: 'jogos',
    suggestions: ['xadrez', 'damas', 'sueca', 'monopoly', 'consola'],
  },
  17: {
    topic: 'tecnologia',
    suggestions: ['internet', 'GPS', 'lâmpada', 'telefone', 'energia solar', 'robô'],
  },
  18: {
    topic: 'culturas',
    suggestions: ['fado', 'festa de São João', 'Carnaval', 'língua gestual', 'kimono', 'sari'],
  },
  19: {
    topic: 'transportes',
    suggestions: ['comboio', 'metro', 'avião', 'bicicleta', 'TGV', 'navio'],
  },
  20: {
    topic: 'curiosidade surpreendente',
    suggestions: ['polvo', 'girafa', 'colibri', 'baleia-azul', 'fado', 'azulejo'],
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
