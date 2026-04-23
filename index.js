/**
 * @format
 */

// Supabase가 React Native에서 URL 객체를 올바르게 사용하도록 폴리필 (최상단 필수)
import 'react-native-url-polyfill/auto';

import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';

// notifee 포그라운드 서비스 핸들러 — 서비스가 살아있는 동안 Promise가 유지됨
notifee.registerForegroundService(() => {
  return new Promise(() => {
    // 서비스가 명시적으로 중단될 때까지 유지
  });
});

AppRegistry.registerComponent(appName, () => App);
