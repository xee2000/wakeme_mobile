"""
WakeMe GPS 알림 로직 시뮬레이터
================================
Android WakeMeService.kt 의 핵심 로직 Python 포팅.

시나리오: 판암역 → 월드컵경기장역 (대전 1호선, 실제 DB 좌표 사용)

GPS 신호 패턴:
  - 판암역 출발 전: 지상 (GPS 정상, acc < 50m)
  - 지하 구간: GPS 단절 (acc > 200m) → DR 모드
  - 일부 역 근처: 셀타워 추정 (acc ≈ 100m, 불량GPS)
  - 월드컵경기장 출구: GPS 복귀 (acc < 50m)

실행:
    python3 simulate_gps.py
"""

import math
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from enum import Enum

# ─────────────────────────────────────────────────────────
# 상수 (WakeMeService.kt 동일)
# ─────────────────────────────────────────────────────────
ALERT_RADIUS_M       = 500.0
FINAL_DEST_RADIUS_M  = 200.0
SUBWAY_SPEED_MPS     = 9.0      # 지하철 평균 32km/h (정차 포함)
MOVING_THRESHOLD_MPS = 2.0
MAX_ACCEPTABLE_ACC_M = 50.0     # 초과 시 DR 전환
DR_UPDATE_INTERVAL_S = 5
GPS_POLL_INTERVAL_S  = 5

DR_BRAKING_ACC  = 0.50
DR_BRAKING_CONF = 3.0
DR_STOPPED_ACC  = 0.10
DR_STOPPED_CONF = 4.0
DR_MOVING_ACC   = 0.30
DR_MOVING_CONF  = 2.0
DR_ACC_ALPHA    = 0.2

# 가속도계 서브샘플링 주기 (실제 Android 센서 ~5Hz 모방)
ACCEL_SAMPLE_INTERVAL_S = 0.2

# ─────────────────────────────────────────────────────────
# 실제 DB 좌표 (대전 1호선, /api/subway/stations 응답)
# ─────────────────────────────────────────────────────────
STATIONS_DJM = {
    "판암":       (36.3294,   127.4419),
    "신흥":       (36.3319,   127.4308),
    "대동":       (36.3359,   127.4196),
    "대전":       (36.3321,   127.4340),
    "중앙로":     (36.3259,   127.4233),
    "중구청":     (36.3206,   127.4168),
    "서대전네거리": (36.3168,  127.4093),
    "오룡":       (36.3140,   127.3999),
    "용문":       (36.3183,   127.3910),
    "탄방":       (36.3181,   127.3832),
    "시청":       (36.3510,   127.3847),
    "정부청사":   (36.3580,   127.3774),
    "갈마":       (36.3624,   127.3700),
    "월평":       (36.3682,   127.3626),
    "갑천":       (36.3748,   127.3556),
    "유성온천":   (36.3621,   127.3445),
    "구암":       (36.3689,   127.3376),
    "현충원":     (36.3728,   127.3253),   # DB 실제값 (DJM-118) — 역명이 국립현충원과 같아 혼동 주의
    "월드컵경기장": (36.3668,  127.3179),
}

# 판암 → 월드컵경기장 노선 순서
ROUTE_ORDER = [
    "판암", "신흥", "대동", "대전", "중앙로", "중구청",
    "서대전네거리", "오룡", "용문", "탄방", "시청",
    "정부청사", "갈마", "월평", "갑천", "유성온천",
    "구암", "현충원", "월드컵경기장",
]

# GPS 신호 상태 (역별 정의)
# "good": acc < 50m  /  "poor": acc ≈ 100m  /  "none": acc > 200m
STATION_GPS = {
    "판암":         "good",   # 지상 출발
    "신흥":         "none",   # 지하 진입
    "대동":         "none",
    "대전":         "poor",   # 대전역 — 지하지만 셀타워 수신
    "중앙로":       "none",
    "중구청":       "none",
    "서대전네거리": "none",
    "오룡":         "poor",   # 일부 지점 셀타워
    "용문":         "none",
    "탄방":         "none",
    "시청":         "none",
    "정부청사":     "poor",
    "갈마":         "none",
    "월평":         "none",
    "갑천":         "none",
    "유성온천":     "none",
    "구암":         "none",
    "현충원":       "none",
    "월드컵경기장": "good",   # 지상 출구 GPS 복귀
}

