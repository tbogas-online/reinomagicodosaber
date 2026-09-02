-- Migração: snapshot da pergunta rejeitada na telemetria IA
-- Executar no SQL Editor do Supabase se a tabela já existir sem estas colunas.

ALTER TABLE public.gen_telemetry_events
  ADD COLUMN IF NOT EXISTS question_text TEXT,
  ADD COLUMN IF NOT EXISTS answer_text TEXT,
  ADD COLUMN IF NOT EXISTS question_options TEXT[] NOT NULL DEFAULT '{}';
