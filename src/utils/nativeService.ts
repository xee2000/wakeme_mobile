import { NativeModules, Platform } from 'react-native';
import {
  loadActiveRoutes,
  saveActiveRoutes,
  ActiveRouteItem,
  useMonitoringStore,
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
  const current = loadActiveRoutes();
  const updated = [...current.filter(r => r.routeId !== item.routeId), item];
  saveActiveRoutes(updated);
  syncToNative(updated);
  // Zustand 스토어 동기화 → isRouteActive() 즉시 반응
  useMonitoringStore.getState().activateRoute(item);
}

/** 경로 하나 모니터링 중단 */
export function stopRouteMonitoring(routeId: string): void {
  const updated = loadActiveRoutes().filter(r => r.routeId !== routeId);
  saveActiveRoutes(updated);
  syncToNative(updated);
  // Zustand 스토어 동기화
  useMonitoringStore.getState().deactivateRoute(routeId);
}

/** 모든 경로 중단 */
export function stopAllMonitoring(): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.stopAll();
}

/** 앱 포그라운드 복귀 / 워치독 — 저장된 상태로 서비스 재동기화 */
export function ensureServiceRunning(): void {
  const routes = loadActiveRoutes();
  if (routes.length === 0) return;
  syncToNative(routes);
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
