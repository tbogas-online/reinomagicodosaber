-- Limpeza única: remover perguntas activas sem opções válidas
-- Executar no SQL Editor do Supabase APÓS question-bank.sql (com reino_has_valid_mc_options)

DELETE FROM public.question_bank qb
WHERE qb.is_reported = false
  AND NOT public.reino_has_valid_mc_options(qb.options, qb.format, qb.correct_answer);
