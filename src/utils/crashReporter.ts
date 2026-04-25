/**
 * 런타임 크래시/에러를 서버로 전송하는 유틸
 *
 * 동작 원리:
 * 1. ErrorUtils.setGlobalHandler — JS uncaught 예외 캡처
 * 2. isFatal 크래시는 MMKV에 저장 → 다음 앱 시작 시 전송 (죽기 전엔 네트워크 보장 안됨)
 * 3. non-fatal 에러는 즉시 fire-and-forget으로 전송
 */

import { Platform } from 'react-native';
import { MMKV } from 'react-native-mmkv';
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
  monitoringRouteId: string | null;
}

function buildPayload(error: Error, isFatal: boolean): CrashPayload {
  const store = useMonitoringStore.getState();
  return {
    timestamp: new Date().toISOString(),
    message: error.message ?? String(error),
    stack: error.stack ?? '',
    isFatal,
    platform: Platform.OS,
    platformVersion: Platform.Version,
    monitoringRouteId: store.routeId,
  };
}

function sendPayload(payload: CrashPayload) {
  // fire-and-forget — 앱 종료 직전이라 완료 보장 안 됨
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

/** 앱 시작 시 이전 fatal 크래시 로그가 있으면 전송 */
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

    if (fatal) {
      // fatal: MMKV에 먼저 저장 (다음 시작 시 전송 보장)
      savePending(payload);
    }
    // 어쨌든 지금도 전송 시도
    sendPayload(payload);

    // 원래 핸들러(React Native 기본 동작) 호출
    previousHandler(error, isFatal);
  });
}
