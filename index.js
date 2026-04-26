/**
 * @format
 */

import 'react-native-url-polyfill/auto';

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
