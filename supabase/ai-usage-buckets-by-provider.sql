-- Dimensão fornecedor/modelo nos buckets de pedidos à IA.
-- Executar no SQL Editor do Supabase após ai-usage-buckets.sql.

CREATE TABLE IF NOT EXISTS public.ai_request_bucket_dims (
  bucket_start   TIMESTAMPTZ NOT NULL,
  provider       TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  request_count  INT NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  error_count    INT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  PRIMARY KEY (bucket_start, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_ai_request_bucket_dims_start
  ON public.ai_request_bucket_dims (bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_ai_request_bucket_dims_provider
  ON public.ai_request_bucket_dims (provider, bucket_start DESC);

CREATE OR REPLACE FUNCTION public.increment_ai_request_bucket(
  p_ok BOOLEAN DEFAULT true,
  p_provider TEXT DEFAULT '',
  p_model TEXT DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket TIMESTAMPTZ;
  v_err INT;
  v_provider TEXT;
  v_model TEXT;
BEGIN
  v_bucket := timezone(
    'UTC',
    date_trunc('hour', timezone('Europe/Lisbon', now()))
      + (floor(extract(minute FROM timezone('Europe/Lisbon', now())) / 5) * interval '5 minutes')
  );
  v_err := CASE WHEN COALESCE(p_ok, true) THEN 0 ELSE 1 END;
  v_provider := lower(trim(coalesce(p_provider, '')));
  v_model := trim(coalesce(p_model, ''));

  INSERT INTO public.ai_request_bucket_dims AS d (bucket_start, provider, model, request_count, error_count)
  VALUES (v_bucket, v_provider, v_model, 1, v_err)
  ON CONFLICT (bucket_start, provider, model) DO UPDATE SET
    request_count = d.request_count + 1,
    error_count = d.error_count + v_err;

  INSERT INTO public.ai_request_buckets AS b (bucket_start, request_count, error_count)
  VALUES (v_bucket, 1, v_err)
  ON CONFLICT (bucket_start) DO UPDATE SET
    request_count = b.request_count + 1,
    error_count = b.error_count + v_err;

  DELETE FROM public.ai_request_bucket_dims
  WHERE bucket_start < timezone('UTC', now()) - interval '48 hours';

  DELETE FROM public.ai_request_buckets
  WHERE bucket_start < timezone('UTC', now()) - interval '48 hours';
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_ai_request_bucket(BOOLEAN, TEXT, TEXT) TO service_role;

-- Compatibilidade: remover assinatura antiga (só BOOLEAN) se existir.
DROP FUNCTION IF EXISTS public.increment_ai_request_bucket(BOOLEAN);
