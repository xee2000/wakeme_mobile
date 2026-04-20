-- WakeMe Mobile — Supabase Schema
-- 실행 순서: users → routes → route_segments

-- ── users ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                TEXT        PRIMARY KEY,          -- 카카오 ID (문자열)
  nickname          TEXT        NOT NULL,
  profile_image_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users: self read/write"
  ON public.users
  USING (id = current_setting('app.user_id', true));

-- ── routes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.routes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  depart_time TEXT        NOT NULL,   -- "HH:MM"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routes: owner only"
  ON public.routes
  USING (user_id = current_setting('app.user_id', true));

-- ── route_segments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_segments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        UUID        NOT NULL REFERENCES public.routes(id) ON DELETE CASCADE,
  order_index     INT         NOT NULL,
  mode            TEXT        NOT NULL CHECK (mode IN ('bus', 'subway')),

  -- 버스 필드
  bus_no          TEXT,
  start_stop_name TEXT,
  start_stop_id   TEXT,
  end_stop_name   TEXT,
  end_stop_id     TEXT,

  -- 지하철 필드
  line_name       TEXT,
  start_station   TEXT,
  end_station     TEXT
);

ALTER TABLE public.route_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "route_segments: via route owner"
  ON public.route_segments
  USING (
    route_id IN (
      SELECT id FROM public.routes
      WHERE user_id = current_setting('app.user_id', true)
    )
  );
