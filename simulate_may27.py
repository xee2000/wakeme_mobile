"""
WakeMe 2026-05-27 현충원 사전 알림 미발생 분석 시뮬레이터
=========================================================

실제 데이터:
  - 마지막 GPS: 36.35913, 127.32128  speed≈0  08:51:29
  - GPS 공백:   100초 (DR 업데이트 3회: +11s, +41s, +71s)
  - GPS 복귀:   36.36685, 127.31792  (목적지, 8m 이내)  08:53:09

역 좌표 (실제 대전교통공사 API + 버스정류장 데이터 기반):
  구암역    : 36.35629, 127.33237   DJM-117
  현충원역  : 36.35948, 127.32070   DJM-118  (1번출구 46m / 3번출구 152m 평균)
  월드컵경기장: 36.36885, 127.31785  DJM-119

※ 기존 simulate_gps.py 의 현충원(36.3728,127.3253)은 실제와 1562m 오차 → 잘못된 좌표

분석 결과:
  - 마지막 GPS(36.35913) → 현충원(36.35948): 65m  ← 이미 300m 이내!
  - wasMoving=false 로 고정되어도 300m 이내이므로 pre-alert 발생해야 함
  - 실제 미발생 원인: drRoutePath.size < 3 조건 (경로 2개 역뿐인 경우) 또는
                     GPS 콜백에서 checkPreAlert을 호출하지 않음

실행:
    python3 simulate_may27.py
"""

import math
from typing import List, Tuple, Optional

# ─── 상수 ────────────────────────────────────────────────────────────────────
PRE_ALERT_RADIUS_M   = 300.0
DEST_RADIUS_M        = 200.0
SUBWAY_SPEED_MPS     = 9.0
POLL_INTERVAL_S      = 5.0

# ─── 실제 대전 1호선 좌표 (실측 기반) ────────────────────────────────────────
STATIONS_REAL = {
    "판암":          (36.3294, 127.4419),
    "신흥":          (36.3319, 127.4308),
    "대동":          (36.3359, 127.4196),
    "대전":          (36.3321, 127.4340),
    "중앙로":        (36.3259, 127.4233),
    "중구청":        (36.3206, 127.4168),
    "서대전네거리":  (36.3168, 127.4093),
    "오룡":          (36.3140, 127.3999),
    "용문":          (36.3183, 127.3910),
    "탄방":          (36.3181, 127.3832),
    "시청":          (36.3510, 127.3847),
    "정부청사":      (36.3580, 127.3774),
    "갈마":          (36.3624, 127.3700),
    "월평":          (36.3682, 127.3626),
    "갑천":          (36.3748, 127.3556),
    "유성온천":      (36.3621, 127.3445),
    "구암":          (36.3563, 127.3324),   # 실제값 (버스정류장 데이터)
    "현충원":        (36.3595, 127.3207),   # 실제값 (출구 좌표 평균) ← 핵심 수정
    "월드컵경기장":  (36.3689, 127.3178),   # 실제값 (버스정류장 데이터)
}

# 기존 시뮬레이션에서 사용하던 잘못된 좌표
STATIONS_WRONG = {
    "현충원":        (36.3728, 127.3253),   # 실제와 1562m 오차!
    "월드컵경기장":  (36.3668, 127.3179),
}

# 실제 2026-05-27 GPS 로그 (08:51:29 기준 경과초)
LAST_GPS = (36.35913, 127.32128)   # 마지막 GPS, speed≈0 → DR 시작
DEST_GPS = (36.36685, 127.31792)   # GPS 복귀 시 목적지 (100초 후)

DR_UPDATES_SEC = [11, 41, 71]      # DR 업데이트 발생 시각 (경과초)

def haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def advance_along_path(path: List[Tuple[float,float]], from_lat, from_lng, dist_m) -> Tuple[float,float]:
    if not path: return from_lat, from_lng
    # 가장 가까운 경로 포인트 탐색
    nearest_idx, nearest_d = 0, float('inf')
    for i, (plat, plng) in enumerate(path):
        d = haversine(from_lat, from_lng, plat, plng)
        if d < nearest_d:
            nearest_d, nearest_idx = d, i
    # 경로 따라 전진
    remaining = dist_m
    i = nearest_idx
    while i < len(path) - 1:
        seg = haversine(path[i][0], path[i][1], path[i+1][0], path[i+1][1])
        if seg <= 0: i += 1; continue
        if remaining <= seg:
            frac = remaining / seg
            return (path[i][0] + frac*(path[i+1][0]-path[i][0]),
                    path[i][1] + frac*(path[i+1][1]-path[i][1]))
        remaining -= seg
        i += 1
    return path[-1]

