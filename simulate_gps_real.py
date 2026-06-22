"""
WakeMe GPS 시뮬레이터 — 실제 서버 로그 재현
=============================================
실제 GPS_POLL 로그 (2026-05-21 08:34 ~ 08:53) 를 그대로 재생.

userId: 4875436797
경로:   대전 1호선 (탄방 인근) → 월드컵경기장
로그 특이사항:
  - acc=-1 → 기기 GPS 불가, Android 앱이 DR 추정 좌표 전송
  - 08:52:39 DR 좌표가 역방향으로 점프 (907m → 1624m)
  - 08:53:12 GPS 복귀 시 8m (목적지 도착)

분석 포인트:
  1) 실제 환경에서 DR 역방향 문제 재현
  2) 목적지 알림이 언제 / 어떤 경로로 발생했는지
  3) acc=-1 구간에서 advanceAlongPath 가 도움이 되는지 비교

실행:
    python3 simulate_gps_real.py
"""

import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

# ─────────────────────────────────────────────────────────
# 상수
# ─────────────────────────────────────────────────────────
FINAL_DEST_RADIUS_M  = 50.0    # 목적지 도착 반경  (강진동 "지금 내리세요!")
PRE_ALERT_RADIUS_M   = 300.0   # 한 정거장 전 반경 (일반 진동 "다음 역에서 내리세요")
ALERT_RADIUS_M       = 500.0   # 환승 반경
MAX_ACCEPTABLE_ACC_M = 50.0    # 이 이상이면 DR 모드
SUBWAY_SPEED_MPS     = 9.0     # 지하철 평균 속도 (DR 추정용)

# ─────────────────────────────────────────────────────────
# 실제 로그 데이터  (acc=-1 → 앱이 GPS 없어서 DR 추정치 보낸 것)
# ─────────────────────────────────────────────────────────
LOG_POINTS = [
    # (경과초,  위도,       경도,      acc_m,  레이블)
    (   0,  36.33809, 127.39347,  21, "지상 이동"),
    (  34,  36.33823, 127.39338,  26, "지상 이동"),
    (  67,  36.34046, 127.39090,  -1, "DR (지하)"),
    ( 100,  36.34046, 127.39090,  -1, "DR (정차?)"),
    ( 133,  36.34548, 127.38472,  33, "GPS 복귀"),
    ( 166,  36.34553, 127.38471,  30, "GPS"),
    ( 199,  36.34273, 127.38790,  -1, "DR (역방향?)"),
    ( 232,  36.35156, 127.38690,  -1, "DR"),
    ( 265,  36.34548, 127.38456,  21, "GPS 복귀"),
    ( 298,  36.35192, 127.38682,  15, "GPS"),
    ( 331,  36.35156, 127.38690,  -1, "DR"),
    ( 375,  36.34548, 127.38481,  22, "GPS 복귀"),
    ( 408,  36.35746, 127.38132,  16, "GPS"),
    ( 441,  36.35767, 127.37254,  -1, "DR"),
    ( 475,  36.35765, 127.37296,  11, "GPS 복귀"),
    ( 508,  36.35763, 127.37305,  11, "GPS"),
    ( 541,  36.35767, 127.37254,  -1, "DR"),
    ( 575,  36.35824, 127.36452,  23, "GPS 복귀"),
    ( 608,  36.35832, 127.36436,  13, "GPS"),
    ( 641,  36.35826, 127.36453,  -1, "DR"),
    ( 674,  36.35432, 127.35451,  -1, "DR"),
    ( 715,  36.35461, 127.35442,  11, "GPS 복귀"),
    ( 749,  36.35432, 127.35451,  -1, "DR"),
    ( 782,  36.35391, 127.34282,  -1, "DR"),
    ( 816,  36.35384, 127.34148,  23, "GPS 복귀"),
    ( 849,  36.35377, 127.34153,  11, "GPS"),
    ( 882,  36.35381, 127.34148,  -1, "DR"),
    ( 915,  36.35773, 127.32912,  -1, "DR"),
    ( 948,  36.35773, 127.32912,  -1, "DR (정차)"),
    ( 982,  36.35719, 127.32979,  -1, "DR"),
    (1015,  36.35653, 127.33079,  -1, "DR ← 역방향 주의"),
    (1048,  36.35911, 127.32133,  13, "GPS 복귀 (909m)"),
    (1085,  36.35912, 127.32130,  -1, "DR"),
    (1118,  36.35653, 127.33079,  -1, "DR ← 역방향! 907→1624m"),
    (1151,  36.36687, 127.31793,  11, "GPS 복귀 (8m) ← 목적지!"),
    (1185,  36.36686, 127.31793,  11, "목적지 정차"),
]

