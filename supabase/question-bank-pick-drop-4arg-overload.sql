-- Remove overload ambíguo: PostgREST não consegue escolher entre 4 e 5 argumentos.
-- Aplicar DEPOIS de question-bank-pick-difficulty-tolerance.sql (ou equivalente com 5 args).
-- Erro típico: "Could not choose the best candidate function between: public.pick_question_from_bank(...)"

DROP FUNCTION IF EXISTS public.pick_question_from_bank(INT, TEXT, TEXT[], TEXT[]);
