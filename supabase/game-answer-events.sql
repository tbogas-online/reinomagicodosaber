-- Respostas por ronda / eventos de resposta — estatísticas no Supabase
-- Executar no SQL Editor do Supabase após schema.sql

-- ---------------------------------------------------------------------------
-- game_history: respostas agregadas por ronda (multijogador)
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_history
  ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- game_answer_events: evento por resposta (single + multiplayer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_answer_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID REFERENCES public.game_matches(id) ON DELETE CASCADE,
  room_id         UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  round_number    INT,
  player_id       TEXT NOT NULL,
  nickname        TEXT,
  correct         BOOLEAN NOT NULL DEFAULT false,
  selected_answer TEXT,
  response_ms     INT,
  timed_out       BOOLEAN NOT NULL DEFAULT false,
  question        TEXT,
  correct_answer  TEXT,
  format          TEXT,
  category_n      INT,
  knowledge_id    TEXT,
  age_band        TEXT,
  mode            TEXT NOT NULL DEFAULT 'single'
                  CHECK (mode IN ('single', 'multiplayer')),
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS game_answer_events_match_idx
  ON public.game_answer_events (match_id);
CREATE INDEX IF NOT EXISTS game_answer_events_room_idx
  ON public.game_answer_events (room_id);
CREATE INDEX IF NOT EXISTS game_answer_events_answered_at_idx
  ON public.game_answer_events (answered_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.game_answer_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS answer_events_insert_own ON public.game_answer_events;
CREATE POLICY answer_events_insert_own ON public.game_answer_events
  FOR INSERT TO authenticated, anon
  WITH CHECK (player_id = auth.uid()::text);

DROP POLICY IF EXISTS history_update_member ON public.game_history;
CREATE POLICY history_update_member ON public.game_history
  FOR UPDATE TO authenticated, anon
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

DROP POLICY IF EXISTS matches_update_host ON public.game_matches;
CREATE POLICY matches_update_host ON public.game_matches
  FOR UPDATE TO authenticated, anon
  USING (
    room_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = game_matches.room_id AND r.host_player_id = auth.uid()
    )
  )
  WITH CHECK (
    room_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = game_matches.room_id AND r.host_player_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT INSERT ON public.game_answer_events TO anon, authenticated;
GRANT UPDATE ON public.game_history TO anon, authenticated;
GRANT UPDATE ON public.game_matches TO anon, authenticated;
