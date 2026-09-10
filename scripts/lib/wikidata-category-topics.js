'use strict';

/**
 * Curadoria Wikidata: Categoria → Subtema → Tópico → palavras SPARQL.
 * Geografia (cat. 2) é o piloto com 3 níveis; as outras categorias
 * ficam em 2 níveis (subtema com sugestões) até replicarmos o modelo.
 */

function focus(id, label, suggestions, extra = {}) {
  return {
    id,
    label,
    contentType: extra.contentType || 'place',
    preset: extra.preset || '',
    suggestions,
  };
}

const CATEGORY_TOPICS = {
  1: {
    topic: 'conhecimentos gerais',
    suggestions: ['Portugal', 'Europa', 'ONU', 'Nobel', 'olimpíadas'],
    subtopics: [
      { id: 'institutions', label: 'Instituições', suggestions: ['ONU', 'UE', 'NATO', 'UNESCO'] },
      { id: 'prizes', label: 'Prémios', suggestions: ['Nobel', 'Pulitzer', 'Oscar', 'olimpíadas'] },
      { id: 'portugal', label: 'Portugal', contentType: 'place', suggestions: ['Portugal', 'Lisboa', 'Europa', 'ONU'] },
    ],
  },
  2: {
    topic: 'geografia',
    suggestions: ['Portugal', 'Lisboa', 'Tejo', 'Alpes', 'Amazonas', 'Sahara', 'Antárctida'],
    presets: [{ id: 'countryCapitals', label: 'Capitais de países' }],
    subtopics: [
      {
        id: 'portugal',
        label: 'Portugal',
        contentType: 'place',
        scope: 'portugal',
        topics: [
          focus('districts', 'Distritos', ['Lisboa', 'Porto', 'Faro', 'Braga', 'Coimbra']),
          focus('municipalities', 'Municípios', ['Sintra', 'Cascais', 'Guimarães', 'Óbidos', 'Évora']),
          focus('regions', 'Regiões', ['Alentejo', 'Algarve', 'Minho', 'Douro', 'Açores']),
          focus('rivers', 'Rios', ['Tejo', 'Douro', 'Guadiana', 'Minho', 'Mondego']),
          focus('mountains', 'Serras', ['Estrela', 'Gerês', 'Arrábida', 'Sintra', 'Marão']),
          focus('beaches', 'Praias', ['Nazaré', 'Guincho', 'Algarve', 'Figueira']),
          focus('islands', 'Ilhas', ['Madeira', 'Porto Santo', 'São Miguel', 'Terceira', 'Pico']),
          focus('parks', 'Parques naturais', ['Gerês', 'Arrábida', 'Sintra', 'Peneda']),
        ],
      },
      {
        id: 'europa',
        label: 'Europa',
        contentType: 'place',
        scope: 'europa',
        topics: [
          focus('countries', 'Países', ['Espanha', 'França', 'Alemanha', 'Itália', 'Grécia']),
          focus('capitals', 'Capitais', ['Paris', 'Madrid', 'Berlim', 'Roma', 'Atenas']),
          focus('rivers', 'Rios', ['Danúbio', 'Reno', 'Sena', 'Volga', 'Tamisa']),
          focus('mountains', 'Montanhas', ['Alpes', 'Pirenéus', 'Cárpatos', 'Apeninos']),
          focus('seas', 'Mares', ['Mediterrâneo', 'Báltico', 'Negro', 'Norte']),
          focus('borders', 'Fronteiras', ['Pirenéus', 'Alpes', 'Reno', 'Danúbio']),
        ],
      },
      {
        id: 'world',
        label: 'Mundo',
        contentType: 'place',
        scope: 'world',
        topics: [
          focus('countries', 'Países', ['Brasil', 'China', 'Índia', 'Japão', 'Egipto']),
          focus('capitals', 'Capitais', ['Pequim', 'Tóquio', 'Brasília', 'Cairo']),
          focus('continents', 'Continentes', ['Europa', 'África', 'Ásia', 'América', 'Antárctida']),
          focus('oceans', 'Oceanos', ['Atlântico', 'Pacífico', 'Índico', 'Ártico']),
          focus('rivers', 'Grandes rios', ['Amazonas', 'Nilo', 'Mississípi', 'Yangtzé']),
          focus('mountains', 'Grandes montanhas', ['Evereste', 'Aconcágua', 'Kilimanjaro', 'Elbrus']),
        ],
      },
      {
        id: 'physical',
        label: 'Geografia física',
        contentType: 'place',
        scope: 'world',
        topics: [
          focus('relief', 'Relevo', ['Himalaias', 'Alpes', 'Grand Canyon', 'Rift']),
          focus('climate', 'Clima', ['Sahara', 'Amazónia', 'Antárctida', 'Mediterrâneo']),
          focus('volcanoes', 'Vulcões', ['Etna', 'Vesúvio', 'Fuji', 'Kilauea']),
          focus('glaciers', 'Glaciares', ['Gronelândia', 'Antárctida', 'Patagónia', 'Islândia']),
          focus('deserts', 'Desertos', ['Sahara', 'Gobi', 'Atacama', 'Kalahari']),
          focus('forests', 'Florestas', ['Amazónia', 'Taiga', 'Congo', 'Bornéu']),
        ],
      },
      {
        id: 'human',
        label: 'Geografia humana',
        contentType: 'place',
        scope: 'world',
        topics: [
          focus('population', 'População', ['China', 'Índia', 'Tóquio', 'Lagos']),
          focus('cities', 'Cidades', ['Tóquio', 'Nova Iorque', 'Londres', 'São Paulo']),
          focus('migration', 'Migrações', ['Nova Iorque', 'Alemanha', 'Dubai', 'Califórnia']),
          focus('density', 'Densidade populacional', ['Singapura', 'Mónaco', 'Bangladeche', 'Mongólia']),
          focus('urban', 'Urbanização', ['Tóquio', 'Lagos', 'São Paulo', 'Dubai']),
        ],
      },
      {
        id: 'maps',
        label: 'Mapas e localização',
        contentType: 'place',
        scope: 'world',
        topics: [
          focus('coordinates', 'Coordenadas', ['Equador', 'Greenwich', 'Trópico', 'Meridiano']),
          focus('cardinal', 'Pontos cardeais', ['Pólo Norte', 'Pólo Sul', 'Equador', 'Greenwich']),
          focus('borders', 'Fronteiras', ['Pirenéus', 'Alpes', 'Rio Grande', 'Danúbio']),
          focus('relative', 'Localização relativa', ['Equador', 'Trópico', 'Greenwich', 'Pólo Norte']),
        ],
      },
    ],
  },
  3: {
    topic: 'história',
    suggestions: ['Viriato', 'Roma', 'Egipto', 'Napoleão', 'Descobrimentos'],
    subtopics: [
      { id: 'portugal-hist', label: 'Portugal', contentType: 'person', suggestions: ['Viriato', 'Descobrimentos', 'Napoleão', 'Roma'] },
      { id: 'antiquity', label: 'Antiguidade', contentType: 'event', suggestions: ['Roma', 'Egipto', 'Grécia', 'Viriato'] },
      { id: 'modern', label: 'Época moderna', contentType: 'person', suggestions: ['Napoleão', 'Descobrimentos', 'Viriato'] },
    ],
  },
  4: {
    topic: 'ciência',
    suggestions: ['Newton', 'Curie', 'átomo', 'vacina', 'oxigénio'],
    subtopics: [
      { id: 'scientists', label: 'Cientistas', contentType: 'person', suggestions: ['Newton', 'Curie', 'Einstein', 'Darwin'] },
      { id: 'elements', label: 'Elementos', contentType: 'object', suggestions: ['oxigénio', 'hidrogénio', 'ferro', 'ouro'] },
      { id: 'inventions', label: 'Descobertas', suggestions: ['vacina', 'átomo', 'gravidade', 'DNA'] },
    ],
  },
  5: {
    topic: 'natureza',
    suggestions: ['polvo', 'lobo', 'abelha', 'sobreiro', 'golfinho', 'girafa', 'carvalho'],
    subtopics: [
      { id: 'animals', label: 'Animais', contentType: 'animal', suggestions: ['polvo', 'lobo', 'golfinho', 'girafa'] },
      { id: 'insects', label: 'Insectos', contentType: 'animal', suggestions: ['abelha', 'borboleta', 'formiga', 'joaninha'] },
      { id: 'trees', label: 'Árvores', contentType: 'object', suggestions: ['sobreiro', 'carvalho', 'oliveira', 'pinheiro'] },
    ],
  },
  6: {
    topic: 'espaço',
    suggestions: ['Marte', 'Lua', 'Saturno', 'Júpiter', 'cometa'],
    subtopics: [
      { id: 'planets', label: 'Planetas', contentType: 'place', suggestions: ['Marte', 'Saturno', 'Júpiter', 'Vénus'] },
      { id: 'moons', label: 'Luas', contentType: 'place', suggestions: ['Lua', 'Europa', 'Titã', 'Ganimedes'] },
      { id: 'sky', label: 'Céu', suggestions: ['cometa', 'Sol', 'estrela', 'galáxia'] },
    ],
  },
  7: {
    topic: 'matemática',
    suggestions: ['Pitágoras', 'pi', 'triângulo', 'zero', 'Fibonacci'],
    subtopics: [
      { id: 'numbers', label: 'Números', suggestions: ['zero', 'pi', 'Fibonacci', 'primo'] },
      { id: 'shapes', label: 'Formas', suggestions: ['triângulo', 'círculo', 'quadrado', 'pi'] },
      { id: 'people-math', label: 'Matemáticos', contentType: 'person', suggestions: ['Pitágoras', 'Fibonacci', 'Euclides'] },
    ],
  },
  8: {
    topic: 'literatura',
    suggestions: ['Camões', 'Pessoa', 'Shakespeare', 'Saramago'],
    subtopics: [
      { id: 'pt-authors', label: 'Autores PT', contentType: 'person', suggestions: ['Camões', 'Pessoa', 'Saramago', 'Eça'] },
      { id: 'world-authors', label: 'Autores mundo', contentType: 'person', suggestions: ['Shakespeare', 'Homero', 'Cervantes'] },
    ],
  },
  9: {
    topic: 'português',
    suggestions: ['Camões', 'Pessoa', 'alfabeto', 'provérbio'],
    subtopics: [
      { id: 'language', label: 'Língua', suggestions: ['alfabeto', 'provérbio', 'Camões', 'Pessoa'] },
      { id: 'writers-pt', label: 'Escritores', contentType: 'person', suggestions: ['Camões', 'Pessoa', 'Saramago'] },
    ],
  },
  10: {
    topic: 'arte',
    suggestions: ['Picasso', 'Van Gogh', 'Mona Lisa', 'azulejo'],
    subtopics: [
      { id: 'painters', label: 'Pintores', contentType: 'person', suggestions: ['Picasso', 'Van Gogh', 'Monet'] },
      { id: 'works', label: 'Obras', contentType: 'object', suggestions: ['Mona Lisa', 'azulejo', 'Guernica'] },
    ],
  },
  11: {
    topic: 'cinema',
    suggestions: ['Oscar', 'animação', 'documentário', 'filme'],
    subtopics: [
      { id: 'awards', label: 'Prémios', suggestions: ['Oscar', 'Goya', 'animação'] },
      { id: 'genres', label: 'Géneros', suggestions: ['animação', 'documentário', 'filme'] },
    ],
  },
  12: {
    topic: 'música',
    suggestions: ['fado', 'Amália', 'Mozart', 'piano', 'Beatles'],
    subtopics: [
      { id: 'fado', label: 'Fado', suggestions: ['fado', 'Amália', 'guitarra'] },
      { id: 'classical', label: 'Clássica', contentType: 'person', suggestions: ['Mozart', 'Beethoven', 'piano'] },
      { id: 'pop', label: 'Pop', suggestions: ['Beatles', 'piano', 'Amália'] },
    ],
  },
  13: {
    topic: 'moda',
    suggestions: ['seda', 'algodão', 'barrete', 'traje'],
    subtopics: [
      { id: 'fabrics', label: 'Tecidos', contentType: 'object', suggestions: ['seda', 'algodão', 'lã', 'linho'] },
      { id: 'costume', label: 'Traje', contentType: 'object', suggestions: ['barrete', 'traje', 'seda'] },
    ],
  },
  14: {
    topic: 'gastronomia',
    suggestions: ['bacalhau', 'azeite', 'francesinha', 'nata'],
    subtopics: [
      { id: 'dishes', label: 'Pratos', contentType: 'object', suggestions: ['bacalhau', 'francesinha', 'nata'] },
      { id: 'ingredients', label: 'Ingredientes', contentType: 'object', suggestions: ['azeite', 'bacalhau', 'vinho'] },
    ],
  },
  15: {
    topic: 'desporto',
    suggestions: ['futebol', 'Eusébio', 'natação', 'ténis', 'olimpíadas'],
    subtopics: [
      { id: 'football', label: 'Futebol', suggestions: ['futebol', 'Eusébio', 'olimpíadas'] },
      { id: 'olympic', label: 'Olímpicos', suggestions: ['olimpíadas', 'natação', 'ténis'] },
      { id: 'athletes', label: 'Atletas', contentType: 'person', suggestions: ['Eusébio', 'natação', 'ténis'] },
    ],
  },
  16: {
    topic: 'jogos',
    suggestions: ['xadrez', 'damas', 'monopoly', 'sueca'],
    subtopics: [
      { id: 'board', label: 'Tabuleiro', suggestions: ['xadrez', 'damas', 'monopoly'] },
      { id: 'cards', label: 'Cartas', suggestions: ['sueca', 'póquer', 'monopoly'] },
    ],
  },
  17: {
    topic: 'tecnologia',
    suggestions: ['internet', 'GPS', 'telefone', 'lâmpada', 'robô'],
    subtopics: [
      { id: 'inventions-tech', label: 'Invenções', contentType: 'object', suggestions: ['lâmpada', 'telefone', 'internet'] },
      { id: 'digital', label: 'Digital', suggestions: ['internet', 'GPS', 'robô'] },
    ],
  },
  18: {
    topic: 'culturas',
    suggestions: ['fado', 'Carnaval', 'kimono', 'sari'],
    subtopics: [
      { id: 'festivals', label: 'Festas', suggestions: ['Carnaval', 'fado', 'kimono'] },
      { id: 'costume-world', label: 'Trajes', contentType: 'object', suggestions: ['kimono', 'sari', 'fado'] },
    ],
  },
  19: {
    topic: 'transportes',
    suggestions: ['comboio', 'avião', 'bicicleta', 'navio', 'metro'],
    subtopics: [
      { id: 'land', label: 'Terra', contentType: 'object', suggestions: ['comboio', 'metro', 'bicicleta'] },
      { id: 'air-sea', label: 'Ar e mar', contentType: 'object', suggestions: ['avião', 'navio', 'comboio'] },
    ],
  },
  20: {
    topic: 'curiosidade surpreendente',
    suggestions: ['polvo', 'girafa', 'colibri', 'azulejo', 'fado'],
    presets: [
      { id: 'unescoPt', label: 'Património UNESCO em Portugal' },
      { id: 'ichPt', label: 'Património imaterial PT' },
    ],
    subtopics: [
      { id: 'animals-fun', label: 'Animais', contentType: 'animal', suggestions: ['polvo', 'girafa', 'colibri'] },
      { id: 'heritage', label: 'Património', preset: 'unescoPt', suggestions: ['azulejo', 'fado', 'polvo'] },
      { id: 'culture-fun', label: 'Cultura PT', preset: 'ichPt', suggestions: ['fado', 'azulejo', 'polvo'] },
    ],
  },
};

