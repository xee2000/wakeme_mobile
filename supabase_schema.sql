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
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  depart_time  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  days_of_week INT[]       NOT NULL DEFAULT '{0,1,2,3,4,5,6}'  -- 0=일..6=토, 없으면 매일
);

-- 기존 테이블에 days_of_week 컬럼이 없으면 추가 (멱등성)
ALTER TABLE public.routes
  ADD COLUMN IF NOT EXISTS days_of_week INT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';

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
  subway_city     TEXT,          -- 도시 (예: "대전", "서울") — 수정 시 도시 탭 복원용
  start_station   TEXT,
  start_station_id TEXT,
  end_station     TEXT,
  end_station_id   TEXT
);

-- 기존 테이블에 subway_city, start_station_id, end_station_id 컬럼이 없으면 추가 (멱등성)
ALTER TABLE public.route_segments
  ADD COLUMN IF NOT EXISTS subway_city      TEXT,
  ADD COLUMN IF NOT EXISTS start_station_id TEXT,
  ADD COLUMN IF NOT EXISTS end_station_id   TEXT;

ALTER TABLE public.route_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "route_segments: via route owner" ON public.route_segments;
CREATE POLICY "route_segments: anon full access"
  ON public.route_segments FOR ALL
  USING (true) WITH CHECK (true);

-- ── station_predictions (역 예측 디버깅 로그) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.station_predictions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         TEXT,
  predicted_name  TEXT        NOT NULL,   -- 앱이 예측한 역 이름
  predicted_lat   FLOAT8,                 -- drRoutePath 기준 예측 역 좌표
  predicted_lng   FLOAT8,
  dr_lat          FLOAT8,                 -- DR 추정 현재 위치
  dr_lng          FLOAT8,
  gps_lat         FLOAT8,                 -- 실제 GPS (있을 때만)
  gps_lng         FLOAT8,
  confirmed       BOOLEAN,                -- true=맞아요, false=아니요
  cache_age_s     INT                     -- GPS 캐시 나이 (DR 공백 시간)
);

ALTER TABLE public.station_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "station_predictions: anon full access" ON public.station_predictions;
CREATE POLICY "station_predictions: anon full access"
  ON public.station_predictions FOR ALL
  USING (true) WITH CHECK (true);

-- ── alert_acks (하차알림 수신확인 응답 로그) ────────────────────────────────
-- WakeMeAlertAckReceiver.kt: sendDestinationAlert() 직후 "정상적으로 받으셨나요?"
-- 확인 알림에 대한 사용자 응답(yes/no) 또는 60초 무응답 에스컬레이션(timeout) 기록.
-- 백엔드: POST /api/notify/alert-ack (src/routes/notify.ts)
CREATE TABLE IF NOT EXISTS public.alert_acks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         TEXT        NOT NULL,
  waypoint_name   TEXT        NOT NULL,
  result          TEXT        NOT NULL CHECK (result IN ('yes', 'no', 'timeout'))
);

ALTER TABLE public.alert_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alert_acks: anon full access" ON public.alert_acks;
CREATE POLICY "alert_acks: anon full access"
  ON public.alert_acks FOR ALL
  USING (true) WITH CHECK (true);