# ─────────────────────────────────────────────────────────
# 데이터 클래스
# ─────────────────────────────────────────────────────────
@dataclass
class LatLng:
    lat: float
    lng: float
    def __repr__(self):
        return f"({self.lat:.5f},{self.lng:.5f})"

@dataclass
class Waypoint:
    id:             str
    lat:            float
    lng:            float
    name:           str
    type:           str       # "transfer" | "destination"
    next_mode:      str = ""
    next_stop_name: str = ""

@dataclass
class GpsPoint:
    t:        float   # 시간(초)
    lat:      float
    lng:      float
    accuracy: float   # 미터
    speed:    float   # m/s
    label:    str = ""
    raw_acc:  float = 0.05   # 가속도계 값 (m/s²)

class TrainState(Enum):
    MOVING  = "MOVING"
    BRAKING = "BRAKING"
    STOPPED = "STOPPED"

# ─────────────────────────────────────────────────────────
# 계산 함수
# ─────────────────────────────────────────────────────────
def haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def advance_along_path(path: List[LatLng], from_lat, from_lng, distance_m) -> Tuple[float, float]:
    if not path: return from_lat, from_lng
    if len(path) == 1: return path[0].lat, path[0].lng

    # 가장 가까운 포인트 탐색
    nearest_idx, nearest_dist = 0, float('inf')
    for i, pt in enumerate(path):
        d = haversine(from_lat, from_lng, pt.lat, pt.lng)
        if d < nearest_dist:
            nearest_dist, nearest_idx = d, i

    # 경로를 따라 전진
    remaining = distance_m
    i = nearest_idx
    while i < len(path) - 1:
        seg_len = haversine(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng)
        if seg_len <= 0: i += 1; continue
        if remaining <= seg_len:
            frac = remaining / seg_len
            return (path[i].lat + frac * (path[i+1].lat - path[i].lat),
                    path[i].lng + frac * (path[i+1].lng - path[i].lng))
        remaining -= seg_len
        i += 1
    return path[-1].lat, path[-1].lng

