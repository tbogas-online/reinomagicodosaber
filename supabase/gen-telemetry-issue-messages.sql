-- Migração: mensagens detalhadas por código de rejeição na telemetria IA
-- Executar no SQL Editor do Supabase se a tabela já existir sem issue_messages

ALTER TABLE public.gen_telemetry_events
  ADD COLUMN IF NOT EXISTS issue_messages TEXT[] NOT NULL DEFAULT '{}';