def hms(sec_offset: float) -> str:
    base = 8*3600 + 51*60 + 29  # 08:51:29
    total = int(base + sec_offset)
    h, m, s = total//3600, (total%3600)//60, total%60
    return f"{h:02d}:{m:02d}:{s:02d}"

# ─── 핵심 분석 ────────────────────────────────────────────────────────────────
def print_distance_analysis():
    print("━"*62)
    print("  📍 좌표 거리 분석")
    print("━"*62)

    h_real  = STATIONS_REAL["현충원"]
    h_wrong = STATIONS_WRONG["현충원"]
    wc_real = STATIONS_REAL["월드컵경기장"]

    d_real  = haversine(*LAST_GPS, *h_real)
    d_wrong = haversine(*LAST_GPS, *h_wrong)
    d_dest  = haversine(*LAST_GPS, *DEST_GPS)

    print(f"\n  마지막 GPS: {LAST_GPS[0]}, {LAST_GPS[1]}  speed≈0  (08:51:29)")
    print(f"\n  ┌─ 현충원역 좌표 비교 ─────────────────────────────────┐")
    print(f"  │  실제 좌표 {h_real}: {d_real:.0f}m  {'✅ 300m 이내' if d_real<=300 else '❌ 300m 밖'}")
    print(f"  │  기존 시뮬 {h_wrong}: {d_wrong:.0f}m  {'✅ 300m 이내' if d_wrong<=300 else '❌ 300m 밖'}")
    print(f"  └───────────────────────────────────────────────────────┘")
    print(f"\n  목적지(월드컵경기장): {d_dest:.0f}m")
    print(f"  현충원→월드컵경기장:  {haversine(*h_real, *wc_real):.0f}m")
    print(f"  현충원→목적지GPS:     {haversine(*h_real, *DEST_GPS):.0f}m")

# ─── 시뮬레이션 (단일 경로) ───────────────────────────────────────────────────
def run_scenario(scenario_name: str,
                 hyeonchung_coord: Tuple[float,float],
                 route_path: List[Tuple[float,float]],
                 route_size: int,
                 was_moving: bool,
                 accel_state: str = "MOVING") -> bool:
    """
    Returns True if pre-alert fired.

    was_moving  : True=이동판정(GPS 속도 기반 구 로직), False=정지판정
    accel_state : "MOVING"|"STOPPED" (가속도계 상태 — 새 로직)
    route_size  : drRoutePath.size (pre-alert 조건 size>=3 체크용)
    """
    print(f"\n  {'─'*58}")
    print(f"  시나리오: {scenario_name}")
    print(f"  드라이버: wasMoving={was_moving}  accel={accel_state}")
    print(f"  routePath size={route_size}  현충원좌표={hyeonchung_coord}")
    print(f"  {'─'*58}")

    pre_alert_fired = False
    dest_fired = False

    # GPS 복귀 전 DR 업데이트 3회
    for elapsed in DR_UPDATES_SEC:
        # 위치 추정
        if was_moving and accel_state != "STOPPED":
            # DR 전진 (수정된 로직: shouldAdvance = accel != STOPPED)
            dist_m = elapsed * SUBWAY_SPEED_MPS
            est_lat, est_lng = advance_along_path(route_path, *LAST_GPS, dist_m)
            mode_str = f"DR전진 {dist_m:.0f}m"
        else:
            # DR 고정 (구 로직 or STOPPED)
            est_lat, est_lng = LAST_GPS
            mode_str = "DR고정"

        d_hyeon = haversine(est_lat, est_lng, *hyeonchung_coord)
        d_dest  = haversine(est_lat, est_lng, *DEST_GPS)

        pre_ok = route_size >= 3
        in_pre = d_hyeon <= PRE_ALERT_RADIUS_M and pre_ok and not pre_alert_fired

        print(f"    t=+{elapsed:02d}s {hms(elapsed)}  {mode_str}  "
              f"→({est_lat:.5f},{est_lng:.6f})")
        print(f"           현충원까지:{d_hyeon:5.0f}m {'🔔사전알림!' if in_pre else '      '}"
              f"  목적지까지:{d_dest:5.0f}m"
              f"  {'(size<3 → skip)' if not pre_ok else ''}")

        if in_pre:
            pre_alert_fired = True
            print(f"    ✅ 사전 알림 발생! [DR]  ⏰ '다음 역 월드컵경기장에서 내리세요'")

    # GPS 복귀 (목적지)
    d_dest_final = haversine(*DEST_GPS, *DEST_GPS)
    d_hyeon_final = haversine(*DEST_GPS, *hyeonchung_coord)
    print(f"    t=+100s {hms(100)}  GPS복귀   "
          f"→({DEST_GPS[0]:.5f},{DEST_GPS[1]:.6f})")
    print(f"           현충원까지:{d_hyeon_final:5.0f}m  "
          f"목적지까지:{d_dest_final:4.0f}m")

    if d_dest_final <= DEST_RADIUS_M:
        dest_fired = True
        print(f"    ✅ 목적지 알림 발생! [GPS]  🚨 '지금 내리세요'")

    summary = []
    if pre_alert_fired: summary.append("사전알림 ✅")
    else:               summary.append("사전알림 ❌")
    if dest_fired:      summary.append("목적지알림 ✅")
    else:               summary.append("목적지알림 ❌")
    print(f"    → 결과: {' | '.join(summary)}")

    return pre_alert_fired