# ─────────────────────────────────────────────────────────
# 시나리오 빌더
# ─────────────────────────────────────────────────────────
def build_daejeon_line1_scenario():
    """
    판암역 → 월드컵경기장역 시나리오
    - 역간 평균 소요 시간: ~90초 (정차 30초 + 이동 60초)
    - 정차 중 가속도: 0.03~0.05 m/s²
    - 감속/가속 구간 가속도: 0.5~0.7 m/s²
    """

    # ── route_path: 전 역 좌표 배열 ──────────────────────────────
    route_path = [LatLng(*STATIONS_DJM[s]) for s in ROUTE_ORDER]

    # ── waypoints: 환승 없이 직행이므로 종착역만 ─────────────────
    dest_lat, dest_lng = STATIONS_DJM["월드컵경기장"]
    waypoints = [
        Waypoint(
            id="route1__wp_dest",
            lat=dest_lat, lng=dest_lng,
            name="월드컵경기장",
            type="destination",
        )
    ]

    # ── GPS 더미 데이터 생성 ──────────────────────────────────────
    gps_data: List[GpsPoint] = []
    t = 0.0

    # 지상 출발 구간 (판암역 도착 전 도보 30초)
    panam_lat, panam_lng = STATIONS_DJM["판암"]
    start_lat = panam_lat - 0.0015
    start_lng = panam_lng + 0.0020
    for step in range(7):
        frac = step / 6
        gps_data.append(GpsPoint(
            t=t, label="도보 → 판암역",
            lat=start_lat + frac * (panam_lat - start_lat),
            lng=start_lng + frac * (panam_lng - start_lng),
            accuracy=18.0, speed=1.3, raw_acc=0.04,
        ))
        t += 5

    # 역별 이동 시뮬레이션
    # 각 역: 정차(30초) → 출발가속(15초) → 이동(45초) → 감속(15초)
    for idx, stn_name in enumerate(ROUTE_ORDER):
        stn_lat, stn_lng = STATIONS_DJM[stn_name]
        gps_state = STATION_GPS[stn_name]

        # GPS 정확도 결정
        if gps_state == "good":
            acc_base = 20.0
        elif gps_state == "poor":
            acc_base = 110.0   # 셀타워 추정 — 불량GPS (acc > 50m)
        else:
            acc_base = 220.0   # 완전 단절

        # 정차 중 (30초, 5초 간격 → 6포인트)
        for step in range(6):
            noise_lat = (step % 3 - 1) * 0.0001 if gps_state == "poor" else 0
            noise_lng = (step % 2) * 0.0001 if gps_state == "poor" else 0
            gps_data.append(GpsPoint(
                t=t,
                label=f"{stn_name} 정차",
                lat=stn_lat + noise_lat,
                lng=stn_lng + noise_lng,
                accuracy=acc_base + (30 if gps_state == "poor" else 0) * (step % 2),
                speed=0.0,
                raw_acc=0.04,  # 정차 중 미세 진동
            ))
            t += 5

        if idx == len(ROUTE_ORDER) - 1:
            break  # 종착역은 정차만

        # 다음 역 방향으로 이동
        next_stn = ROUTE_ORDER[idx + 1]
        next_lat, next_lng = STATIONS_DJM[next_stn]
        next_gps = STATION_GPS[next_stn]
        move_acc = max(acc_base, 220.0 if next_gps == "none" else acc_base)

        # 출발 가속 (15초, 3포인트)
        for step in range(3):
            frac = step / 12
            gps_data.append(GpsPoint(
                t=t,
                label=f"{stn_name}→{next_stn} 가속",
                lat=stn_lat + frac * (next_lat - stn_lat),
                lng=stn_lng + frac * (next_lng - stn_lng),
                accuracy=move_acc,
                speed=SUBWAY_SPEED_MPS * (step + 1) / 3,
                raw_acc=0.60,  # 출발 가속
            ))
            t += 5

        # 정속 이동 (45초, 9포인트)
        for step in range(9):
            frac = (3 + step) / 12
            gps_data.append(GpsPoint(
                t=t,
                label=f"{stn_name}→{next_stn} 이동",
                lat=stn_lat + frac * (next_lat - stn_lat),
                lng=stn_lng + frac * (next_lng - stn_lng),
                accuracy=move_acc,
                speed=SUBWAY_SPEED_MPS,
                raw_acc=0.05,  # 정속 주행 — 가속도 거의 0
            ))
            t += 5

        # 감속 (15초, 3포인트)
        for step in range(3):
            frac = (12 + step) / 12
            gps_data.append(GpsPoint(
                t=t,
                label=f"{stn_name}→{next_stn} 감속",
                lat=stn_lat + frac * (next_lat - stn_lat),
                lng=stn_lng + frac * (next_lng - stn_lng),
                accuracy=move_acc,
                speed=SUBWAY_SPEED_MPS * (3 - step) / 3,
                raw_acc=0.58,  # 감속
            ))
            t += 5

    return waypoints, route_path, gps_data


