import { create } from 'zustand';
import Geolocation from '@react-native-community/geolocation';
import notifee from '@notifee/react-native';
import { Coordinate } from '../utils/geofence';

export type MonitoringStatus = 'idle' | 'prepare_sent' | 'exit_sent' | 'done';

// 컴포넌트 생명주기 밖에서 watchId 보존
let _watchId: number | null = null;

interface MonitoringState {
  routeId: string | null;
  status: MonitoringStatus;
  distance: number | null;
  targetCoord: Coordinate | null;
  targetName: string;

  activate: (routeId: string, targetCoord: Coordinate | null, targetName: string, watchId: number) => void;
  deactivate: () => void;
  setDistance: (distance: number) => void;
  setStatus: (status: MonitoringStatus) => void;
}

export const useMonitoringStore = create<MonitoringState>((set) => ({
  routeId: null,
  status: 'idle',
  distance: null,
  targetCoord: null,
  targetName: '',

  activate: (routeId, targetCoord, targetName, watchId) => {
    _watchId = watchId;
    set({ routeId, targetCoord, targetName, status: 'idle', distance: null });
  },

  deactivate: () => {
    if (_watchId !== null) {
      Geolocation.clearWatch(_watchId);
      _watchId = null;
    }
    notifee.stopForegroundService();
    set({ routeId: null, status: 'idle', distance: null, targetCoord: null });
  },

  setDistance: (distance) => set({ distance }),
  setStatus: (status) => set({ status }),
}));
