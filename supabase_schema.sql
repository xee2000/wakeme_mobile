-- WakeMe Mobile — Supabase Schema
-- 여러 번 실행해도 안전 (멱등성 보장)
-- 실행 순서: extensions → static_data → users → routes → route_segments

-- ── PostGIS 확장 ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── bus_stops (대전 버스 정류장 정적 데이터) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.bus_stops (
  node_id      TEXT                   PRIMARY KEY,
  node_name    TEXT                   NOT NULL,
  lat          FLOAT8                 NOT NULL,
  lng          FLOAT8                 NOT NULL,
  address      TEXT,
  location     GEOGRAPHY(POINT, 4326)
);

CREATE OR REPLACE FUNCTION public.sync_bus_stop_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.location := ST_MakePoint(NEW.lng, NEW.lat)::geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bus_stop_location ON public.bus_stops;
CREATE TRIGGER trg_bus_stop_location
  BEFORE INSERT OR UPDATE OF lat, lng ON public.bus_stops
  FOR EACH ROW EXECUTE FUNCTION public.sync_bus_stop_location();

CREATE INDEX IF NOT EXISTS bus_stops_location_idx
  ON public.bus_stops USING GIST (location);

ALTER TABLE public.bus_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bus_stops: public read" ON public.bus_stops;
CREATE POLICY "bus_stops: public read"
  ON public.bus_stops FOR SELECT USING (true);

-- ── subway_stations (대전 지하철 역 정적 데이터) ───────────────────────────
CREATE TABLE IF NOT EXISTS public.subway_stations (
  station_id   TEXT                   PRIMARY KEY,
  station_name TEXT                   NOT NULL,
  line         TEXT                   NOT NULL,
  lat          FLOAT8                 NOT NULL,
  lng          FLOAT8                 NOT NULL,
  address      TEXT,
  location     GEOGRAPHY(POINT, 4326)
);

CREATE OR REPLACE FUNCTION public.sync_subway_station_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.location := ST_MakePoint(NEW.lng, NEW.lat)::geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subway_station_location ON public.subway_stations;
CREATE TRIGGER trg_subway_station_location
  BEFORE INSERT OR UPDATE OF lat, lng ON public.subway_stations
  FOR EACH ROW EXECUTE FUNCTION public.sync_subway_station_location();

CREATE INDEX IF NOT EXISTS subway_stations_location_idx
  ON public.subway_stations USING GIST (location);

ALTER TABLE public.subway_stations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subway_stations: public read" ON public.subway_stations;
CREATE POLICY "subway_stations: public read"
  ON public.subway_stations FOR SELECT USING (true);

-- ── 근처 정류장 조회 함수 ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nearby_bus_stops(
  user_lat FLOAT8,
  user_lng FLOAT8,
  radius_m FLOAT8 DEFAULT 500
)
RETURNS TABLE (
  node_id   TEXT,
  node_name TEXT,
  lat       FLOAT8,
  lng       FLOAT8,
  address   TEXT,
  distance  FLOAT8
)
LANGUAGE sql STABLE AS $$
  SELECT
    node_id, node_name, lat, lng, address,
    ST_Distance(location, ST_MakePoint(user_lng, user_lat)::geography) AS distance
  FROM public.bus_stops
  WHERE ST_DWithin(location, ST_MakePoint(user_lng, user_lat)::geography, radius_m)
  ORDER BY distance;
$$;

CREATE OR REPLACE FUNCTION public.nearby_subway_stations(
  user_lat FLOAT8,
  user_lng FLOAT8,
  radius_m FLOAT8 DEFAULT 1000
)
RETURNS TABLE (
  station_id   TEXT,
  station_name TEXT,
  line         TEXT,
  lat          FLOAT8,
  lng          FLOAT8,
  address      TEXT,
  distance     FLOAT8
)
LANGUAGE sql STABLE AS $$
  SELECT
    station_id, station_name, line, lat, lng, address,
    ST_Distance(location, ST_MakePoint(user_lng, user_lat)::geography) AS distance
  FROM public.subway_stations
  WHERE ST_DWithin(location, ST_MakePoint(user_lng, user_lat)::geography, radius_m)
  ORDER BY distance;
$$;

-- ── users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id                TEXT        PRIMARY KEY,
  nickname          TEXT        NOT NULL,
  profile_image_url TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- anon 키로 직접 읽기/쓰기 허용 (카카오 auth 사용 — Supabase JWT 미적용)
-- TODO: 백엔드에서 카카오 토큰 검증 후 Supabase JWT 발급 방식으로 전환 시 정책 교체
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users: self read/write" ON public.users;
CREATE POLICY "users: anon full access"
  ON public.users FOR ALL
  USING (true) WITH CHECK (true);

-- ── routes ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.routes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  depart_time TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "routes: owner only" ON public.routes;
CREATE POLICY "routes: anon full access"
  ON public.routes FOR ALL
  USING (true) WITH CHECK (true);

-- ── route_segments ────────────────────────────────────────────────────────
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
DROP POLICY IF EXISTS "route_segments: via route owner" ON public.route_segments;
CREATE POLICY "route_segments: anon full access"
  ON public.route_segments FOR ALL
  USING (true) WITH CHECK (true);
