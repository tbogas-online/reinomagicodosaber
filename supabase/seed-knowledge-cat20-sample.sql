-- Amostra: 5 adivinhas (categoria 20) para testar o Knowledge Repository
-- Executar APÓS knowledge-repository.sql
--
-- Verificar pick (usar topic/formato do seed, não "adivinhas" / RESPOSTA_DIRETA):
--   SELECT pick_knowledge_record(20, '10-15', 'adivinha tradicional', NULL, 'ADIVINHA', '{}', 0.85);
--   SELECT pick_knowledge_record(20, '10-15', 'curiosidade surpreendente', NULL, 'VERDADEIRO_FALSO', '{}', 0.85);
-- Qualquer registo cat. 20:
--   SELECT pick_knowledge_record(20, '10-15', NULL, NULL, NULL, '{}', 0.85);

SELECT public.import_knowledge_batch('[
  {
    "knowledge_id": "knw-cat20-adv-sample-001",
    "category_n": 20,
    "topic": "adivinha tradicional",
    "subtopic": "objectos",
    "fact": "Adivinha tradicional portuguesa: tem dentes mas não morde.",
    "answer": "Pente",
    "clues": ["tem dentes", "não morde", "penteia o cabelo"],
    "source": "sample",
    "source_id": "sample:adivinha:001",
    "confidence": 0.99,
    "priority_pt": 100,
    "age_bands": ["6-9", "10-15", "15+"],
    "allowed_formats": ["ADIVINHA"],
    "tags": ["folclore", "portugal"],
    "verified_at": "2026-09-01",
    "verified_by": "seed-knowledge-cat20-sample"
  },
  {
    "knowledge_id": "knw-cat20-adv-sample-002",
    "category_n": 20,
    "topic": "adivinha tradicional",
    "subtopic": "animais",
    "fact": "Adivinha tradicional: quanto mais alto sobe, mais pequeno fica.",
    "answer": "Chama",
    "clues": ["sobe", "fica mais pequena", "dá luz e calor"],
    "source": "sample",
    "source_id": "sample:adivinha:002",
    "confidence": 0.99,
    "priority_pt": 100,
    "age_bands": ["6-9", "10-15", "15+"],
    "allowed_formats": ["ADIVINHA"],
    "tags": ["folclore"],
    "verified_at": "2026-09-01",
    "verified_by": "seed-knowledge-cat20-sample"
  },
  {
    "knowledge_id": "knw-cat20-adv-sample-003",
    "category_n": 20,
    "topic": "adivinha tradicional",
    "subtopic": "objectos",
    "fact": "Adivinha: entra duro e sai mole.",
    "answer": "Chiclete",
    "clues": ["mastiga-se", "fica elástico", "doce"],
    "source": "sample",
    "source_id": "sample:adivinha:003",
    "confidence": 0.95,
    "priority_pt": 98,
    "age_bands": ["10-15", "15+"],
    "allowed_formats": ["ADIVINHA"],
    "verified_at": "2026-09-01",
    "verified_by": "seed-knowledge-cat20-sample"
  },
  {
    "knowledge_id": "knw-cat20-cur-sample-001",
    "category_n": 20,
    "topic": "curiosidade surpreendente",
    "subtopic": "natureza",
    "fact": "Um polvo tem três corações e sangue azul.",
    "answer": "Verdadeiro",
    "statement": "Um polvo tem três corações. Verdadeiro ou Falso?",
    "is_true": true,
    "source": "sample",
    "source_id": "sample:curiosidade:001",
    "confidence": 0.97,
    "priority_pt": 60,
    "age_bands": ["6-9", "10-15", "15+"],
    "allowed_formats": ["CURIOSIDADE", "VERDADEIRO_FALSO"],
    "verified_at": "2026-09-01",
    "verified_by": "seed-knowledge-cat20-sample"
  },
  {
    "knowledge_id": "knw-cat20-cur-sample-002",
    "category_n": 20,
    "topic": "curiosidade surpreendente",
    "subtopic": "portugal",
    "fact": "Os Jogos Olímpicos de Tóquio de 2020 realizaram-se em 2021 por causa da pandemia.",
    "answer": "Verdadeiro",
    "statement": "Os Jogos Olímpicos de Tóquio de 2020 só se realizaram em 2021. Verdadeiro ou Falso?",
    "is_true": true,
    "source": "sample",
    "source_id": "sample:curiosidade:002",
    "confidence": 0.98,
    "priority_pt": 70,
    "age_bands": ["10-15", "15+"],
    "allowed_formats": ["CURIOSIDADE", "VERDADEIRO_FALSO"],
    "verified_at": "2026-09-01",
    "verified_by": "seed-knowledge-cat20-sample"
  }
]'::jsonb);
