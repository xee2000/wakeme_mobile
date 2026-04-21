import { create } from 'zustand';
import { Route, RouteSegment } from '../types';
import { fetchRoutes, saveRoute, deleteRoute } from '../api/routeApi';

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
  ) => Promise<void>;

  // 경로 삭제
  removeRoute: (routeId: string) => Promise<void>;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  routes: [],
  loading: false,
  error: null,

  loadRoutes: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const routes = await fetchRoutes(userId);
      set({ routes, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  addRoute: async (userId, name, departTime, segments) => {
    set({ loading: true, error: null });
    try {
      const newRoute = await saveRoute(userId, name, departTime, segments);
      set(state => ({ routes: [newRoute, ...state.routes], loading: false }));
    } catch (e: any) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  removeRoute: async (routeId: string) => {
    try {
      await deleteRoute(routeId);
      set(state => ({ routes: state.routes.filter(r => r.id !== routeId) }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },
}));
