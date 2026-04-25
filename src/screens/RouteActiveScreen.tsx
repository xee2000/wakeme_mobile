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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRouteStore } from '../store/useRouteStore';
import { useMonitoringStore, saveMonitoringState } from '../store/useMonitoringStore';
import { RootStackParamList, RouteSegment } from '../types';
import notifee, { AndroidForegroundServiceType } from '@notifee/react-native';
import {
  setupNotificationChannel,
  sendBusArrivalNotification,
  requestNotificationPermission,
  CHANNEL_TRACKING,
} from '../utils/notifications';
import { fetchStopsByRouteName, fetchArrivingBuses } from '../api/busApi';
import { RestApi } from '../api/RestApi';
import { useAuthStore } from '../store/useAuthStore';

const FG_NOTIFICATION_ID = 'wakeme_tracking';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteActive'>;

export default function RouteActiveScreen({ route, navigation }: Props) {
  const { routeId } = route.params;
  const insets = useSafeAreaInsets();
  const routes = useRouteStore(s => s.routes);
  const user   = useAuthStore(s => s.user);
  const targetRoute = routes.find(r => r.id === routeId);

  const monitoringRouteId = useMonitoringStore(s => s.routeId);
  const status = useMonitoringStore(s => s.status);
  const distance = useMonitoringStore(s => s.distance);
  const { deactivate } = useMonitoringStore.getState();

  const isMonitoring = monitoringRouteId === routeId;

  const [targetName, setTargetName] = useState('');
  const departTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!targetRoute) return;
    const lastSeg: RouteSegment = targetRoute.segments[targetRoute.segments.length - 1];
    const name = lastSeg.mode === 'bus' ? lastSeg.end_stop_name ?? '' : lastSeg.end_station ?? '';
    setTargetName(name);
  }, [targetRoute?.id]);

  useEffect(() => {
    return () => {
      if (departTimerRef.current) clearTimeout(departTimerRef.current);
    };
  }, []);

  const startMonitoring = async () => {
    if (!targetRoute) return;
    const lastSeg: RouteSegment = targetRoute.segments[targetRoute.segments.length - 1];
    const stopName = lastSeg.mode === 'bus' ? lastSeg.end_stop_name ?? '' : lastSeg.end_station ?? '';

    await setupNotificationChannel();
    await requestNotificationPermission();

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('위치 권한 필요', '하차 알림을 위해 위치 권한이 필요합니다.');
        return;
      }
      if (parseInt(String(Platform.Version), 10) >= 29) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        );
      }
    }

    const busNos = targetRoute.segments
      .filter(s => s.mode === 'bus' && s.bus_no)
      .map(s => s.bus_no as string);

    RestApi.post('/api/notify/start', {
      userId:      user?.id ?? 'unknown',
      routeName:   targetRoute.name,
      busNos,
      endStopName: stopName,
      departTime:  targetRoute.depart_time,
    }).catch(e => console.warn('[WAKE] 서버 로그 전송 실패:', e));

    // ── 첫 번째 버스 구간 정보 ──
    const firstBusSeg = targetRoute.segments.find(s => s.mode === 'bus' && s.bus_no);

    // ── 하차 정류장 좌표 조회 ──
    let targetCoord: { latitude: number; longitude: number } | null = null;
    if (lastSeg.mode === 'bus' && lastSeg.bus_no) {
      try {
        const stops = await fetchStopsByRouteName(lastSeg.bus_no);
        const found = stops.find(
          s => s.nodeName.includes(stopName) || stopName.includes(s.nodeName),
        );
        if (found) {
          targetCoord = { latitude: found.gpslati, longitude: found.gpslong };
        }
      } catch (e) {
        console.warn('[WAKE] 정류장 조회 실패:', e);
      }
    }

    // ── MMKV에 상태 저장 → registerForegroundService 콜백이 이걸 읽어 GPS 시작 ──
    if (targetCoord) {
      saveMonitoringState({
        routeId,
        targetCoord,
        targetName: stopName,
        departTime: targetRoute.depart_time,
        busNo: firstBusSeg?.bus_no,
        startStopId: firstBusSeg?.start_stop_id,
        startStopName: firstBusSeg?.start_stop_name,
      });
      console.log('[WAKE] 모니터링 상태 저장 완료 routeId=%s', routeId);
    } else {
      console.warn('[WAKE] targetCoord 없음 — 하차 감지 불가');
    }

    // ── 출발 시간에 버스 도착 정보 알림 예약 ──
    if (firstBusSeg?.bus_no) {
      scheduleBusArrivalAlert(
        targetRoute.depart_time,
        firstBusSeg.bus_no,
        firstBusSeg.start_stop_id,
        firstBusSeg.start_stop_name ?? '',
        departTimerRef,
      );
    }

    try {
      // 이전 서비스 정리
      try { await notifee.stopForegroundService(); } catch (_) {}

      // 포그라운드 서비스 알림 표시 → OS가 서비스 시작 → registerForegroundService 콜백 호출 → GPS 시작
      await notifee.displayNotification({
        id: FG_NOTIFICATION_ID,
        title: 'WakeMe 모니터링 중',
        body: stopName ? `${stopName} 하차 감지 중` : '하차 지점 모니터링 중...',
        android: {
          channelId: CHANNEL_TRACKING,
          asForegroundService: true,
          foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION],
          smallIcon: 'ic_launcher',
          color: '#1A73E8',
          ongoing: true,
          autoCancel: false,
          pressAction: { id: 'default' },
        },
      });
      console.log('[WAKE] 포그라운드 서비스 알림 표시 완료');
    } catch (e: any) {
      console.error('[WAKE] 포그라운드 서비스 시작 실패:', e);
      Alert.alert('오류', `모니터링 시작 실패\n${e?.message ?? String(e)}`);
    }
  };

  if (!targetRoute) {
    return (
      <View style={styles.center}>
        <Text>경로를 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const statusLabel = {
    idle: '🟢 모니터링 중',
    prepare_sent: '🟡 준비 알림 전송됨',
    exit_sent: '🔴 하차 알림 전송됨',
    done: '✅ 완료',
  };

  if (isMonitoring) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.card}>
          <Text style={styles.routeName}>{targetRoute.name}</Text>
          <Text style={styles.dest}>목적지  {targetName || '–'}</Text>
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
          <TouchableOpacity style={styles.doneBtn} onPress={() => { deactivate(); navigation.goBack(); }}>
            <Text style={styles.doneBtnText}>완료 – 홈으로</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopBtn} onPress={deactivate}>
            <Text style={styles.stopBtnText}>알림 중단</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.card}>
        <Text style={styles.routeName}>{targetRoute.name}</Text>
        <Text style={styles.departTime}>출발 시간  {targetRoute.depart_time}</Text>
        <Text style={styles.dest}>목적지  {targetName || '–'}</Text>

        <View style={styles.divider} />

        <Text style={styles.segmentTitle}>구간 정보</Text>
        {targetRoute.segments.map((seg, i) => (
          <View key={i} style={styles.segmentRow}>
            <Text style={styles.segmentBadge}>{seg.mode === 'bus' ? '🚌' : '🚇'}</Text>
            <View style={{ flex: 1 }}>
              {seg.mode === 'bus' ? (
                <>
                  <Text style={styles.segmentMain}>{seg.bus_no ?? ''} 번</Text>
                  <Text style={styles.segmentSub}>
                    {seg.start_stop_name || '–'} → {seg.end_stop_name || '–'}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.segmentMain}>{seg.line_name ?? ''}</Text>
                  <Text style={styles.segmentSub}>
                    {seg.start_station || '–'} → {seg.end_station || '–'}
                  </Text>
                </>
              )}
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.startBtn} onPress={startMonitoring}>
        <Text style={styles.startBtnText}>알림 시작</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.editBtn}
        onPress={() => navigation.navigate('RouteRegister', { routeId })}>
        <Text style={styles.editBtnText}>경로 수정</Text>
      </TouchableOpacity>
    </View>
  );
}

