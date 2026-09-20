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

/** Pack de 2–4 palavras: o atalho preenche a pesquisa EntitySearch. */
function shortcut(id, label, words) {
  return { id, label, words };
}

/** Consulta SPARQL curada (não usa palavras). */
function sparqlShortcut(id, label) {
  return { id, label };
}

/** Mistura 4 palavras dos outros atalhos da mesma categoria. */
function randomShortcut(id, label = '🎲 Aleatório') {
  return { id, label, random: true };
}

function isRandomShortcut(preset) {
  return !!(preset && preset.random);
}

function collectShortcutWordPool(presets) {
  const seen = new Set();
  const pool = [];
  for (const preset of presets || []) {
    if (!Array.isArray(preset.words)) continue;
    for (const word of preset.words) {
      const text = String(word || '').trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      pool.push(text);
    }
  }
  return pool;
}

function pickRandomShortcutWords(presets, limit = 4, rng = Math.random) {
  const pool = collectShortcutWordPool(presets);
  const cap = Math.min(4, Math.max(0, Number(limit) || 4), pool.length);
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, cap);
}

const CATEGORY_TOPICS = {
  1: {
    topic: 'conhecimentos gerais',
    suggestions: ['Portugal', 'Europa', 'ONU', 'Nobel', 'olimpíadas'],
    presets: [
      shortcut('cg-mundo', '🌍 Mundo', ['Europa', 'África', 'Ásia', 'América']),
      shortcut('cg-pessoas', '👤 Pessoas Famosas', ['Einstein', 'Mozart', 'Camões', 'Curie']),
      shortcut('cg-datas', '📅 Datas e Acontecimentos', ['Napoleão', 'Descobrimentos', 'Roma', 'ONU']),
      shortcut('cg-invencoes', '💡 Invenções e Descobertas', ['lâmpada', 'telefone', 'internet', 'vacina']),
      shortcut('cg-recordes', '🏆 Recordes', ['Evereste', 'Amazonas', 'Nilo', 'Sahara']),
      shortcut('cg-numeros', '🔢 Números e Estatísticas', ['pi', 'zero', 'Fibonacci', 'milhão']),
      shortcut('cg-cultura', '🎯 Cultura Geral', ['ONU', 'Nobel', 'Oscar', 'olimpíadas']),
      shortcut('cg-curiosidades', '🤯 Curiosidades', ['polvo', 'girafa', 'colibri', 'Evereste']),
      shortcut('cg-portugal', '🇵🇹 Portugal', ['Portugal', 'Lisboa', 'Camões', 'fado']),
      randomShortcut('cg-aleatorio'),
    ],
    subtopics: [
      { id: 'institutions', label: 'Instituições', suggestions: ['ONU', 'UE', 'NATO', 'UNESCO'] },
      { id: 'prizes', label: 'Prémios', suggestions: ['Nobel', 'Pulitzer', 'Oscar', 'olimpíadas'] },
      { id: 'portugal', label: 'Portugal', contentType: 'place', suggestions: ['Portugal', 'Lisboa', 'Europa', 'ONU'] },
    ],
  },
  2: {
    topic: 'geografia',
    suggestions: ['Portugal', 'Lisboa', 'Tejo', 'Alpes', 'Amazonas', 'Sahara', 'Antárctida'],
    presets: [
      sparqlShortcut('countryCapitals', '🏛️ Países e Capitais'),
      shortcut('geo-bandeiras', '🏳️ Países e Bandeiras', ['Portugal', 'Japão', 'Canadá', 'Suíça']),
      shortcut('geo-cidades', '🏙️ Cidades', ['Tóquio', 'Londres', 'Paris', 'Cairo']),
      shortcut('geo-continentes', '🌎 Continentes', ['Europa', 'África', 'Ásia', 'América']),
      shortcut('geo-rios-mares', '🌊 Rios, Mares e Oceanos', ['Amazonas', 'Nilo', 'Atlântico', 'Mediterrâneo']),
      shortcut('geo-montanhas', '⛰️ Montanhas e Relevo', ['Alpes', 'Himalaias', 'Evereste', 'Estrela']),
      shortcut('geo-ilhas', '🏝️ Ilhas', ['Madeira', 'Islândia', 'Madagascar', 'Sicília']),
      shortcut('geo-mapa', '🗺️ Localização no Mapa', ['Equador', 'Greenwich', 'Trópico', 'Meridiano']),
      shortcut('geo-portugal', '🇵🇹 Geografia de Portugal', ['Lisboa', 'Tejo', 'Douro', 'Algarve']),
      randomShortcut('geo-aleatorio'),
    ],
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
    presets: [
      shortcut('hist-antigas', '🏛️ Civilizações Antigas', ['Roma', 'Egipto', 'Grécia', 'Mesopotâmia']),
      shortcut('hist-reis', '👑 Reis e Governantes', ['Napoleão', 'César', 'Cleópatra', 'Afonso']),
      shortcut('hist-guerras', '⚔️ Guerras e Batalhas', ['Waterloo', 'Aljubarrota', 'Troia', 'Napoleão']),
      shortcut('hist-descobrimentos', '🗺️ Descobrimentos', ['Descobrimentos', 'Gama', 'Magalhães', 'Índia']),
      shortcut('hist-portugal', '🇵🇹 História de Portugal', ['Viriato', 'Descobrimentos', 'Aljubarrota', 'Lisboa']),
      shortcut('hist-revolucoes', '🔥 Revoluções', ['Bastilha', 'França', 'Rússia', 'Liberalismo']),
      shortcut('hist-datas', '📅 Datas Históricas', ['Restauração', 'Abril', '1143', '1492']),
      shortcut('hist-figuras', '👤 Figuras Históricas', ['Viriato', 'Napoleão', 'César', 'Camões']),
      shortcut('hist-mundial', '🌎 História Mundial', ['Roma', 'Egipto', 'Napoleão', 'China']),
      randomShortcut('hist-aleatorio'),
    ],
    subtopics: [
      { id: 'portugal-hist', label: 'Portugal', contentType: 'person', suggestions: ['Viriato', 'Descobrimentos', 'Napoleão', 'Roma'] },
      { id: 'antiquity', label: 'Antiguidade', contentType: 'event', suggestions: ['Roma', 'Egipto', 'Grécia', 'Viriato'] },
      { id: 'modern', label: 'Época moderna', contentType: 'person', suggestions: ['Napoleão', 'Descobrimentos', 'Viriato'] },
    ],
  },
  4: {
    topic: 'ciência',
    suggestions: ['Newton', 'Curie', 'átomo', 'vacina', 'oxigénio'],
    presets: [
      shortcut('sci-biologia', '🧬 Biologia', ['célula', 'DNA', 'Darwin', 'fotossíntese']),
      shortcut('sci-fisica', '⚛️ Física', ['Newton', 'gravidade', 'Einstein', 'átomo']),
      shortcut('sci-quimica', '🧪 Química', ['oxigénio', 'hidrogénio', 'ferro', 'ouro']),
      shortcut('sci-corpo', '🧍 Corpo Humano', ['coração', 'cérebro', 'pulmão', 'sangue']),
      shortcut('sci-astronomia', '🔭 Astronomia', ['Marte', 'Lua', 'Saturno', 'cometa']),
      shortcut('sci-terra', '🌡️ Ciência da Terra', ['vulcão', 'terramoto', 'clima', 'placa']),
      shortcut('sci-descobertas', '💡 Descobertas Científicas', ['vacina', 'átomo', 'gravidade', 'penicilina']),
      shortcut('sci-cientistas', '🔬 Cientistas', ['Newton', 'Curie', 'Einstein', 'Darwin']),
      shortcut('sci-diaadia', '🧠 Ciência no Dia a Dia', ['electricidade', 'íman', 'vacina', 'termómetro']),
      randomShortcut('sci-aleatorio'),
    ],
    subtopics: [
      { id: 'scientists', label: 'Cientistas', contentType: 'person', suggestions: ['Newton', 'Curie', 'Einstein', 'Darwin'] },
      { id: 'elements', label: 'Elementos', contentType: 'object', suggestions: ['oxigénio', 'hidrogénio', 'ferro', 'ouro'] },
      { id: 'inventions', label: 'Descobertas', suggestions: ['vacina', 'átomo', 'gravidade', 'DNA'] },
    ],
  },
  5: {
    topic: 'natureza',
    suggestions: ['polvo', 'lobo', 'abelha', 'sobreiro', 'golfinho', 'girafa', 'carvalho'],
    presets: [
      shortcut('nat-animais', '🐾 Animais', ['polvo', 'lobo', 'golfinho', 'girafa']),
      shortcut('nat-plantas', '🌱 Plantas', ['sobreiro', 'oliveira', 'carvalho', 'pinheiro']),
      shortcut('nat-florestas', '🌳 Florestas', ['Amazónia', 'Taiga', 'Congo', 'Bornéu']),
      shortcut('nat-oceanos', '🌊 Oceanos e Mares', ['Atlântico', 'Pacífico', 'Mediterrâneo', 'Índico']),
      shortcut('nat-desertos', '🏜️ Desertos', ['Sahara', 'Gobi', 'Atacama', 'Kalahari']),
      shortcut('nat-ecosistemas', '🏔️ Ecossistemas', ['Amazónia', 'recife', 'tundra', 'savana']),
      shortcut('nat-insectos', '🦋 Insectos', ['abelha', 'borboleta', 'formiga', 'joaninha']),
      shortcut('nat-clima', '🌦️ Clima', ['chuva', 'vento', 'ciclone', 'monção']),
      shortcut('nat-ambiente', '♻️ Ambiente', ['reciclagem', 'ozono', 'carbono', 'Amazónia']),
      randomShortcut('nat-aleatorio'),
    ],
    subtopics: [
      { id: 'animals', label: 'Animais', contentType: 'animal', suggestions: ['polvo', 'lobo', 'golfinho', 'girafa'] },
      { id: 'insects', label: 'Insectos', contentType: 'animal', suggestions: ['abelha', 'borboleta', 'formiga', 'joaninha'] },
      { id: 'trees', label: 'Árvores', contentType: 'object', suggestions: ['sobreiro', 'carvalho', 'oliveira', 'pinheiro'] },
    ],
  },
  6: {
    topic: 'espaço',
    suggestions: ['Marte', 'Lua', 'Saturno', 'Júpiter', 'cometa'],
    presets: [
      shortcut('esp-sistema', '☀️ Sistema Solar', ['Sol', 'Marte', 'Júpiter', 'Saturno']),
      shortcut('esp-planetas', '🪐 Planetas', ['Marte', 'Saturno', 'Júpiter', 'Vénus']),
      shortcut('esp-lua', '🌙 Lua', ['Lua', 'eclipse', 'Apollo', 'maré']),
      shortcut('esp-estrelas', '⭐ Estrelas', ['Sol', 'Sirius', 'Polar', 'supernova']),
      shortcut('esp-galaxias', '🌌 Galáxias', ['Via Láctea', 'Andrómeda', 'galáxia', 'Hubble']),
      shortcut('esp-exploracao', '🚀 Exploração Espacial', ['Apollo', 'Voyager', 'NASA', 'Sputnik']),
      shortcut('esp-astronautas', '👨‍🚀 Astronautas', ['Armstrong', 'Gagarin', 'Aldrin', 'Shepard']),
      shortcut('esp-satelites', '🛰️ Satélites', ['Hubble', 'GPS', 'Lua', 'Sputnik']),
      shortcut('esp-universo', '🔭 Universo', ['Big Bang', 'galáxia', 'buraco negro', 'Via Láctea']),
      randomShortcut('esp-aleatorio'),
    ],
    subtopics: [
      { id: 'planets', label: 'Planetas', contentType: 'place', suggestions: ['Marte', 'Saturno', 'Júpiter', 'Vénus'] },
      { id: 'moons', label: 'Luas', contentType: 'place', suggestions: ['Lua', 'Europa', 'Titã', 'Ganimedes'] },
      { id: 'sky', label: 'Céu', suggestions: ['cometa', 'Sol', 'estrela', 'galáxia'] },
    ],
  },
  7: {
    topic: 'matemática',
    suggestions: ['Pitágoras', 'pi', 'triângulo', 'zero', 'Fibonacci'],
    presets: [
      shortcut('mat-numeros', '🔢 Números', ['zero', 'pi', 'primo', 'Fibonacci']),
      shortcut('mat-calculo', '➕ Cálculo Mental', ['soma', 'produto', 'percentagem', 'média']),
      shortcut('mat-operacoes', '✖️ Operações', ['adição', 'subtracção', 'multiplicação', 'divisão']),
      shortcut('mat-geometria', '📐 Geometria', ['triângulo', 'círculo', 'quadrado', 'pi']),
      shortcut('mat-medidas', '📏 Medidas', ['metro', 'litro', 'quilograma', 'segundo']),
      shortcut('mat-padroes', '🧩 Padrões e Sequências', ['Fibonacci', 'primo', 'sequência', 'padrão']),
      shortcut('mat-logica', '🧠 Raciocínio Lógico', ['Euclides', 'Pitágoras', 'conjunto', 'silogismo']),
      shortcut('mat-problemas', '🎯 Problemas', ['Pitágoras', 'Euclides', 'percentagem', 'média']),
      shortcut('mat-probabilidade', '🎲 Probabilidade', ['dado', 'probabilidade', 'média', 'percentagem']),
      randomShortcut('mat-aleatorio'),
    ],
    subtopics: [
      { id: 'numbers', label: 'Números', suggestions: ['zero', 'pi', 'Fibonacci', 'primo'] },
      { id: 'shapes', label: 'Formas', suggestions: ['triângulo', 'círculo', 'quadrado', 'pi'] },
      { id: 'people-math', label: 'Matemáticos', contentType: 'person', suggestions: ['Pitágoras', 'Fibonacci', 'Euclides'] },
    ],
  },
  8: {
    topic: 'literatura',
    suggestions: ['Camões', 'Pessoa', 'Shakespeare', 'Saramago'],
    presets: [
      shortcut('lit-autores', '✍️ Autores', ['Camões', 'Pessoa', 'Shakespeare', 'Saramago']),
      shortcut('lit-livros', '📚 Livros', ['Lusíadas', 'Hamlet', 'Quixote', 'Mensagem']),
      shortcut('lit-personagens', '👤 Personagens', ['Hamlet', 'Quixote', 'Ulisses', 'Sherlock']),
      shortcut('lit-pt', '🇵🇹 Literatura Portuguesa', ['Camões', 'Pessoa', 'Saramago', 'Eça']),
      shortcut('lit-mundo', '🌎 Literatura Mundial', ['Shakespeare', 'Homero', 'Cervantes', 'Tolstói']),
      shortcut('lit-poesia', '📝 Poesia', ['Camões', 'Pessoa', 'Homero', 'soneto']),
      shortcut('lit-contos', '🧚 Contos e Fábulas', ['Esopo', 'Grimm', 'Andersen', 'fábula']),
      shortcut('lit-classicos', '🏛️ Clássicos', ['Homero', 'Shakespeare', 'Camões', 'Cervantes']),
      shortcut('lit-obras', '🏆 Obras Famosas', ['Lusíadas', 'Hamlet', 'Quixote', 'Odisseia']),
      randomShortcut('lit-aleatorio'),
    ],
    subtopics: [
      { id: 'pt-authors', label: 'Autores PT', contentType: 'person', suggestions: ['Camões', 'Pessoa', 'Saramago', 'Eça'] },
      { id: 'world-authors', label: 'Autores mundo', contentType: 'person', suggestions: ['Shakespeare', 'Homero', 'Cervantes'] },
    ],
  },
  9: {
    topic: 'português',
    suggestions: ['Camões', 'Pessoa', 'alfabeto', 'provérbio'],
    presets: [
      shortcut('pt-vocabulario', '📖 Vocabulário', ['alfabeto', 'dicionário', 'vocabulário', 'palavra']),
      shortcut('pt-ortografia', '🔤 Ortografia', ['acento', 'cedilha', 'hífen', 'alfabeto']),
      shortcut('pt-gramatica', '📝 Gramática', ['verbo', 'substantivo', 'adjectivo', 'sujeito']),
      shortcut('pt-sinonimos', '🔄 Sinónimos', ['sinónimo', 'dicionário', 'vocabulário', 'Camões']),
      shortcut('pt-antonimos', '↔️ Antónimos', ['antónimo', 'dicionário', 'vocabulário', 'alfabeto']),
      shortcut('pt-expressoes', '💬 Expressões', ['provérbio', 'ditado', 'expressão', 'idioma']),
      shortcut('pt-proverbios', '🗣️ Provérbios', ['provérbio', 'ditado', 'sabedoria', 'Camões']),
      shortcut('pt-significado', '🔎 Significado de Palavras', ['dicionário', 'vocabulário', 'etimologia', 'palavra']),
      shortcut('pt-portugal', '🇵🇹 Português de Portugal', ['Camões', 'Pessoa', 'Lisboa', 'alfabeto']),
      randomShortcut('pt-aleatorio'),
    ],
    subtopics: [
      { id: 'language', label: 'Língua', suggestions: ['alfabeto', 'provérbio', 'Camões', 'Pessoa'] },
      { id: 'writers-pt', label: 'Escritores', contentType: 'person', suggestions: ['Camões', 'Pessoa', 'Saramago'] },
    ],
  },
  10: {
    topic: 'arte',
    suggestions: ['Picasso', 'Van Gogh', 'Mona Lisa', 'azulejo'],
    presets: [
      shortcut('arte-pintura', '🖼️ Pintura', ['Picasso', 'Van Gogh', 'Monet', 'Vinci']),
      shortcut('arte-escultura', '🗿 Escultura', ['Miguel Ângelo', 'David', 'Rodin', 'mármore']),
      shortcut('arte-arquitetura', '🏛️ Arquitetura', ['Coliseu', 'pirâmide', 'Gótico', 'Sagrada Família']),
      shortcut('arte-teatro', '🎭 Teatro', ['Shakespeare', 'Vicente', 'ópera', 'palco']),
      shortcut('arte-artistas', '👨‍🎨 Artistas', ['Picasso', 'Van Gogh', 'Miguel Ângelo', 'Amadeo']),
      shortcut('arte-obras', '🖼️ Obras Famosas', ['Mona Lisa', 'Guernica', 'David', 'azulejo']),
      shortcut('arte-antiga', '🏺 Arte Antiga', ['Egipto', 'Grécia', 'Roma', 'pirâmide']),
      shortcut('arte-movimentos', '🎨 Movimentos Artísticos', ['Impressionismo', 'Cubismo', 'Barroco', 'Renascimento']),
      shortcut('arte-pt', '🇵🇹 Arte Portuguesa', ['azulejo', 'Amadeo', 'Bordalo', 'Nasoni']),
      randomShortcut('arte-aleatorio'),
    ],
    subtopics: [
      { id: 'painters', label: 'Pintores', contentType: 'person', suggestions: ['Picasso', 'Van Gogh', 'Monet'] },
      { id: 'works', label: 'Obras', contentType: 'object', suggestions: ['Mona Lisa', 'azulejo', 'Guernica'] },
    ],
  },
  11: {
    topic: 'cinema',
    suggestions: ['Oscar', 'animação', 'documentário', 'filme'],
    presets: [
      shortcut('cin-filmes', '🎬 Filmes', ['Spielberg', 'Pixar', 'Star Wars', 'Titanic']),
      shortcut('cin-series', '📺 Séries', ['Friends', 'Lost', 'série', 'Netflix']),
      shortcut('cin-atores', '👤 Atores e Atrizes', ['Chaplin', 'Hepburn', 'Streep', 'Pacino']),
      shortcut('cin-realizadores', '🎥 Realizadores', ['Spielberg', 'Hitchcock', 'Scorsese', 'Nolan']),
      shortcut('cin-personagens', '🦸 Personagens', ['Batman', 'Harry Potter', 'Shrek', 'Yoda']),
      shortcut('cin-premios', '🏆 Prémios', ['Oscar', 'Goya', 'César', 'BAFTA']),
      shortcut('cin-bandas', '🎵 Bandas Sonoras', ['Williams', 'Zimmer', 'musical', 'Oscar']),
      shortcut('cin-franchises', '🧙 Franchises', ['Star Wars', 'Marvel', 'Harry Potter', 'Bond']),
      shortcut('cin-pt', '🇵🇹 Cinema Português', ['Oliveira', 'Lopes', 'filme', 'Cannes']),
      randomShortcut('cin-aleatorio'),
    ],
    subtopics: [
      { id: 'awards', label: 'Prémios', suggestions: ['Oscar', 'Goya', 'animação'] },
      { id: 'genres', label: 'Géneros', suggestions: ['animação', 'documentário', 'filme'] },
    ],
  },
  12: {
    topic: 'música',
    suggestions: ['fado', 'Amália', 'Mozart', 'piano', 'Beatles'],
    presets: [
      shortcut('mus-artistas', '🎤 Artistas', ['Amália', 'Beatles', 'Mozart', 'Madonna']),
      shortcut('mus-bandas', '🎸 Bandas', ['Beatles', 'Queen', 'U2', 'ABBA']),
      shortcut('mus-cancoes', '🎵 Canções', ['Beatles', 'Amália', 'fado', 'hino']),
      shortcut('mus-albuns', '💿 Álbuns', ['Beatles', 'Thriller', 'Queen', 'Amália']),
      shortcut('mus-generos', '🎼 Géneros Musicais', ['fado', 'jazz', 'ópera', 'rock']),
      shortcut('mus-instrumentos', '🎸 Instrumentos', ['piano', 'guitarra', 'violino', 'flauta']),
      shortcut('mus-decadas', '📅 Música por Décadas', ['Beatles', 'disco', 'jazz', 'rock']),
      shortcut('mus-premios', '🏆 Prémios', ['Grammy', 'Eurovisão', 'Nobel', 'Oscar']),
      shortcut('mus-pt', '🇵🇹 Música Portuguesa', ['fado', 'Amália', 'Zeca', 'Carlos']),
      randomShortcut('mus-aleatorio'),
    ],
    subtopics: [
      { id: 'fado', label: 'Fado', suggestions: ['fado', 'Amália', 'guitarra'] },
      { id: 'classical', label: 'Clássica', contentType: 'person', suggestions: ['Mozart', 'Beethoven', 'piano'] },
      { id: 'pop', label: 'Pop', suggestions: ['Beatles', 'piano', 'Amália'] },
    ],
  },
  13: {
    topic: 'moda',
    suggestions: ['seda', 'algodão', 'barrete', 'traje'],
    presets: [
      shortcut('moda-designers', '👗 Designers', ['Chanel', 'Dior', 'Gucci', 'Armani']),
      shortcut('moda-marcas', '👠 Marcas', ['Nike', 'Adidas', 'Zara', 'Gucci']),
      shortcut('moda-pecas', '🧥 Peças de Roupa', ['camisola', 'casaco', 'vestido', 'calças']),
      shortcut('moda-calcado', '👟 Calçado', ['sapatilha', 'bota', 'sandália', 'Nike']),
      shortcut('moda-acessorios', '💎 Acessórios', ['relógio', 'chapéu', 'lenço', 'cinto']),
      shortcut('moda-decadas', '📅 Moda por Décadas', ['Chanel', 'Dior', 'minissaia', 'Twiggy']),
      shortcut('moda-mundo', '🌎 Moda pelo Mundo', ['kimono', 'sari', 'kilt', 'traje']),
      shortcut('moda-icones', '⭐ Ícones da Moda', ['Chanel', 'Hepburn', 'Twiggy', 'Dior']),
      shortcut('moda-pt', '🇵🇹 Moda Portuguesa', ['traje', 'barrete', 'Lisboa', 'algodão']),
      randomShortcut('moda-aleatorio'),
    ],
    subtopics: [
      { id: 'fabrics', label: 'Tecidos', contentType: 'object', suggestions: ['seda', 'algodão', 'lã', 'linho'] },
      { id: 'costume', label: 'Traje', contentType: 'object', suggestions: ['barrete', 'traje', 'seda'] },
    ],
  },
  14: {
    topic: 'gastronomia',
    suggestions: ['bacalhau', 'azeite', 'francesinha', 'nata'],
    presets: [
      shortcut('gastro-pt', '🇵🇹 Comida Portuguesa', ['bacalhau', 'francesinha', 'nata', 'azeite']),
      shortcut('gastro-mundo', '🌎 Cozinhas do Mundo', ['pizza', 'sushi', 'taco', 'curry']),
      shortcut('gastro-pratos', '🍲 Pratos Típicos', ['paella', 'pizza', 'sushi', 'bacalhau']),
      shortcut('gastro-ingredientes', '🥕 Ingredientes', ['azeite', 'alho', 'tomate', 'sal']),
      shortcut('gastro-frutas', '🍎 Frutas e Vegetais', ['maçã', 'laranja', 'tomate', 'banana']),
      shortcut('gastro-doces', '🍰 Doces e Sobremesas', ['nata', 'chocolate', 'bolo', 'gelado']),
      shortcut('gastro-queijos', '🧀 Queijos', ['queijo', 'serra', 'roquefort', 'mozzarella']),
      shortcut('gastro-especiarias', '🌶️ Sabores e Especiarias', ['pimenta', 'canela', 'açafrão', 'alho']),
      shortcut('gastro-regional', '🗺️ Gastronomia Regional', ['Alentejo', 'Algarve', 'Minho', 'francesinha']),
      randomShortcut('gastro-aleatorio'),
    ],
    subtopics: [
      { id: 'dishes', label: 'Pratos', contentType: 'object', suggestions: ['bacalhau', 'francesinha', 'nata'] },
      { id: 'ingredients', label: 'Ingredientes', contentType: 'object', suggestions: ['azeite', 'bacalhau', 'vinho'] },
    ],
  },
  15: {
    topic: 'desporto',
    suggestions: ['futebol', 'Eusébio', 'natação', 'ténis', 'olimpíadas'],
    presets: [
      shortcut('desp-futebol', '⚽ Futebol', ['futebol', 'Eusébio', 'Ronaldo', 'Mundial']),
      shortcut('desp-basquete', '🏀 Basquetebol', ['basquetebol', 'NBA', 'Jordan', 'cesto']),
      shortcut('desp-tenis', '🎾 Ténis', ['ténis', 'Wimbledon', 'Nadal', 'Federer']),
      shortcut('desp-atletismo', '🏃 Atletismo', ['atletismo', 'maratona', 'Bolt', 'olimpíadas']),
      shortcut('desp-ciclismo', '🚴 Ciclismo', ['ciclismo', 'Tour', 'Volta', 'bicicleta']),
      shortcut('desp-auto', '🏎️ Automobilismo', ['Senna', 'Ferrari', 'rally', 'Fórmula']),
      shortcut('desp-natacao', '🏊 Natação', ['natação', 'Phelps', 'olimpíadas', 'mariposa']),
      shortcut('desp-olimpicos', '🥇 Jogos Olímpicos', ['olimpíadas', 'atleta', 'medalha', 'natação']),
      shortcut('desp-pt', '🇵🇹 Desporto Português', ['Eusébio', 'Ronaldo', 'Benfica', 'Porto']),
      shortcut('desp-modalidades', '🏅 Modalidades', ['andebol', 'voleibol', 'rugby', 'hóquei']),
      randomShortcut('desp-aleatorio'),
    ],
    subtopics: [
      { id: 'football', label: 'Futebol', suggestions: ['futebol', 'Eusébio', 'olimpíadas'] },
      { id: 'olympic', label: 'Olímpicos', suggestions: ['olimpíadas', 'natação', 'ténis'] },
      { id: 'athletes', label: 'Atletas', contentType: 'person', suggestions: ['Eusébio', 'natação', 'ténis'] },
    ],
  },
  16: {
    topic: 'jogos',
    suggestions: ['xadrez', 'damas', 'monopoly', 'sueca'],
    presets: [
      shortcut('jogos-video', '🎮 Videojogos', ['Mario', 'Zelda', 'Minecraft', 'Fortnite']),
      shortcut('jogos-consolas', '🕹️ Consolas', ['PlayStation', 'Nintendo', 'Xbox', 'Sega']),
      shortcut('jogos-personagens', '👾 Personagens', ['Mario', 'Zelda', 'Pikachu', 'Sonic']),
      shortcut('jogos-tabuleiro', '🧩 Jogos de Tabuleiro', ['xadrez', 'damas', 'monopoly', 'ludo']),
      shortcut('jogos-cartas', '🃏 Jogos de Cartas', ['sueca', 'póquer', 'uno', 'bridge']),
      shortcut('jogos-tradicionais', '🎲 Jogos Tradicionais', ['malha', 'pião', 'sueca', 'xadrez']),
      shortcut('jogos-minecraft', '⛏️ Minecraft', ['Minecraft', 'bloco', 'Creeper', 'Steve']),
      shortcut('jogos-nintendo', '🍄 Nintendo', ['Nintendo', 'Mario', 'Zelda', 'Switch']),
      shortcut('jogos-famosos', '🏆 Jogos Famosos', ['xadrez', 'Mario', 'Tetris', 'monopoly']),
      randomShortcut('jogos-aleatorio'),
    ],
    subtopics: [
      { id: 'board', label: 'Tabuleiro', suggestions: ['xadrez', 'damas', 'monopoly'] },
      { id: 'cards', label: 'Cartas', suggestions: ['sueca', 'póquer', 'monopoly'] },
    ],
  },
  17: {
    topic: 'tecnologia',
    suggestions: ['internet', 'GPS', 'telefone', 'lâmpada', 'robô'],
    presets: [
      shortcut('tec-computadores', '🖥️ Computadores', ['computador', 'Windows', 'Linux', 'teclado']),
      shortcut('tec-telemoveis', '📱 Telemóveis', ['telemóvel', 'iPhone', 'Android', 'Samsung']),
      shortcut('tec-internet', '🌐 Internet', ['internet', 'Google', 'WWW', 'email']),
      shortcut('tec-ia', '🤖 Inteligência Artificial', ['Turing', 'robô', 'algoritmo', 'rede']),
      shortcut('tec-jogos', '🎮 Tecnologia nos Jogos', ['PlayStation', 'Nintendo', 'consola', 'realidade']),
      shortcut('tec-seguranca', '🔐 Segurança Digital', ['vírus', 'firewall', 'encriptação', 'palavra-passe']),
      shortcut('tec-invencoes', '💡 Invenções', ['lâmpada', 'telefone', 'internet', 'GPS']),
      shortcut('tec-programacao', '👨‍💻 Programação', ['Python', 'Java', 'algoritmo', 'Turing']),
      shortcut('tec-empresas', '🏢 Empresas Tecnológicas', ['Google', 'Apple', 'Microsoft', 'Nokia']),
      randomShortcut('tec-aleatorio'),
    ],
    subtopics: [
      { id: 'inventions-tech', label: 'Invenções', contentType: 'object', suggestions: ['lâmpada', 'telefone', 'internet'] },
      { id: 'digital', label: 'Digital', suggestions: ['internet', 'GPS', 'robô'] },
    ],
  },
  18: {
    topic: 'culturas',
    suggestions: ['fado', 'Carnaval', 'kimono', 'sari'],
    presets: [
      shortcut('cult-linguas', '🗣️ Línguas', ['português', 'inglês', 'mandarim', 'árabe']),
      shortcut('cult-gastro', '🍽️ Gastronomia', ['sushi', 'pizza', 'bacalhau', 'curry']),
      shortcut('cult-festas', '🎉 Festas e Celebrações', ['Carnaval', 'Natal', 'Diwali', 'Ramadão']),
      shortcut('cult-vestuario', '👘 Vestuário e Moda', ['kimono', 'sari', 'kilt', 'traje']),
      shortcut('cult-tradicoes', '🏛️ Tradições', ['fado', 'Fátima', 'romaria', 'São João']),
      shortcut('cult-musica', '🎵 Música e Dança', ['fado', 'samba', 'flamenco', 'ballet']),
      shortcut('cult-costumes', '🏠 Costumes', ['chá', 'sesta', 'sauna', 'saudações']),
      shortcut('cult-religioes', '🛕 Religiões e Monumentos', ['Vaticano', 'Meca', 'templo', 'mesquita']),
      shortcut('cult-povos', '🌍 Países e Povos', ['Japão', 'Índia', 'Brasil', 'Egipto']),
      randomShortcut('cult-aleatorio'),
    ],
    subtopics: [
      { id: 'festivals', label: 'Festas', suggestions: ['Carnaval', 'fado', 'kimono'] },
      { id: 'costume-world', label: 'Trajes', contentType: 'object', suggestions: ['kimono', 'sari', 'fado'] },
    ],
  },
  19: {
    topic: 'transportes',
    suggestions: ['comboio', 'avião', 'bicicleta', 'navio', 'metro'],
    presets: [
      shortcut('trans-auto', '🚗 Automóveis', ['automóvel', 'Ford', 'Ferrari', 'motor']),
      shortcut('trans-comboios', '🚆 Comboios', ['comboio', 'TGV', 'metro', 'locomotiva']),
      shortcut('trans-avioes', '✈️ Aviões', ['avião', 'Boeing', 'Concorde', 'piloto']),
      shortcut('trans-navios', '🚢 Navios', ['navio', 'Titanic', 'caravela', 'porto']),
      shortcut('trans-publicos', '🚌 Transportes Públicos', ['autocarro', 'metro', 'eléctrico', 'comboio']),
      shortcut('trans-bicicletas', '🚲 Bicicletas', ['bicicleta', 'Tour', 'pedais', 'velocípede']),
      shortcut('trans-motas', '🏍️ Motas', ['mota', 'Honda', 'Harley', 'scooter']),
      shortcut('trans-espaco', '🚀 Transportes Espaciais', ['foguetão', 'Apollo', 'Voyager', 'Sputnik']),
      shortcut('trans-historicos', '🏁 Transportes Históricos', ['caravela', 'diligência', 'locomotiva', 'galeão']),
      randomShortcut('trans-aleatorio'),
    ],
    subtopics: [
      { id: 'land', label: 'Terra', contentType: 'object', suggestions: ['comboio', 'metro', 'bicicleta'] },
      { id: 'air-sea', label: 'Ar e mar', contentType: 'object', suggestions: ['avião', 'navio', 'comboio'] },
    ],
  },
  20: {
    topic: 'curiosidade surpreendente',
    suggestions: ['polvo', 'girafa', 'colibri', 'azulejo', 'fado'],
    presets: [
      sparqlShortcut('unescoPt', 'Património UNESCO em Portugal'),
      sparqlShortcut('ichPt', 'Património imaterial PT'),
      shortcut('cur-animais', 'Animais curiosos', ['polvo', 'girafa', 'colibri', 'lobo']),
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
    presets: Array.isArray(row.presets) ? row.presets.map((p) => ({
      ...p,
      categoryN,
      words: Array.isArray(p.words) ? [...p.words] : undefined,
    })) : [],
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
  isRandomShortcut,
  collectShortcutWordPool,
  pickRandomShortcutWords,
};