# 목적지 waypoint
DEST_LAT, DEST_LNG = 36.36680, 127.31790  # 월드컵경기장

# 대전 1호선 route_path (DB 실제값 — subway_stations 테이블 기준)
# DJM-118 현충원: 36.3728, 127.3253  (대전교통공사 API 데이터)
# ※ 주의: 이 좌표는 국립대전현충원 인근으로 실제 역사와 ~1562m 차이남
#          실제 열차 GPS 궤적상 현충원역 승강장은 36.359 부근으로 추정
ROUTE_PATH = [
    (36.3294, 127.4419),  # 판암
    (36.3319, 127.4308),  # 신흥
    (36.3359, 127.4196),  # 대동
    (36.3321, 127.4340),  # 대전
    (36.3259, 127.4233),  # 중앙로
    (36.3206, 127.4168),  # 중구청
    (36.3168, 127.4093),  # 서대전네거리
    (36.3140, 127.3999),  # 오룡
    (36.3183, 127.3910),  # 용문
    (36.3181, 127.3832),  # 탄방
    (36.3510, 127.3847),  # 시청
    (36.3580, 127.3774),  # 정부청사
    (36.3624, 127.3700),  # 갈마
    (36.3682, 127.3626),  # 월평
    (36.3748, 127.3556),  # 갑천
    (36.3621, 127.3445),  # 유성온천
    (36.3689, 127.3376),  # 구암
    (36.3728, 127.3253),  # 현충원 (DB값 DJM-118 — 실제 역사 위치와 차이 있음)
    (36.3668, 127.3179),  # 월드컵경기장
]

# ─────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────
def haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat/2)**2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2)
    return R * 2 * math.asin(math.sqrt(a))

def advance_along_path(path, from_lat, from_lng, distance_m) -> Tuple[float, float]:
    if not path: return from_lat, from_lng
    nearest_idx, nearest_dist = 0, float('inf')
    for i, (plat, plng) in enumerate(path):
        d = haversine(from_lat, from_lng, plat, plng)
        if d < nearest_dist:
            nearest_dist, nearest_idx = d, i
    remaining = distance_m
    i = nearest_idx
    while i < len(path) - 1:
        seg_len = haversine(path[i][0], path[i][1], path[i+1][0], path[i+1][1])
        if seg_len <= 0: i += 1; continue
        if remaining <= seg_len:
            frac = remaining / seg_len
            return (path[i][0] + frac * (path[i+1][0] - path[i][0]),
                    path[i][1] + frac * (path[i+1][1] - path[i][1]))
        remaining -= seg_len
        i += 1
    return path[-1]

def hms(seconds: float) -> str:
    base = 8 * 3600 + 34 * 60  # 08:34:00 기준
    total = int(base + seconds)
    h, m, s = total // 3600, (total % 3600) // 60, total % 60
    return f"{h:02d}:{m:02d}:{s:02d}"