# ─────────────────────────────────────────────────────────
# 시뮬레이터
# ─────────────────────────────────────────────────────────
class WakeMeSimulator:
    def __init__(self, waypoints, route_path):
        self.waypoints    = waypoints
        self.route_path   = route_path
        self.notified     = set()

        self.last_lat   = float('nan')
        self.last_lng   = float('nan')
        self.last_speed = 0.0
        self.last_time  = 0.0

        self.dr_active       = False
        self.dr_train_state  = TrainState.MOVING
        self.dr_moving_ms    = 0.0
        self.dr_smoothed_acc = 0.0
        self.dr_braking_since  = 0.0
        self.dr_stopped_since  = 0.0
        self.dr_moving_since   = 0.0
        self.dr_state_changed_at = 0.0

        self.normal_gps = 0
        self.poor_gps   = 0
        self.dr_pts     = 0
        self.last_dr_state_log = None

    def _notify(self, icon, title, body, source):
        print(f"\n  {'━'*52}")
        print(f"  🔔 알림 [{source}]  {icon} {title}")
        print(f"     {body}")
        print(f"  {'━'*52}\n")

    def _update_accel(self, raw_acc, now):
        self.dr_smoothed_acc = DR_ACC_ALPHA * raw_acc + (1 - DR_ACC_ALPHA) * self.dr_smoothed_acc
        a = self.dr_smoothed_acc
        st = self.dr_train_state

        if st == TrainState.MOVING:
            if a >= DR_BRAKING_ACC:
                if not self.dr_braking_since: self.dr_braking_since = now
                elif now - self.dr_braking_since >= DR_BRAKING_CONF:
                    self.dr_train_state = TrainState.BRAKING
                    self.dr_state_changed_at = now
                    self.dr_braking_since = 0
                    print(f"       ⚡ MOVING → BRAKING  acc={a:.2f}m/s²")
            else:
                self.dr_braking_since = 0

        elif st == TrainState.BRAKING:
            if a <= DR_STOPPED_ACC:
                if not self.dr_stopped_since: self.dr_stopped_since = now
                elif now - self.dr_stopped_since >= DR_STOPPED_CONF:
                    self.dr_moving_ms += (now - self.dr_state_changed_at) * 1000
                    self.dr_train_state = TrainState.STOPPED
                    self.dr_state_changed_at = now
                    self.dr_stopped_since = 0
                    print(f"       🛑 BRAKING → STOPPED  acc={a:.2f}m/s²  누적이동={self.dr_moving_ms/1000:.0f}s")
            else:
                self.dr_stopped_since = 0

        elif st == TrainState.STOPPED:
            if a >= DR_MOVING_ACC:
                if not self.dr_moving_since: self.dr_moving_since = now
                elif now - self.dr_moving_since >= DR_MOVING_CONF:
                    self.dr_train_state = TrainState.MOVING
                    self.dr_state_changed_at = now
                    self.dr_moving_since = 0
                    print(f"       🚇 STOPPED → MOVING  acc={a:.2f}m/s²")
            else:
                self.dr_moving_since = 0

    def _eff_moving_s(self, now):
        if self.dr_train_state in (TrainState.MOVING, TrainState.BRAKING):
            return (self.dr_moving_ms + (now - self.dr_state_changed_at) * 1000) / 1000
        return self.dr_moving_ms / 1000

    def process_gps(self, pt: GpsPoint):
        if pt.accuracy > MAX_ACCEPTABLE_ACC_M:
            self.poor_gps += 1
            if not self.dr_active:
                self.dr_active = True
                self.dr_train_state = TrainState.MOVING
                self.dr_moving_ms = 0
                self.dr_state_changed_at = pt.t
                self.dr_smoothed_acc = 0
                self.dr_braking_since = self.dr_stopped_since = self.dr_moving_since = 0
                print(f"  t={pt.t:5.0f}s  📡 불량GPS acc={pt.accuracy:.0f}m [{pt.label}] → DR 시작")
            return

        if self.dr_active:
            print(f"  t={pt.t:5.0f}s  🛰️  GPS 복귀 acc={pt.accuracy:.0f}m → DR 해제")
            self.dr_active = False
            self.dr_moving_ms = 0

        self.normal_gps += 1
        self.last_lat   = pt.lat
        self.last_lng   = pt.lng
        self.last_speed = pt.speed
        self.last_time  = pt.t
        print(f"  t={pt.t:5.0f}s  🛰️  GPS  {pt.lat:.5f},{pt.lng:.5f}  acc={pt.accuracy:.0f}m  [{pt.label}]")
        self._check(pt.lat, pt.lng, "GPS")

    def process_dr(self, interval_start: float, now: float, raw_acc: float):
        if not self.dr_active or math.isnan(self.last_lat): return
        self.dr_pts += 1

        # 실제 Android 가속도계는 ~5Hz 샘플링 — EMA가 제대로 수렴하도록 서브샘플
        t_sub = interval_start + ACCEL_SAMPLE_INTERVAL_S
        while t_sub <= now + 1e-9:
            self._update_accel(raw_acc, t_sub)
            t_sub += ACCEL_SAMPLE_INTERVAL_S

        cache_age = now - self.last_time
        st = self.dr_train_state

        if st == TrainState.STOPPED:
            est_lat, est_lng = self.last_lat, self.last_lng
            if self.last_dr_state_log != f"STOPPED@{now:.0f}":
                print(f"  t={now:5.0f}s  🧭 DR 🛑정차  acc={self.dr_smoothed_acc:.2f}  gap={cache_age:.0f}s → 위치유지")
        else:
            eff_s  = self._eff_moving_s(now)
            dist_m = eff_s * SUBWAY_SPEED_MPS
            est_lat, est_lng = advance_along_path(self.route_path, self.last_lat, self.last_lng, dist_m)
            state_icon = "🚇이동" if st == TrainState.MOVING else "⚡감속"
            print(f"  t={now:5.0f}s  🧭 DR {state_icon}  acc={self.dr_smoothed_acc:.2f}  이동≈{dist_m:.0f}m  gap={cache_age:.0f}s → {est_lat:.5f},{est_lng:.5f}")

        self._check(est_lat, est_lng, "DR")

    def _check(self, lat, lng, source):
        for wp in self.waypoints:
            if wp.id in self.notified: continue
            is_final = "final" in wp.id or wp.type == "destination"
            radius   = FINAL_DEST_RADIUS_M if is_final else ALERT_RADIUS_M
            dist     = haversine(lat, lng, wp.lat, wp.lng)
            marker   = "✅" if dist <= radius else "  "
            print(f"         {marker} {wp.name}: {dist:.0f}m / {radius:.0f}m")
            if dist <= radius:
                self.notified.add(wp.id)
                if wp.type == "destination":
                    self._notify("🚨", "지금 내리세요!", f"{wp.name} 하차 준비하세요", source)
                elif wp.next_mode == "bus":
                    self._notify("🔔", "환승 준비", f"{wp.next_stop_name or wp.name}에서 버스 환승", source)
                elif wp.next_mode == "subway":
                    self._notify("🔔", "환승 준비", f"{wp.name}에서 지하철 환승", source)
                else:
                    self._notify("🚨", "지금 내리세요!", f"{wp.name}에서 내리세요", source)

    def summary(self):
        total = self.normal_gps + self.poor_gps
        print("\n" + "━"*52)
        print("📊 시뮬레이션 결과")
        print(f"  GPS 수신 총계    : {total}회")
        print(f"  정상 GPS 🛰️      : {self.normal_gps}회  (acc ≤ 50m)")
        print(f"  불량 GPS 📡      : {self.poor_gps}회  (acc > 50m, 셀타워)")
        print(f"  DR 추정 포인트 🧭 : {self.dr_pts}회")
        ok  = [wp.name for wp in self.waypoints if wp.id in self.notified]
        ng  = [wp.name for wp in self.waypoints if wp.id not in self.notified]
        print(f"  알림 성공        : {len(ok)}/{len(self.waypoints)}  {ok}")
        if ng: print(f"  알림 실패        : {ng}")
        print("━"*52)


