import { create } from 'zustand';
import { Route, RouteSegment } from '../types';
import { fetchRoutes, saveRoute, updateRoute as apiUpdateRoute, deleteRoute } from '../api/routeApi';
import { stopRouteMonitoring, cancelDeparture } from '../utils/nativeService';
import { cancelDepartureNotification } from '../utils/notifications';
import { removeFromRouteCache } from './useMonitoringStore';

interface RouteState {
  routes: Route[];
  loading: boolean;
  error: string | null;

  // 경로 목록 불러오기
  loadRoutes: (userId: string) => Promise<void>;

  // 경로 저장
  addRoute: (
    userId: string,
    name: string,
    departTime: string,
    segments: Omit<RouteSegment, 'id' | 'route_id'>[],
    finalDest?: { name: string; lat: number; lng: number } | null,
    daysOfWeek?: number[],
  ) => Promise<void>;

  // 경로 수정
  updateRoute: (
    routeId: string,
    name: string,
    departTime: string,
    segments: Omit<RouteSegment, 'id' | 'route_id'>[],
    finalDest?: { name: string; lat: number; lng: number } | null,
    daysOfWeek?: number[],
  ) => Promise<void>;

  // 경로 삭제
  removeRoute: (routeId: string) => Promise<void>;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  routes: [],
  loading: false,
  error: null,

  loadRoutes: async (userId: string) => {
    // 이미 로딩 중이면 중복 요청 스킵 (화면 전환 시 동시 호출 방지)
    if (get().loading) return;
    // 기존 데이터가 없을 때만 스피너 표시 — 있으면 조용히 백그라운드 새로고침
    // (스피너가 FlatList를 언마운트하면 Fabric 렌더러가 기존 뷰 태그를 잃어버려 RetryableMountingLayerException 발생)
    const showSpinner = get().routes.length === 0;
    if (showSpinner) set({ loading: true, error: null });
    try {
      const routes = await fetchRoutes(userId);
      set({ routes, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  addRoute: async (userId, name, departTime, segments, finalDest, daysOfWeek) => {
    set({ loading: true, error: null });
    try {
      const newRoute = await saveRoute(userId, name, departTime, segments, finalDest, daysOfWeek);
      set(state => ({ routes: [newRoute, ...state.routes], loading: false }));
    } catch (e: any) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  updateRoute: async (routeId, name, departTime, segments, finalDest, daysOfWeek) => {
    set({ loading: true, error: null });
    try {
      const updated = await apiUpdateRoute(routeId, name, departTime, segments, finalDest, daysOfWeek);
      set(state => ({
        routes: state.routes.map(r => (r.id === routeId ? updated : r)),
        loading: false,
      }));
    } catch (e: any) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  removeRoute: async (routeId: string) => {
    try {
      await deleteRoute(routeId);
      // 모니터링 중이면 즉시 중단 + 영구 캐시에서도 제거
      stopRouteMonitoring(routeId);
      removeFromRouteCache(routeId);
      // AlarmManager 알람 취소
      cancelDeparture(routeId);
      // Notifee 트리거 알림 취소
      cancelDepartureNotification(routeId).catch(() => {});
      set(state => ({ routes: state.routes.filter(r => r.id !== routeId) }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },
}));
