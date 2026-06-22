/**
 * 런타임 크래시/에러를 Sentry + 서버 로그로 이중 전송하는 유틸
 *
 * 동작 원리:
 * 1. Sentry.init (index.js) — JS + 네이티브 크래시 + OOM 자동 캡처
 * 2. ErrorUtils.setGlobalHandler — JS uncaught 예외를 서버 로그파일에도 기록
 * 3. isFatal 크래시는 MMKV에 저장 → 다음 앱 시작 시 서버 전송 보장
 */

import { Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';
import * as Sentry from '@sentry/react-native';
import DeviceInfo from 'react-native-device-info';
import { RestApi } from '../api/RestApi';
import { useMonitoringStore } from '../store/useMonitoringStore';

const storage = new MMKV({ id: 'crash' });
const PENDING_KEY = 'wakeme_pending_crash';

interface CrashPayload {
  timestamp: string;
  message: string;
  stack: string;
  isFatal: boolean;
  platform: string;
  platformVersion: string | number;
  appVersion: string;
  monitoringRouteId: string | null;
}

function buildPayload(error: Error, isFatal: boolean): CrashPayload {
  const store = useMonitoringStore.getState();
  const activeIds = store.activeRoutes.map(r => r.routeId).join(',') || null;
  return {
    timestamp: new Date().toISOString(),
    message: error.message ?? String(error),
    stack: error.stack ?? '',
    isFatal,
    platform: Platform.OS,
    platformVersion: Platform.Version,
    appVersion: DeviceInfo.getVersion(),
    monitoringRouteId: activeIds,
  };
}

function sendPayload(payload: CrashPayload) {
  fetch(`${RestApi.BASE_URL}/api/log/crash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function savePending(payload: CrashPayload) {
  storage.set(PENDING_KEY, JSON.stringify(payload));
}

function loadPending(): CrashPayload | null {
  const raw = storage.getString(PENDING_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function clearPending() {
  storage.delete(PENDING_KEY);
}

/** 앱 시작 시 이전 fatal 크래시 로그가 있으면 서버로 전송 */
export function flushPendingCrashLog() {
  const pending = loadPending();
  if (!pending) return;
  clearPending();
  sendPayload(pending);
}

/** index.js 최상단에서 1회 호출 */
export function initCrashReporter() {
  const previousHandler = ErrorUtils.getGlobalHandler();

  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    const fatal = isFatal ?? false;
    const payload = buildPayload(error, fatal);

    // Sentry에도 전송 (네이티브 크래시는 Sentry가 자동으로 처리)
    Sentry.captureException(error, {
      level: fatal ? 'fatal' : 'error',
      extra: {
        isFatal: fatal,
        monitoringRouteId: payload.monitoringRouteId,
      },
    });

    if (fatal) {
      savePending(payload);
    }
    sendPayload(payload);

    previousHandler(error, isFatal);
  });
}
