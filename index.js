/**
 * @format
 */

import 'react-native-url-polyfill/auto';

import { AppRegistry } from 'react-native';
import notifee from '@notifee/react-native';
import Geolocation from '@react-native-community/geolocation';

import { initCrashReporter, flushPendingCrashLog } from './src/utils/crashReporter';
import { loadMonitoringState, useMonitoringStore } from './src/store/useMonitoringStore';
import { getDistanceMeters, ALERT_DISTANCE } from './src/utils/geofence';
import { sendExitNotification, sendPrepareNotification } from './src/utils/notifications';
import App from './App';
import { name as appName } from './app.json';

initCrashReporter();
flushPendingCrashLog();

/**
 * 포그라운드 서비스 핸들러 — OS가 서비스를 시작할 때마다 호출됨
 *
 * GPS를 여기서 직접 실행해야 서비스 생명주기와 GPS가 동일하게 유지됨.
 * 알림이 지워지거나 서비스가 종료되면 이 Promise도 끝나고 GPS도 멈춤.
 * 앱이 서비스를 재시작하면 이 콜백이 다시 호출되어 GPS가 자동으로 재시작됨.
 */
notifee.registerForegroundService(() => {
  return new Promise(() => {
    console.log('[WAKE] FG서비스: 콜백 진입');

    const saved = loadMonitoringState();
    if (!saved || !saved.targetCoord) {
      console.log('[WAKE] FG서비스: 저장된 모니터링 상태 없음 — GPS 미시작');
      return;
    }

    console.log('[WAKE] FG서비스: GPS 시작 routeId=%s targetName=%s', saved.routeId, saved.targetName);

    const watchId = Geolocation.watchPosition(
      (pos) => {
        const store = useMonitoringStore.getState();
        if (!store.targetCoord) return;

        const dist = getDistanceMeters(
          { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          store.targetCoord,
        );
        store.setDistance(Math.round(dist));

        const prev = store.status;
        if (prev === 'done' || prev === 'exit_sent') return;

        if (dist <= ALERT_DISTANCE.EXIT) {
          console.log('[WAKE] FG서비스 GPS: 하차 알림 발송 dist=%dm', Math.round(dist));
          sendExitNotification(store.targetName);
          store.setStatus('exit_sent');
        } else if (dist <= ALERT_DISTANCE.PREPARE && prev === 'idle') {
          console.log('[WAKE] FG서비스 GPS: 준비 알림 발송 dist=%dm', Math.round(dist));
          sendPrepareNotification(store.targetName);
          store.setStatus('prepare_sent');
        }
      },
      (err) => console.warn('[WAKE] FG서비스 GPS 오류:', err),
      { enableHighAccuracy: true, interval: 5000, maximumAge: 3000, distanceFilter: 10 },
    );

    console.log('[WAKE] FG서비스: watchPosition 등록 완료 watchId=%s', watchId);

    // store에 activate → watchId 저장 (deactivate 시 clearWatch 가능)
    useMonitoringStore.getState().activate(
      saved.routeId,
      saved.targetCoord,
      saved.targetName,
      watchId,
      saved.departTime,
      saved.busNo,
      saved.startStopId,
      saved.startStopName,
    );
  });
});

AppRegistry.registerComponent(appName, () => App);
