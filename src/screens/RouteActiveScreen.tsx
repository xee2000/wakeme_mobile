import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRouteStore } from '../store/useRouteStore';
import { RootStackParamList, RouteSegment } from '../types';
import { getDistanceMeters, ALERT_DISTANCE, Coordinate } from '../utils/geofence';
import notifee, { AndroidImportance } from '@notifee/react-native';
import {
  setupNotificationChannel,
  sendPrepareNotification,
  sendExitNotification,
  requestNotificationPermission,
} from '../utils/notifications';
import { fetchStopsByRouteName } from '../api/busApi';

const FG_NOTIFICATION_ID = 'wakeme_tracking';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteActive'>;
type AlertState = 'idle' | 'prepare_sent' | 'exit_sent' | 'done';

export default function RouteActiveScreen({ route, navigation }: Props) {
  const { routeId } = route.params;
  const insets = useSafeAreaInsets();
  const routes = useRouteStore(s => s.routes);
  const targetRoute = routes.find(r => r.id === routeId);

  const [status, setStatus] = useState<AlertState>('idle');
  const [distance, setDistance] = useState<number | null>(null);
  const [targetCoord, setTargetCoord] = useState<Coordinate | null>(null);
  const [targetName, setTargetName] = useState<string>('');
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!targetRoute) return;
    const lastSeg: RouteSegment = targetRoute.segments[targetRoute.segments.length - 1];
    const stopName =
      lastSeg.mode === 'bus' ? lastSeg.end_stop_name ?? '' : lastSeg.end_station ?? '';
    setTargetName(stopName);
    init(lastSeg, stopName);

    return () => {
      if (watchId.current !== null) Geolocation.clearWatch(watchId.current);
      notifee.stopForegroundService();
    };
  }, []);

  const init = async (lastSeg: RouteSegment, stopName: string) => {
    await setupNotificationChannel();
    await requestNotificationPermission();

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('위치 권한 필요', '하차 알림을 위해 위치 권한이 필요합니다.');
        navigation.goBack();
        return;
      }
      if (parseInt(String(Platform.Version), 10) >= 29) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        );
      }
    } else {
      const auth = await Geolocation.requestAuthorization('always');
      if (auth !== 'granted') {
        Alert.alert('위치 권한 필요', '하차 알림을 위해 위치 권한이 필요합니다.');
        navigation.goBack();
        return;
      }
    }

    if (lastSeg.mode === 'bus' && lastSeg.bus_no) {
      const stops = await fetchStopsByRouteName(lastSeg.bus_no);
      const target = stops.find(
        s => s.nodeName.includes(stopName) || stopName.includes(s.nodeName),
      );
      if (target) {
        setTargetCoord({ latitude: target.gpslati, longitude: target.gpslong });
      }
    }

    try {
      // notifee 포그라운드 서비스 채널 생성 및 서비스 시작
      const channelId = await notifee.createChannel({
        id: 'tracking',
        name: '하차 알림 서비스',
        importance: AndroidImportance.HIGH,
      });

      await notifee.displayNotification({
        id: FG_NOTIFICATION_ID,
        title: 'WakeMe 모니터링 중 🚌',
        body: stopName ? `${stopName} 접근 시 알림드립니다` : '하차 지점 모니터링 중...',
        android: {
          channelId,
          asForegroundService: true,
          smallIcon: 'ic_notification',
          color: '#1A73E8',
          ongoing: true,
          pressAction: { id: 'default' },
        },
      });

      // GPS 추적 시작
      watchId.current = Geolocation.watchPosition(
        pos => handlePosition(pos.coords.latitude, pos.coords.longitude),
        err => console.warn('[GPS]', err),
        {
          enableHighAccuracy: true,
          interval: 5000,
          maximumAge: 3000,
          showsBackgroundLocationIndicator: true,
        },
      );
    } catch (e) {
      console.warn('[GPS] 시작 실패:', e);
      Alert.alert('오류', '위치 추적을 시작할 수 없습니다. 위치 권한을 확인해주세요.');
    }
  };

  const handlePosition = (lat: number, lon: number) => {
    if (!targetCoord) return;
    const dist = getDistanceMeters({ latitude: lat, longitude: lon }, targetCoord);
    setDistance(Math.round(dist));

    setStatus(prev => {
      if (prev === 'done' || prev === 'exit_sent') return prev;
      if (dist <= ALERT_DISTANCE.EXIT) {
        sendExitNotification(targetName);
        if (watchId.current !== null) Geolocation.clearWatch(watchId.current);
        return 'exit_sent';
      }
      if (dist <= ALERT_DISTANCE.PREPARE && prev === 'idle') {
        sendPrepareNotification(targetName);
        return 'prepare_sent';
      }
      return prev;
    });
  };

  const handleStop = () => {
    if (watchId.current !== null) Geolocation.clearWatch(watchId.current);
    navigation.goBack();
  };

  if (!targetRoute) {
    return (
      <View style={styles.center}>
        <Text>경로를 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const statusLabel: Record<AlertState, string> = {
    idle: '🟢 모니터링 중',
    prepare_sent: '🟡 준비 알림 전송됨',
    exit_sent: '🔴 하차 알림 전송됨',
    done: '✅ 완료',
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.card}>
        <Text style={styles.routeName}>{targetRoute.name}</Text>
        <Text style={styles.dest}>목적지: {targetName || '–'}</Text>
        <Text style={styles.statusText}>{statusLabel[status]}</Text>

        {distance !== null && (
          <View style={styles.distanceBox}>
            <Text style={styles.distanceNum}>{distance.toLocaleString()}</Text>
            <Text style={styles.distanceUnit}>m 남음</Text>
          </View>
        )}

        <View style={styles.legend}>
          <Text style={styles.legendItem}>· 500m 이내 → 준비 알림</Text>
          <Text style={styles.legendItem}>· 200m 이내 → 하차 알림</Text>
        </View>
      </View>

      {status === 'exit_sent' ? (
        <TouchableOpacity style={styles.doneBtn} onPress={handleStop}>
          <Text style={styles.doneBtnText}>완료 – 홈으로</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
          <Text style={styles.stopBtnText}>알림 중단</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 16,
  },
  routeName: { fontSize: 22, fontWeight: '800', color: '#1A73E8', marginBottom: 8 },
  dest: { fontSize: 15, color: '#555', marginBottom: 24 },
  statusText: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 24 },
  distanceBox: { alignItems: 'center', marginBottom: 24 },
  distanceNum: { fontSize: 64, fontWeight: '900', color: '#1A73E8' },
  distanceUnit: { fontSize: 20, color: '#555', marginTop: -8 },
  legend: { marginTop: 8 },
  legendItem: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 22 },
  stopBtn: {
    height: 52,
    backgroundColor: '#E53935',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  doneBtn: {
    height: 52,
    backgroundColor: '#34A853',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