# ─────────────────────────────────────────────────────────
# 시뮬레이터 (두 가지 모드 비교)
# ─────────────────────────────────────────────────────────
def run_replay(use_path_dr: bool):
    """
    use_path_dr=False : DR 좌표를 로그 값 그대로 사용  (현재 앱 동작)
    use_path_dr=True  : acc=-1 구간에서 advanceAlongPath 사용  (개선안)
    """
    mode_label = "개선안 (advanceAlongPath)" if use_path_dr else "현재 앱 동작 (로그 좌표 그대로)"
    print(f"\n{'═'*60}")
    print(f"  모드: {mode_label}")
    print(f"{'═'*60}")
    print(f"{'시각':10} {'t':>6}  {'위도':10} {'경도':11} {'acc':>5}  {'목적지':>7}  상태")
    print("─" * 70)

    notified       = False
    last_good_lat  = float('nan')
    last_good_lng  = float('nan')
    last_good_t    = 0.0
    dr_active      = False
    notify_t       = None

    for (t, lat, lng, acc, label) in LOG_POINTS:
        is_bad = (acc <= 0 or acc > MAX_ACCEPTABLE_ACC_M)

        # advanceAlongPath 모드: acc=-1 이면 DR로 좌표 재계산
        if use_path_dr and is_bad and not math.isnan(last_good_lat):
            elapsed = t - last_good_t
            dist_m  = elapsed * SUBWAY_SPEED_MPS
            est_lat, est_lng = advance_along_path(ROUTE_PATH, last_good_lat, last_good_lng, dist_m)
            check_lat, check_lng = est_lat, est_lng
            src = "DR🗺️ "
        else:
            check_lat, check_lng = lat, lng
            src = "DR📡" if is_bad else "GPS "

        # 상태 업데이트
        if not is_bad:
            last_good_lat, last_good_lng = lat, lng
            last_good_t = t
            if dr_active:
                dr_active = False
        else:
            if not dr_active:
                dr_active = True

        # 목적지 거리 계산
        dist = haversine(check_lat, check_lng, DEST_LAT, DEST_LNG)
        in_range = dist <= FINAL_DEST_RADIUS_M

        flag = "✅" if in_range else "  "
        acc_str = f"{acc}m" if acc > 0 else "DR"
        print(f"{hms(t)}  {t:5.0f}s  {check_lat:.5f}  {check_lng:.6f}  {acc_str:>5}  {dist:6.0f}m  {src} {flag} {label}")

        if in_range and not notified:
            notified = True
            notify_t = t
            print(f"\n  {'━'*56}")
            print(f"  🔔 알림 발생! [{src.strip()}]  t={t:.0f}s ({hms(t)})  거리={dist:.0f}m")
            print(f"     월드컵경기장 하차 준비하세요")
            print(f"  {'━'*56}\n")

    if not notified:
        print("\n  ❌ 알림 미발생 — 목적지 200m 진입 없음")

    return notify_t

# ─────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("━" * 60)
    print("  WakeMe 실제 로그 재현 시뮬레이터")
    print("  userId: 4875436797  /  2026-05-21 08:34~08:53")
    print(f"  총 GPS 포인트: {len(LOG_POINTS)}개  /  목적지: 월드컵경기장")
    print("━" * 60)

    bad_count  = sum(1 for _, _, _, acc, _ in LOG_POINTS if acc <= 0 or acc > MAX_ACCEPTABLE_ACC_M)
    good_count = len(LOG_POINTS) - bad_count
    print(f"\n  정상 GPS: {good_count}개  /  DR (acc=-1 or >50m): {bad_count}개")

    # 역방향 점프 감지
    print("\n  ── 역방향 좌표 점프 감지 ──")
    prev_dist = None
    for (t, lat, lng, acc, label) in LOG_POINTS:
        dist = haversine(lat, lng, DEST_LAT, DEST_LNG)
        if prev_dist is not None and acc <= 0:
            delta = dist - prev_dist
            if delta > 300:
                print(f"  ⚠️  t={t}s ({hms(t)})  거리 +{delta:.0f}m 역방향 점프!  {prev_dist:.0f}m → {dist:.0f}m  [{label}]")
        prev_dist = dist

    # 두 모드 비교 실행
    t1 = run_replay(use_path_dr=False)
    t2 = run_replay(use_path_dr=True)

    # 결과 비교
    print("\n" + "━" * 60)
    print("  📊 비교 결과")
    print("─" * 60)
    if t1:
        print(f"  현재 앱     : t={t1:.0f}s ({hms(t1)}) 에 알림")
    else:
        print(f"  현재 앱     : 알림 미발생")
    if t2:
        print(f"  개선안      : t={t2:.0f}s ({hms(t2)}) 에 알림")
    else:
        print(f"  개선안      : 알림 미발생")
    if t1 and t2:
        diff = t1 - t2
        if diff > 0:
            print(f"  → 개선안이 {diff:.0f}초 더 일찍 알림 발생")
        elif diff < 0:
            print(f"  → 현재 앱이 {-diff:.0f}초 더 일찍 알림 발생")
        else:
            print(f"  → 동일 시각 알림")
    print("━" * 60)
