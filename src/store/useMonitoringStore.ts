import { create } from 'zustand';
import Geolocation from '@react-native-community/geolocation';
import notifee from '@notifee/react-native';
import { MMKV } from 'react-native-mmkv';
import { Coordinate } from '../utils/geofence';

export type MonitoringStatus = 'idle' | 'prepare_sent' | 'exit_sent' | 'done';

const storage = new MMKV({ id: 'monitoring' });
const PERSIST_KEY = 'wakeme_monitoring_state';

// 컴포넌트 생명주기 밖에서 watchId 보존
let _watchId: number | null = null;

interface PersistedMonitoringState {
  routeId: string;
  targetCoord: Coordinate;
  targetName: string;
  departTime: string; // "HH:MM"
  busNo?: string;
  startStopId?: string;
  startStopName?: string;
}

interface MonitoringState {
  routeId: string | null;
  status: MonitoringStatus;
  distance: number | null;
  targetCoord: Coordinate | null;
  targetName: string;
  departTime: string | null;
  busNo: string | null;
  startStopId: string | null;
  startStopName: string | null;

  activate: (
    routeId: string,
    targetCoord: Coordinate | null,
    targetName: string,
    watchId: number,
    departTime: string,
    busNo?: string,
    startStopId?: string,
    startStopName?: string,
  ) => void;
  deactivate: () => void;
  setDistance: (distance: number) => void;
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
  distance: null,
  targetCoord: null,
  targetName: '',
  departTime: null,
  busNo: null,
  startStopId: null,
  startStopName: null,

  activate: (routeId, targetCoord, targetName, watchId, departTime, busNo, startStopId, startStopName) => {
    _watchId = watchId;
    set({ routeId, targetCoord, targetName, status: 'idle', distance: null, departTime, busNo: busNo ?? null, startStopId: startStopId ?? null, startStopName: startStopName ?? null });
    if (targetCoord) {
      saveMonitoringState({ routeId, targetCoord, targetName, departTime, busNo, startStopId, startStopName });
    }
  },

  deactivate: () => {
    if (_watchId !== null) {
      Geolocation.clearWatch(_watchId);
      _watchId = null;
    }
    notifee.stopForegroundService();
    clearMonitoringState();
    set({ routeId: null, status: 'idle', distance: null, targetCoord: null, departTime: null, busNo: null, startStopId: null, startStopName: null });
  },

  setDistance: (distance) => set({ distance }),
  setStatus: (status) => set({ status }),
}));