# ─────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────
def run():
    print("━"*52)
    print("🚇 WakeMe GPS 시뮬레이터")
    print("   판암역 → 월드컵경기장역  (대전 1호선)")
    print("━"*52 + "\n")

    waypoints, route_path, gps_data = build_daejeon_line1_scenario()

    total_dist = sum(
        haversine(route_path[i].lat, route_path[i].lng,
                  route_path[i+1].lat, route_path[i+1].lng)
        for i in range(len(route_path)-1)
    )
    print(f"📍 목적지: 월드컵경기장  ({waypoints[0].lat},{waypoints[0].lng})")
    print(f"🗺️  경로 포인트: {len(route_path)}개  총거리 ≈ {total_dist/1000:.1f}km")
    print(f"⏱️  더미 GPS 포인트: {len(gps_data)}개  총시간 ≈ {gps_data[-1].t/60:.0f}분\n")

    gps_types = {}
    for pt in gps_data:
        k = "good" if pt.accuracy <= 50 else ("poor" if pt.accuracy <= 150 else "none")
        gps_types[k] = gps_types.get(k, 0) + 1
    print(f"GPS 분포: 정상(≤50m)={gps_types.get('good',0)}  불량(51~150m)={gps_types.get('poor',0)}  단절(>150m)={gps_types.get('none',0)}")
    print("─"*52 + "\n")

    sim      = WakeMeSimulator(waypoints, route_path)
    dr_timer = 0.0
    last_acc = 0.05

    for pt in gps_data:
        last_acc = pt.raw_acc

        if sim.dr_active:
            while dr_timer + DR_UPDATE_INTERVAL_S <= pt.t:
                interval_start = dr_timer
                dr_timer += DR_UPDATE_INTERVAL_S
                sim.process_dr(interval_start, dr_timer, last_acc)
        else:
            dr_timer = pt.t

        sim.process_gps(pt)

    sim.summary()


if __name__ == "__main__":
    run()
