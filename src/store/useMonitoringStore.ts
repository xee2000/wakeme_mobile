import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';
import { Waypoint } from '../utils/nativeService';

export type MonitoringStatus = 'idle' | 'active' | 'done';

const storage    = new MMKV({ id: 'monitoring' });
const ROUTES_KEY = 'wakeme_active_routes';
// 한 번이라도 알림 시작한 경로 영구 캐시 (앱 재시작 시 자동 복원용)
const CACHE_KEY  = 'wakeme_route_cache';

// ── 활성 경로 한 건 ────────────────────────────────────────────────
export interface RoutePathPoint {
  lat: number;
  lng: number;
}

export interface ActiveRouteItem {
  routeId:      string;
  routeName?:   string;
  waypoints:    Waypoint[];
  departTime:   string;
  startStopId?: string;
  startStopName?: string;
  /** 이동경로 좌표 배열 (지하철 중간역 포함) — DR 경로 추종에 사용 */
  routePath?:   RoutePathPoint[];
  /** 운행 요일 (0=일,1=월,...,6=토). 없으면 매일 */
  daysOfWeek?:  number[];
}

// ── MMKV 직렬화 ───────────────────────────────────────────────────
export function saveActiveRoutes(routes: ActiveRouteItem[]) {
  storage.set(ROUTES_KEY, JSON.stringify(routes));
}

export function loadActiveRoutes(): ActiveRouteItem[] {
  const raw = storage.getString(ROUTES_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function clearActiveRoutes() {
  storage.delete(ROUTES_KEY);
}

// 하위 호환 (nativeService.ts 가 loadMonitoringState 를 사용)
export function saveMonitoringState(item: ActiveRouteItem) {
  const current = loadActiveRoutes();
  const updated = [...current.filter(r => r.routeId !== item.routeId), item];
  saveActiveRoutes(updated);
}
export function loadMonitoringState(): ActiveRouteItem | null {
  return loadActiveRoutes()[0] ?? null;
}
export function clearMonitoringState() { clearActiveRoutes(); }

// ── 경로 영구 캐시 (알림 시작 경로 자동 복원) ─────────────────────────
/** 알림 시작 시 해당 경로를 영구 캐시에 저장 */
export function saveToRouteCache(item: ActiveRouteItem) {
  const raw = storage.getString(CACHE_KEY);
  const cache: ActiveRouteItem[] = raw ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : [];
  const updated = [...cache.filter(r => r.routeId !== item.routeId), item];
  storage.set(CACHE_KEY, JSON.stringify(updated));
}

/** 영구 캐시에서 모든 경로 로드 */
export function loadRouteCache(): ActiveRouteItem[] {
  const raw = storage.getString(CACHE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/** 사용자가 명시적으로 해제한 경로를 캐시에서 삭제 */
export function removeFromRouteCache(routeId: string) {
  const cache = loadRouteCache();
  storage.set(CACHE_KEY, JSON.stringify(cache.filter(r => r.routeId !== routeId)));
}

// ── Zustand 스토어 ────────────────────────────────────────────────
interface MonitoringState {
  activeRoutes: ActiveRouteItem[];

  activateRoute:   (item: ActiveRouteItem) => void;
  deactivateRoute: (routeId: string) => void;
  deactivateAll:   () => void;
  isRouteActive:   (routeId: string) => boolean;

  // 하위 호환 — RouteActiveScreen 이 monitoringRouteId / status 를 참조하는 경우
  routeId: string | null;
  status:  MonitoringStatus;
  waypoints: Waypoint[];
  activate: (
    routeId: string,
    waypoints: Waypoint[],
    departTime: string,
    startStopId?: string,
    startStopName?: string,
  ) => void;
  deactivate: () => void;
  setStatus: (status: MonitoringStatus) => void;
}

export const useMonitoringStore = create<MonitoringState>((set, get) => ({
  activeRoutes: loadActiveRoutes(),

  // ── 첫 번째 활성 경로 기반 하위 호환 필드 ──────────────────────
  routeId:   loadActiveRoutes()[0]?.routeId ?? null,
  status:    loadActiveRoutes().length > 0 ? 'active' : 'idle',
  waypoints: loadActiveRoutes()[0]?.waypoints ?? [],

  // ── 다중 경로 API ──────────────────────────────────────────────
  activateRoute: (item) => {
    set(state => {
      const updated = [
        ...state.activeRoutes.filter(r => r.routeId !== item.routeId),
        item,
      ];
      saveActiveRoutes(updated);
      return {
        activeRoutes: updated,
        routeId:   updated[0]?.routeId ?? null,
        waypoints: updated[0]?.waypoints ?? [],
        status:    updated.length > 0 ? 'active' : 'idle',
      };
    });
  },

  deactivateRoute: (routeId) => {
    set(state => {
      const updated = state.activeRoutes.filter(r => r.routeId !== routeId);
      saveActiveRoutes(updated);
      return {
        activeRoutes: updated,
        routeId:   updated[0]?.routeId ?? null,
        waypoints: updated[0]?.waypoints ?? [],
        status:    updated.length > 0 ? 'active' : 'idle',
      };
    });
  },

  deactivateAll: () => {
    clearActiveRoutes();
    set({ activeRoutes: [], routeId: null, status: 'idle', waypoints: [] });
  },

  isRouteActive: (routeId) =>
    get().activeRoutes.some(r => r.routeId === routeId),

  // ── 하위 호환 단일 경로 API ───────────────────────────────────
  activate: (routeId, waypoints, departTime, startStopId, startStopName) => {
    get().activateRoute({ routeId, waypoints, departTime, startStopId, startStopName });
  },

  deactivate: () => {
    const { routeId } = get();
    if (routeId) get().deactivateRoute(routeId);
  },

  setStatus: (status) => set({ status }),
}));