function scheduleBusArrivalAlert(
  departTime: string,
  busNo: string,
  startStopId: string | undefined,
  startStopName: string,
  timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
) {
  const [dHour, dMin] = departTime.split(':').map(Number);
  const now = new Date();
  const departAt = new Date();
  departAt.setHours(dHour, dMin, 0, 0);

  const msUntilDepart = departAt.getTime() - now.getTime();
  if (msUntilDepart <= 0 || msUntilDepart > 4 * 60 * 60 * 1000) return;

  timerRef.current = setTimeout(async () => {
    try {
      let arrivalMin: number | null = null;
      if (startStopId) {
        const buses = await fetchArrivingBuses(startStopId);
        const myBus = buses.find((b: any) => {
          const rNo = String(b.routeno ?? b.routeNo ?? b.routeId ?? '');
          return rNo === busNo;
        });
        if (myBus) {
          const arrSec = myBus.arrtime ?? myBus.arrivalTime ?? myBus.predictTime1 ?? null;
          if (arrSec != null) arrivalMin = Math.ceil(Number(arrSec) / 60);
        }
      }
      await sendBusArrivalNotification(busNo, arrivalMin, startStopName);
    } catch (e) {
      console.warn('[WAKE] 버스 도착 정보 조회 실패:', e);
      await sendBusArrivalNotification(busNo, null, startStopName).catch(() => {});
    }
  }, msUntilDepart);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 16,
  },
  routeName: { fontSize: 22, fontWeight: '800', color: '#1A73E8', marginBottom: 6 },
  departTime: { fontSize: 14, color: '#888', marginBottom: 4 },
  dest: { fontSize: 15, color: '#555', marginBottom: 16 },
  divider: { height: 1, backgroundColor: '#EEE', marginBottom: 16 },
  segmentTitle: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 10 },
  segmentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  segmentBadge: { fontSize: 20, marginTop: 1 },
  segmentMain: { fontSize: 15, fontWeight: '700', color: '#222' },
  segmentSub: { fontSize: 13, color: '#777', marginTop: 2 },
  statusText: { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 24, marginTop: 8 },
  distanceBox: { alignItems: 'center', marginBottom: 24 },
  distanceNum: { fontSize: 64, fontWeight: '900', color: '#1A73E8' },
  distanceUnit: { fontSize: 20, color: '#555', marginTop: -8 },
  legend: { marginTop: 8 },
  legendItem: { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 22 },
  startBtn: {
    height: 52,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  editBtn: {
    height: 52,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1A73E8',
  },
  editBtnText: { color: '#1A73E8', fontWeight: '700', fontSize: 16 },
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
