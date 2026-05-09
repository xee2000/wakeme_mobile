import { NativeModules, Platform } from 'react-native';
import {
  loadActiveRoutes,
  saveActiveRoutes,
  ActiveRouteItem,
  useMonitoringStore,
  saveToRouteCache,
  loadRouteCache,
  removeFromRouteCache,
} from '../store/useMonitoringStore';
import { useAuthStore } from '../store/useAuthStore';

const { WakeMeService } = NativeModules;

export interface Waypoint {
  id:           string;
  lat:          number;
  lng:          number;
  name:         string;
  type:         'transfer' | 'destination';
  /** 이 waypoint 통과 후 탑승할 다음 구간 모드 */
  nextMode?:    'bus' | 'subway';
  /** 다음이 버스일 때 탑승 정류장 ID (API 조회용) */
  nextStopId?:  string;
  /** 다음이 버스일 때 탑승 정류장 이름 */
  nextStopName?: string;
}

// ── 내부 헬퍼 — 현재 활성 경로 전체를 네이티브에 동기화 ───────────
function syncToNative(routes: ActiveRouteItem[]) {
  if (Platform.OS !== 'android') return;
  const userId = useAuthStore.getState().user?.id ?? '';
  if (routes.length === 0) {
    WakeMeService?.stopAll();
    return;
  }
  // waypoint ID에 routeId 접두사 → geofence 수신 시 경로 구분용
  const routesWithPrefixedIds = routes.map(r => ({
    ...r,
    waypoints: r.waypoints.map(wp => ({
      ...wp,
      id: `${r.routeId}__${wp.id}`,  // e.g. "abc123__wp_0"
    })),
  }));
  WakeMeService?.startAll(JSON.stringify(routesWithPrefixedIds), userId);
}

// ── 공개 API ─────────────────────────────────────────────────────

/** 경로 하나 모니터링 시작 (이미 활성이면 덮어씀) */
export function startRouteMonitoring(item: ActiveRouteItem): void {
  // ① 영구 캐시에 저장 — 앱 재실행·서비스 재시작 후에도 자동 복원
  saveToRouteCache(item);

  // ② 현재 세션 활성 목록 갱신
  const current = loadActiveRoutes();
  const updated = [...current.filter(r => r.routeId !== item.routeId), item];
  saveActiveRoutes(updated);

  // ③ 캐시 전체(모든 경로)를 네이티브에 동기화
  //    → 워치독이 시간창에 맞춰 경로별 알림 자동 관리
  const allCached = loadRouteCache();
  syncToNative(allCached);

  // ④ Zustand 스토어 동기화 → isRouteActive() 즉시 반응
  useMonitoringStore.getState().activateRoute(item);
}

/** 경로 하나 모니터링 중단 (영구 캐시에서도 제거 — 이 경로 자동 복원 안 함) */
export function stopRouteMonitoring(routeId: string): void {
  // ① 영구 캐시에서 삭제
  removeFromRouteCache(routeId);

  // ② 현재 세션 활성 목록 갱신
  const updated = loadActiveRoutes().filter(r => r.routeId !== routeId);
  saveActiveRoutes(updated);

  // ③ 남은 캐시된 경로를 네이티브에 동기화
  const remainingCached = loadRouteCache();
  syncToNative(remainingCached);

  // ④ Zustand 스토어 동기화
  useMonitoringStore.getState().deactivateRoute(routeId);
}

/** 모든 경로 중단 */
export function stopAllMonitoring(): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.stopAll();
}

/**
 * 앱 포그라운드 복귀 / 워치독 — 캐시된 모든 경로로 서비스 재동기화
 *
 * activeRoutes (현재 세션)와 routeCache (이전에 시작된 모든 경로)를 합쳐
 * 네이티브에 전달한다. 워치독이 시간창에 맞춰 경로별 알림을 자동 관리하므로
 * 사용자가 매번 "알림 시작"을 누르지 않아도 됩니다.
 */
export function ensureServiceRunning(): void {
  const cachedRoutes = loadRouteCache();
  const activeRoutes = loadActiveRoutes();

  // 캐시 우선, 현재 활성 목록으로 최신화
  const merged = [
    ...cachedRoutes,
    ...activeRoutes.filter(a => !cachedRoutes.find(c => c.routeId === a.routeId)),
  ];

  if (merged.length === 0) return;
  syncToNative(merged);
}

// ── 하위 호환 (RouteActiveScreen 이 직접 호출하는 경우) ──────────
export function startNativeService(): void { ensureServiceRunning(); }
export function stopNativeService():  void { stopAllMonitoring(); }

export function isLocationPermissionGranted(): boolean {
  if (Platform.OS !== 'android') return true;
  return WakeMeService?.isLocationPermissionGranted() ?? false;
}

export function scheduleDeparture(
  routeId:    string,
  departTime: string,
  stopName:   string,
  startStopId: string,
): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.scheduleDeparture(routeId, departTime, stopName, startStopId);
}

export function cancelDeparture(routeId: string): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.cancelDeparture(routeId);
}

export function requestIgnoreBatteryOptimization(): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.requestIgnoreBatteryOptimization();
}

export function isBatteryOptimizationIgnored(): boolean {
  if (Platform.OS !== 'android') return true;
  return WakeMeService?.isBatteryOptimizationIgnored() ?? false;
}
