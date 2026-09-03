-- Latência média por bucket (fornecedor/modelo).
-- Executar no SQL Editor do Supabase após ai-usage-minute-buckets.sql.

ALTER TABLE public.ai_request_bucket_dims
  ADD COLUMN IF NOT EXISTS latency_sum_ms BIGINT NOT NULL DEFAULT 0 CHECK (latency_sum_ms >= 0),
  ADD COLUMN IF NOT EXISTS latency_count INT NOT NULL DEFAULT 0 CHECK (latency_count >= 0);

ALTER TABLE public.ai_request_minute_dims
  ADD COLUMN IF NOT EXISTS latency_sum_ms BIGINT NOT NULL DEFAULT 0 CHECK (latency_sum_ms >= 0),
  ADD COLUMN IF NOT EXISTS latency_count INT NOT NULL DEFAULT 0 CHECK (latency_count >= 0);

CREATE OR REPLACE FUNCTION public.increment_ai_request_bucket(
  p_ok BOOLEAN DEFAULT true,
  p_provider TEXT DEFAULT '',
  p_model TEXT DEFAULT '',
  p_tokens INT DEFAULT 0,
  p_latency_ms INT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket TIMESTAMPTZ;
  v_minute_bucket TIMESTAMPTZ;
  v_err INT;
  v_provider TEXT;
  v_model TEXT;
  v_tokens INT;
  v_latency INT;
BEGIN
  v_bucket := timezone(
    'UTC',
    date_trunc('hour', timezone('Europe/Lisbon', now()))
      + (floor(extract(minute FROM timezone('Europe/Lisbon', now())) / 5) * interval '5 minutes')
  );
  v_minute_bucket := timezone(
    'UTC',
    date_trunc('minute', timezone('Europe/Lisbon', now()))
  );
  v_err := CASE WHEN COALESCE(p_ok, true) THEN 0 ELSE 1 END;
  v_provider := lower(trim(coalesce(p_provider, '')));
  v_model := trim(coalesce(p_model, ''));
  v_tokens := GREATEST(COALESCE(p_tokens, 0), 0);
  v_latency := CASE
    WHEN p_latency_ms IS NULL THEN 0
    WHEN p_latency_ms < 0 THEN 0
    ELSE LEAST(p_latency_ms, 600000)
  END;

  INSERT INTO public.ai_request_minute_dims AS m (
    bucket_start, provider, model, request_count, error_count, token_count, latency_sum_ms, latency_count
  )
  VALUES (
    v_minute_bucket, v_provider, v_model, 1, v_err, v_tokens,
    CASE WHEN v_latency > 0 THEN v_latency ELSE 0 END,
    CASE WHEN v_latency > 0 THEN 1 ELSE 0 END
  )
  ON CONFLICT (bucket_start, provider, model) DO UPDATE SET
    request_count = m.request_count + 1,
    error_count = m.error_count + v_err,
    token_count = m.token_count + v_tokens,
    latency_sum_ms = m.latency_sum_ms + CASE WHEN v_latency > 0 THEN v_latency ELSE 0 END,
    latency_count = m.latency_count + CASE WHEN v_latency > 0 THEN 1 ELSE 0 END;

  INSERT INTO public.ai_request_bucket_dims AS d (
    bucket_start, provider, model, request_count, error_count, latency_sum_ms, latency_count
  )
  VALUES (
    v_bucket, v_provider, v_model, 1, v_err,
    CASE WHEN v_latency > 0 THEN v_latency ELSE 0 END,
    CASE WHEN v_latency > 0 THEN 1 ELSE 0 END
  )
  ON CONFLICT (bucket_start, provider, model) DO UPDATE SET
    request_count = d.request_count + 1,
    error_count = d.error_count + v_err,
    latency_sum_ms = d.latency_sum_ms + CASE WHEN v_latency > 0 THEN v_latency ELSE 0 END,
    latency_count = d.latency_count + CASE WHEN v_latency > 0 THEN 1 ELSE 0 END;

  INSERT INTO public.ai_request_buckets AS b (bucket_start, request_count, error_count)
  VALUES (v_bucket, 1, v_err)
  ON CONFLICT (bucket_start) DO UPDATE SET
    request_count = b.request_count + 1,
    error_count = b.error_count + v_err;

  DELETE FROM public.ai_request_minute_dims
  WHERE bucket_start < timezone('UTC', now()) - interval '2 hours';

  DELETE FROM public.ai_request_bucket_dims
  WHERE bucket_start < timezone('UTC', now()) - interval '48 hours';

  DELETE FROM public.ai_request_buckets
  WHERE bucket_start < timezone('UTC', now()) - interval '48 hours';
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_ai_request_bucket(BOOLEAN, TEXT, TEXT, INT, INT) TO service_role;

DROP FUNCTION IF EXISTS public.increment_ai_request_bucket(BOOLEAN, TEXT, TEXT, INT);
