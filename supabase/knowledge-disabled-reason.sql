-- Justificação ao desactivar factos do repositório.
-- Executar no SQL Editor do Supabase (ou via admin após deploy).

ALTER TABLE public.knowledge_records
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

COMMENT ON COLUMN public.knowledge_records.disabled_reason IS
  'Motivo da desactivação (duplicado, reporte, manual). NULL se o facto está activo ou se foi desactivado antes desta coluna.';

DROP FUNCTION IF EXISTS public.disable_knowledge_record(TEXT);

CREATE OR REPLACE FUNCTION public.disable_knowledge_record(
  p_knowledge_id TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT;
BEGIN
  IF p_knowledge_id IS NULL OR p_knowledge_id = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_reason := NULLIF(left(trim(COALESCE(p_reason, '')), 400), '');

  UPDATE public.knowledge_records
  SET
    is_active = false,
    disabled_reason = COALESCE(v_reason, disabled_reason),
    updated_at = now()
  WHERE knowledge_id = p_knowledge_id;

  RETURN jsonb_build_object('ok', FOUND, 'reason', v_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.disable_knowledge_record(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disable_knowledge_record(TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

UPDATE public.knowledge_records
SET disabled_reason = 'Amostra de seed (não usada no jogo)'
WHERE NOT is_active
  AND source = 'sample'
  AND disabled_reason IS NULL;

UPDATE public.knowledge_records
SET disabled_reason = 'Duplicado (desactivado em lote; motivo não gravado na altura)'
WHERE NOT is_active
  AND source IN (
    'Ditos.pt',
    'MemóriaMedia',
    'Santander Salto',
    'Pumpkin.pt',
    'Brinca Comigo',
    'Quero Bolsa'
  )
  AND disabled_reason IS NULL;

UPDATE public.knowledge_records
SET disabled_reason = 'Desactivado manualmente (motivo não gravado na altura)'
WHERE NOT is_active
  AND disabled_reason IS NULL;