function cloneFocusList(list, categoryN) {
  return (list || []).map((row) => ({
    id: row.id,
    label: row.label,
    contentType: row.contentType || null,
    preset: row.preset || '',
    suggestions: [...(row.suggestions || [])],
    categoryN,
  }));
}

function cloneSubtopics(row, categoryN) {
  return (row.subtopics || []).map((sub) => ({
    id: sub.id,
    label: sub.label,
    contentType: sub.contentType || null,
    preset: sub.preset || '',
    scope: sub.scope || '',
    suggestions: [...(sub.suggestions || [])],
    topics: cloneFocusList(sub.topics, categoryN),
    categoryN,
  }));
}

function toTopicView(categoryN, row) {
  return {
    categoryN,
    topic: row.topic,
    suggestions: [...row.suggestions],
    presets: Array.isArray(row.presets) ? row.presets.map((p) => ({ ...p, categoryN })) : [],
    subtopics: cloneSubtopics(row, categoryN),
  };
}

function listCategoryTopics() {
  return Object.keys(CATEGORY_TOPICS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((categoryN) => toTopicView(categoryN, CATEGORY_TOPICS[categoryN]));
}

function getCategoryTopic(categoryN) {
  const n = Number(categoryN);
  const row = CATEGORY_TOPICS[n];
  if (!row) return null;
  return toTopicView(n, row);
}

function matchesTopicKey(row, idOrLabel) {
  const key = String(idOrLabel || '').trim().toLowerCase();
  if (!row || !key) return false;
  return row.id === key || String(row.label || '').toLowerCase() === key;
}

function findSubtopic(categoryN, idOrLabel) {
  const topic = getCategoryTopic(categoryN);
  if (!topic) return null;
  return topic.subtopics.find((sub) => matchesTopicKey(sub, idOrLabel)) || null;
}

function findFocus(categoryN, subtopicId, focusId) {
  const sub = findSubtopic(categoryN, subtopicId);
  if (!sub) return null;
  return (sub.topics || []).find((row) => matchesTopicKey(row, focusId)) || null;
}

function suggestionsFor(categoryN, subtopicId, focusId) {
  const focusRow = findFocus(categoryN, subtopicId, focusId);
  if (focusRow?.suggestions?.length) return [...focusRow.suggestions];
  const sub = findSubtopic(categoryN, subtopicId);
  if (sub?.suggestions?.length) return [...sub.suggestions];
  if (sub?.topics?.length) {
    const seen = new Set();
    const out = [];
    for (const row of sub.topics) {
      for (const word of row.suggestions || []) {
        const key = String(word || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(word);
      }
    }
    if (out.length) return out;
  }
  return getCategoryTopic(categoryN)?.suggestions || [];
}

module.exports = {
  CATEGORY_TOPICS,
  listCategoryTopics,
  getCategoryTopic,
  findSubtopic,
  findFocus,
  suggestionsFor,
};
