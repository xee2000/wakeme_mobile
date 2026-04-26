import { create } from 'zustand';
import { MMKV } from 'react-native-mmkv';
import { stopNativeService, Waypoint } from '../utils/nativeService';

export type MonitoringStatus = 'idle' | 'active' | 'done';

const storage = new MMKV({ id: 'monitoring' });
const PERSIST_KEY = 'wakeme_monitoring_state';

interface PersistedMonitoringState {
  routeId: string;
  waypoints: Waypoint[];
  departTime: string;
  startStopId?: string;
  startStopName?: string;
}

interface MonitoringState {
  routeId: string | null;
  status: MonitoringStatus;
  waypoints: Waypoint[];
  departTime: string | null;
  startStopId: string | null;
  startStopName: string | null;

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

export function saveMonitoringState(state: PersistedMonitoringState) {
  storage.set(PERSIST_KEY, JSON.stringify(state));
}

export function loadMonitoringState(): PersistedMonitoringState | null {
  const raw = storage.getString(PERSIST_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function clearMonitoringState() {
  storage.delete(PERSIST_KEY);
}

export const useMonitoringStore = create<MonitoringState>((set) => ({
  routeId: null,
  status: 'idle',
  waypoints: [],
  departTime: null,
  startStopId: null,
  startStopName: null,

  activate: (routeId, waypoints, departTime, startStopId, startStopName) => {
    set({
      routeId,
      waypoints,
      status: 'active',
      departTime,
      startStopId: startStopId ?? null,
      startStopName: startStopName ?? null,
    });
  },

  deactivate: () => {
    stopNativeService();
    clearMonitoringState();
    set({
      routeId: null,
      status: 'idle',
      waypoints: [],
      departTime: null,
      startStopId: null,
      startStopName: null,
    });
  },

  setStatus: (status) => set({ status }),
}));
