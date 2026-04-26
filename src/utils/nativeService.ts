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
  WakeMeService?.start(state.routeId, JSON.stringify(state.waypoints));
}

export function stopNativeService(): void {
  if (Platform.OS !== 'android') return;
  WakeMeService?.stop();
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