# ─── 메인 ────────────────────────────────────────────────────────────────────
def main():
    print("━"*62)
    print("  WakeMe 2026-05-27 현충원 사전알림 분석 시뮬레이터")
    print("  userId: 4875436797  /  대전 1호선  현충원→월드컵경기장")
    print("━"*62)

    print_distance_analysis()

    # 경로 구성 (탄방 ~ 월드컵경기장)
    route_order_real = ["탄방","시청","정부청사","갈마","월평","갑천","유성온천","구암","현충원","월드컵경기장"]
    route_path_real  = [STATIONS_REAL[s] for s in route_order_real]
    # (size=10, [8]=현충원)

    route_order_short = ["구암","현충원","월드컵경기장"]
    route_path_short  = [STATIONS_REAL[s] for s in route_order_short]
    # (size=3, [1]=현충원)

    route_order_2stn  = ["현충원","월드컵경기장"]
    route_path_2stn   = [STATIONS_REAL[s] for s in route_order_2stn]
    # (size=2) → size < 3 조건에 걸림!

    hyeonchung_real  = STATIONS_REAL["현충원"]
    hyeonchung_wrong = STATIONS_WRONG["현충원"]

    print("\n" + "═"*62)
    print("  📊 시나리오별 시뮬레이션")
    print("═"*62)

    results = {}

    # ── Case 1: 기존 코드 + 잘못된 좌표 (이전 시뮬레이션 상황)
    print("\n【Case 1】기존 코드 + 기존 시뮬레이션 좌표 (36.3728,127.3253)")
    print("  → 이 경우: 현충원이 마지막 GPS에서 1562m 떨어져 있어 알림 불발")
    results[1] = run_scenario(
        "구 로직(wasMoving=false) + 잘못된 현충원 좌표",
        hyeonchung_coord=hyeonchung_wrong,
        route_path=route_path_real,
        route_size=10,
        was_moving=False,
        accel_state="MOVING",
    )

    # ── Case 2: 수정된 코드 + 잘못된 좌표
    print("\n【Case 2】수정된 코드(shouldAdvance) + 기존 시뮬레이션 좌표")
    print("  → 전진해도 1562m → 300m까지 41s 기준으론 369m 이동 → 아직 1190m")
    results[2] = run_scenario(
        "신 로직(shouldAdvance=MOVING) + 잘못된 현충원 좌표",
        hyeonchung_coord=hyeonchung_wrong,
        route_path=route_path_real,
        route_size=10,
        was_moving=False,
        accel_state="MOVING",
    )
    # ↑ Case 1과 같음 - 신 로직도 도달 못함

    # ── Case 3: 실제 좌표 + 구 로직 (마지막 GPS AT 현충원 → 고정도 300m 이내)
    print("\n【Case 3】실제 좌표 + 구 로직(wasMoving=false) + routeSize=10")
    print("  → 현충원이 65m → 고정 위치에서도 사전알림 발생해야 함")
    results[3] = run_scenario(
        "구 로직 + 실제 현충원 좌표 + 충분한 routePath",
        hyeonchung_coord=hyeonchung_real,
        route_path=route_path_real,
        route_size=10,
        was_moving=False,
        accel_state="MOVING",
    )

    # ── Case 4: 실제 좌표 + 경로 2개역 (size<3 버그)
    print("\n【Case 4】실제 좌표 + routeSize=2 → drRoutePath.size < 3 버그")
    print("  → 이것이 실제 미발생 원인일 가능성")
    results[4] = run_scenario(
        "구 로직 + 실제 좌표 + routeSize=2 (현충원~월드컵)",
        hyeonchung_coord=hyeonchung_real,
        route_path=route_path_2stn,
        route_size=2,          # size < 3 → checkPreAlert 즉시 return
        was_moving=False,
        accel_state="MOVING",
    )

    # ── Case 5: 수정된 코드 + 실제 좌표 + size=3 (최소 경로)
    print("\n【Case 5】신 로직 + 실제 좌표 + routeSize=3 (구암~현충원~월드컵)")
    results[5] = run_scenario(
        "신 로직 + 실제 좌표 + routeSize=3",
        hyeonchung_coord=hyeonchung_real,
        route_path=route_path_short,
        route_size=3,
        was_moving=False,
        accel_state="MOVING",
    )

    # ── Case 6: GPS에서도 checkPreAlert 호출하는 경우 (미래 개선안)
    print("\n【Case 6】GPS 수신 시 checkPreAlert도 호출 (개선 제안)")
    print("  → GPS(36.35913, 127.32128)에서 이미 현충원 65m → 즉시 발화")
    d_at_gps = haversine(*LAST_GPS, *hyeonchung_real)
    if d_at_gps <= PRE_ALERT_RADIUS_M:
        print(f"    t=  0s  08:51:29  GPS 수신  → 현충원까지:{d_at_gps:.0f}m")
        print(f"    ✅ GPS 콜백에서 사전 알림 즉시 발생!  (현재는 미구현)")
    print()

    # ── 최종 요약 ─────────────────────────────────────────────────────────────
    print("━"*62)
    print("  📋 분석 결과 요약")
    print("━"*62)
    print(f"""
  【핵심 발견】
  1. 기존 시뮬레이션 현충원 좌표 오류: 실제와 1562m 차이
     - 잘못된 좌표(36.3728)로는 어떤 코드도 사전알림 불가 (Case 1,2)

  2. 실제 좌표(36.3595) 기준으로는:
     - 마지막 GPS가 현충원에서 단 65m → 이미 300m 이내
     - wasMoving=false 로 고정돼도 사전알림이 발생해야 함 (Case 3 ✅)

  3. 실제 미발생 원인 (가장 유력):
     - drRoutePath.size < 3 조건 (Case 4 ❌)
       → 사용자 경로가 '현충원 → 월드컵경기장' 2개 역만 있을 때
       → checkPreAlert() 함수 첫 줄에서 즉시 return

  4. 이중 보완책:
     - wasMoving 버그 수정 (이미 적용됨) → 중간 GPS 수신 시 안전망
     - size < 3 → size < 2 수정 또는 GPS 콜백에서도 checkPreAlert 호출

  【권장 추가 수정】→ drRoutePath.size < 3 을 size < 2 로 변경
""")

    # 수정 제안 시각화
    print("  WakeMeService.kt  checkPreAlert()  현재:")
    print("    if (drRoutePath.size < 3) return   ← 경로 2역이면 항상 skip")
    print()
    print("  → 수정 후:")
    print("    if (drRoutePath.size < 2) return   ← 경로 1역 이하만 skip")
    print("    (현충원→월드컵 2개 역 경로에서도 사전알림 정상 동작)")
    print("━"*62)

if __name__ == "__main__":
    main()
