import { NativeModules, Platform } from 'react-native';
import { loadMonitoringState } from '../store/useMonitoringStore';

const { WakeMeService } = NativeModules;

export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  type: 'transfer' | 'destination';
}

export function startNativeService(): void {
  if (Platform.OS !== 'android') return;
  const state = loadMonitoringState();
  if (!state || !state.waypoints?.length) return;
  WakeMeService?.start(
    state.routeId,
    JSON.stringify(state.waypoints),
    state.departTime ?? '',   // 출발시간 ±2시간 체크용
  );
}

export function stopNativeService(): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.stop();
}

/**
 * 모니터링 상태가 남아있으면 서비스를 재시작.
 * 앱 포그라운드 진입 시, 화면 포커스 시 호출.
 */
export function ensureServiceRunning(): void {
  if (Platform.OS !== 'android') return;
  const state = loadMonitoringState();
  if (!state?.waypoints?.length) return;
  // 서비스가 죽어 있어도 start 호출하면 안전하게 재시작됨
  WakeMeService?.start(
    state.routeId,
    JSON.stringify(state.waypoints),
    state.departTime ?? '',
  );
}

export function isLocationPermissionGranted(): boolean {
  if (Platform.OS !== 'android') return true;
  return WakeMeService?.isLocationPermissionGranted() ?? false;
}

export function scheduleDeparture(
  routeId: string,
  departTime: string,
  stopName: string,
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
