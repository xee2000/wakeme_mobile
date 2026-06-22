/**
 * @format
 */

import 'react-native-url-polyfill/auto';

import * as Sentry from '@sentry/react-native';

// Sentry 초기화 — JS + 네이티브 크래시 + OOM 모두 캡처
Sentry.init({
  dsn: 'https://c92c017959b209c2ab91e44f99fa5f85@o4511272556953600.ingest.us.sentry.io/4511272557346816',
  tracesSampleRate: 0.2,
  // 릴리즈/환경 정보
  environment: __DEV__ ? 'development' : 'production',
  // 네이티브 크래시 캡처 활성화 (Android NDK)
  enableNativeCrashHandling: true,
});

import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';

import { initCrashReporter, flushPendingCrashLog } from './src/utils/crashReporter';
import App from './App';
import { name as appName } from './app.json';

initCrashReporter();
flushPendingCrashLog();

// WakeMeService(Kotlin)가 GPS를 처리하므로 여기서는 빈 Promise만 유지
// notifee FG서비스 타입 등록이 필요한 경우를 위해 핸들러는 남겨 둠
notifee.registerForegroundService(() => {
  return new Promise(() => {
    console.log('[WAKE] notifee FG서비스 핸들러 진입 (GPS는 WakeMeService가 담당)');
  });
});

AppRegistry.registerComponent(appName, () => App);
