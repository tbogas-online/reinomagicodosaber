-- Importar perguntas do histórico (game_history) para o banco reutilizável (question_bank)
-- Executar no SQL Editor do Supabase APÓS schema.sql e question-bank.sql
--
-- Histórico local (localStorage deste browser):
--   Definições → Inteligência Artificial → «Importar histórico local → banco»
--   ou na consola: QuestionBank.importFromLocalStorage()
--
-- Copia cada pergunta única (hash q|a igual ao cliente) e ignora:
--   - hashes já no banco
--   - hashes bloqueados por reporte
--   - linhas sem faixa etária válida ou categoria desconhecida

-- Ajustar limite de categorias (o jogo tem 20; question-bank.sql original limitava a 12)
ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_category_n_check;

ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_category_n_check
  CHECK (category_n BETWEEN 1 AND 20);

-- ---------------------------------------------------------------------------
-- Helpers (mesmo algoritmo que hashQuestionKey + stripTags no index.html)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reino_strip_tags(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(COALESCE(p_text, ''), '<[^>]*>', '', 'gi'));
$$;

CREATE OR REPLACE FUNCTION public.reino_uint32_to_base36(n BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits CONSTANT TEXT := '0123456789abcdefghijklmnopqrstuvwxyz';
  n2 BIGINT := n & 4294967295;
  result TEXT := '';
  r INT;
BEGIN
  IF n2 = 0 THEN
    RETURN '0';
  END IF;
  WHILE n2 > 0 LOOP
    r := (n2 % 36)::INT;
    result := substr(digits, r + 1, 1) || result;
    n2 := n2 / 36;
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reino_question_hash(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s TEXT := COALESCE(p_text, '');
  h BIGINT := 2166136261;
  i INT;
  ch INT;
BEGIN
  FOR i IN 1..length(s) LOOP
    ch := ascii(substr(s, i, 1));
    h := (h # ch) & 4294967295;
    h := (h * 16777619) & 4294967295;
  END LOOP;
  RETURN public.reino_uint32_to_base36(h);
END;
$$;

CREATE OR REPLACE FUNCTION public.reino_category_name_to_n(p_name TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE trim(COALESCE(p_name, ''))
    WHEN 'Conhecimentos Gerais' THEN 1
    WHEN 'Geografia' THEN 2
    WHEN 'História' THEN 3
    WHEN 'Ciência' THEN 4
    WHEN 'Natureza' THEN 5
    WHEN 'Espaço' THEN 6
    WHEN 'Matemática e Lógica' THEN 7
    WHEN 'Literatura' THEN 8
    WHEN 'Português' THEN 9
    WHEN 'Arte' THEN 10
    WHEN 'Cinema e Séries' THEN 11
    WHEN 'Música' THEN 12
    WHEN 'Moda' THEN 13
    WHEN 'Gastronomia' THEN 14
    WHEN 'Desporto' THEN 15
    WHEN 'Jogos' THEN 16
    WHEN 'Tecnologia' THEN 17
    WHEN 'Culturas do Mundo' THEN 18
    WHEN 'Transportes' THEN 19
    WHEN 'Adivinhas e Curiosidades' THEN 20
    ELSE NULL
  END;
$$;

-- ---------------------------------------------------------------------------
-- Pré-visualização (opcional — comentar o INSERT abaixo se só quiseres ver)
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) AS perguntas_unicas_importaveis
-- FROM (
--   SELECT DISTINCT ON (
--     public.reino_question_hash(
--       public.reino_strip_tags(gh.question) || '|' || public.reino_strip_tags(gh.correct_answer)
--     )
--   )
--     public.reino_question_hash(
--       public.reino_strip_tags(gh.question) || '|' || public.reino_strip_tags(gh.correct_answer)
--     ) AS question_hash
--   FROM public.game_history gh
--   WHERE gh.age_band IN ('6-9', '10-15', '15+')
--     AND public.reino_category_name_to_n(gh.category) IS NOT NULL
--     AND length(trim(gh.question)) > 0
--     AND length(trim(gh.correct_answer)) > 0
--   ORDER BY
--     public.reino_question_hash(
--       public.reino_strip_tags(gh.question) || '|' || public.reino_strip_tags(gh.correct_answer)
--     ),
--     gh.created_at DESC
-- ) preview
-- WHERE NOT EXISTS (
--   SELECT 1 FROM public.question_bank qb WHERE qb.question_hash = preview.question_hash
-- )
-- AND NOT EXISTS (
--   SELECT 1 FROM public.question_bank_blocked b WHERE b.question_hash = preview.question_hash
-- );

-- ---------------------------------------------------------------------------
-- Importação
-- ---------------------------------------------------------------------------
INSERT INTO public.question_bank (
  category_n,
  age_band,
  question,
  correct_answer,
  options,
  format,
  question_hash,
  source,
  created_at
)
SELECT
  src.category_n,
  src.age_band,
  src.question,
  src.correct_answer,
  src.options,
  src.format,
  src.question_hash,
  'history',
  src.created_at
FROM (
  SELECT DISTINCT ON (h.question_hash)
    public.reino_category_name_to_n(gh.category) AS category_n,
    gh.age_band,
    gh.question,
    gh.correct_answer,
    gh.options,
    gh.format,
    h.question_hash,
    gh.created_at
  FROM public.game_history gh
  CROSS JOIN LATERAL (
    SELECT public.reino_question_hash(
      public.reino_strip_tags(gh.question) || '|' || public.reino_strip_tags(gh.correct_answer)
    ) AS question_hash
  ) h
  WHERE gh.age_band IN ('6-9', '10-15', '15+')
    AND public.reino_category_name_to_n(gh.category) IS NOT NULL
    AND length(trim(gh.question)) > 0
    AND length(trim(gh.correct_answer)) > 0
  ORDER BY h.question_hash, gh.created_at DESC
) src
WHERE NOT EXISTS (
  SELECT 1 FROM public.question_bank qb WHERE qb.question_hash = src.question_hash
)
AND NOT EXISTS (
  SELECT 1 FROM public.question_bank_blocked b WHERE b.question_hash = src.question_hash
);

-- Resumo após importação
SELECT
  (SELECT COUNT(*) FROM public.question_bank WHERE source = 'history') AS importadas_do_historico,
  (SELECT COUNT(*) FROM public.question_bank) AS total_no_banco;
