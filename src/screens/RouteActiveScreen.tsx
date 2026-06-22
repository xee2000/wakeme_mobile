import React, { useEffect, useState } from 'react';
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
import { useMonitoringStore } from '../store/useMonitoringStore';
import { RootStackParamList, RouteSegment } from '../types';
import { requestNotificationPermission, scheduleDepartureNotification } from '../utils/notifications';
import {
  startRouteMonitoring,
  stopRouteMonitoring,
  isLocationPermissionGranted,
  scheduleDeparture,
  cancelDeparture,
  Waypoint,
} from '../utils/nativeService';
import { RestApi } from '../api/RestApi';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../api/supabaseClient';
import { findKtxStation } from '../data/ktxStations';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteActive'>;

export default function RouteActiveScreen({ route, navigation }: Props) {
  const { routeId } = route.params;
  const insets = useSafeAreaInsets();
  const routes = useRouteStore(s => s.routes);
  const user = useAuthStore(s => s.user);
  const targetRoute = routes.find(r => r.id === routeId);

  // ── 다중 경로 모니터링 상태 ──────────────────────────────────────
  const isMonitoring = useMonitoringStore(s => s.isRouteActive(routeId));
  const activeRoutes = useMonitoringStore(s => s.activeRoutes);
  const activeItem   = activeRoutes.find(r => r.routeId === routeId);

  const [targetName, setTargetName] = useState('');
  useEffect(() => {
    if (!targetRoute) return;
    const lastSeg: RouteSegment =
      targetRoute.segments[targetRoute.segments.length - 1];
    setTargetName(lastSeg.end_stop_name ?? '');
  }, [targetRoute?.id]);

  // ── 모니터링 시작 ────────────────────────────────────────────────
  const startMonitoring = async () => {
    if (!targetRoute) {
      console.log('[WAKE][ERROR] targetRoute 없음');
      return;
    }
    // 기존 AlarmManager 알람 모두 초기화 후 재등록 (주말 오발동 방지)
    cancelDeparture(routeId);

    console.log('[WAKE][ROUTE]', JSON.stringify(targetRoute, null, 2));

    const lastSeg: RouteSegment =
      targetRoute.segments[targetRoute.segments.length - 1];
    const stopName = lastSeg.end_stop_name ?? '';

    await requestNotificationPermission();

    // ── 위치 권한 ────────────────────────────────────────────────
    if (Platform.OS === 'android') {
      const alreadyGranted = isLocationPermissionGranted();
      if (!alreadyGranted) {
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
    }

    // ── 서버 로그 ────────────────────────────────────────────────
    try {
      await RestApi.post('/api/notify/start', {
        userId: user?.id ?? 'unknown',
        routeName: targetRoute.name,
        endStopName: stopName,
        departTime: targetRoute.depart_time,
      });
    } catch (e) {
      console.warn('[WAKE][API] 실패:', e);
    }

    // ── 첫 번째 버스 구간 (출발 알림용) ──────────────────────────
    const firstBusSeg = targetRoute.segments.find(s => s.mode === 'bus');

    // ── Supabase에서 버스 정류장 좌표 조회 ───────────────────────
    const waypoints: Waypoint[] = [];

    const allSegs = targetRoute.segments
      .slice()
      .sort((a, b) => a.order_index - b.order_index);

    for (let i = 0; i < allSegs.length; i++) {
      const seg           = allSegs[i];
      const isDestination = i === allSegs.length - 1;
      const nextSeg       = allSegs[i + 1];
      const nextMode      = isDestination ? undefined : nextSeg?.mode;
      const nextStopId    = nextSeg?.start_stop_id ?? undefined;
      const nextStopName  = nextSeg?.start_stop_name ?? undefined;

      if (seg.end_stop_name && seg.end_stop_id) {
        const name   = seg.end_stop_name;
        const nodeId = seg.end_stop_id;

        if (seg.mode === 'ktx') {
          // KTX 역: 로컬 데이터에서 좌표 조회 (Supabase 불필요)
          const station = findKtxStation(nodeId);
          if (station) {
            waypoints.push({
              id: `wp_${i}`, lat: station.lat, lng: station.lng, name: `${name}역`,
              type: isDestination ? 'destination' : 'transfer',
              ...(nextMode     && { nextMode }),
              ...(nextStopId   && { nextStopId }),
              ...(nextStopName && { nextStopName }),
            });
            console.log('[WAKE][WAYPOINT] KTX', name, station.lat, station.lng, '→ next:', nextMode);
          } else {
            console.warn('[WAKE][WARN] KTX 역 미발견:', nodeId);
          }
        } else {
          // 버스 정류장: Supabase에서 좌표 조회
          try {
            const { data } = await supabase
              .from('bus_stops')
              .select('lat, lng')
              .eq('node_id', nodeId)
              .maybeSingle();

            if (data) {
              waypoints.push({
                id: `wp_${i}`, lat: data.lat, lng: data.lng, name,
                type: isDestination ? 'destination' : 'transfer',
                ...(nextMode     && { nextMode }),
                ...(nextStopId   && { nextStopId }),
                ...(nextStopName && { nextStopName }),
              });
              console.log('[WAKE][WAYPOINT] 버스', name, nodeId, data.lat, data.lng, '→ next:', nextMode);
            } else {
              console.warn('[WAKE][WARN] bus_stops 미발견 node_id:', nodeId, name);
            }
          } catch (e) {
            console.warn('[WAKE][ERROR] bus_stops 조회 실패:', e);
          }
        }
      }
    }

    if (waypoints.length === 0) {
      console.warn('[WAKE][CRITICAL] waypoints 없음 → 지오펜스 미등록');
    }

    // ── 최종 목적지 waypoint 추가 (설정된 경우) ────────────────────
    // 정류장/역 하차 후 실제 목적지(집·회사 등)에 도달하면 모니터링 자동 종료
    if (targetRoute.final_dest_lat && targetRoute.final_dest_lng) {
      // 기존 마지막 transit waypoint는 type을 'transfer'로 변경 (서비스 종료 막기)
      if (waypoints.length > 0) {
        waypoints[waypoints.length - 1] = {
          ...waypoints[waypoints.length - 1],
          type: 'transfer',
        };
      }
      waypoints.push({
        id:   'wp_final_dest',
        lat:  targetRoute.final_dest_lat,
        lng:  targetRoute.final_dest_lng,
        name: targetRoute.final_dest_name ?? '최종 목적지',
        type: 'destination',  // destination 타입 = 도달 시 서비스 종료
      });
      console.log('[WAKE][WAYPOINT] 최종 목적지 추가:', targetRoute.final_dest_name,
        targetRoute.final_dest_lat, targetRoute.final_dest_lng);
    }

    // ── 모니터링 시작 ─────────────────────────────────────────────
    const firstSeg = allSegs[0];
    startRouteMonitoring({
      routeId,
      routeName:     targetRoute.name,
      waypoints,
      departTime:    targetRoute.depart_time,
      startStopId:   firstSeg?.start_stop_id   ?? undefined,
      startStopName: firstSeg?.start_stop_name ?? undefined,
      daysOfWeek:    targetRoute.days_of_week,
    });

    // ── 출발 시간 알림 예약 (운행 요일 반영) ──────────────────────
    if (firstSeg?.start_stop_id) {
      scheduleDeparture(
        routeId,
        targetRoute.depart_time,
        firstSeg.start_stop_name ?? '',
        firstSeg.start_stop_id,
      );
    }
    scheduleDepartureNotification(
      routeId,
      targetRoute.name,
      targetRoute.depart_time,
      targetRoute.days_of_week,
    ).catch(e => console.warn('[WAKE] 출발 알림 예약 실패:', e));
  };

  // ── 모니터링 중단 ────────────────────────────────────────────────
  const stopMonitoring = () => {
    // AlarmManager 알람 취소 → 서비스 중지 → 재시작 방지
    cancelDeparture(routeId);
    stopRouteMonitoring(routeId);
    console.log('[WAKE] 모니터링 중단: AlarmManager 취소 + 서비스 정지');
  };

  // ── 경로 없음 ────────────────────────────────────────────────────
  if (!targetRoute) {
    return (
      <View style={styles.center}>
        <Text>경로를 찾을 수 없습니다.</Text>
      </View>
    );
  }

  // ── 모니터링 중 화면 ─────────────────────────────────────────────
  if (isMonitoring) {
    const activeWaypoints = activeItem?.waypoints ?? [];

    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.card}>
          <Text style={styles.routeName}>{targetRoute.name}</Text>
          <Text style={styles.dest}>목적지 {targetName || '–'}</Text>
          <Text style={styles.statusText}>🟢 경로 안내 작동중</Text>

          {activeItem?.departTime ? (
            <Text style={styles.departBadge}>
              출발 {activeItem.departTime} 기준 ±10분~2시간 알림 활성
            </Text>
          ) : null}

          <View style={styles.legend}>
            {activeWaypoints.map((wp, i) => (
              <Text key={i} style={styles.legendItem}>
                {wp.type === 'destination' ? '🏁' : '🔄'} {wp.name}
                {'  '}({wp.type === 'destination' ? '하차' : '환승'} — 500m 이내 알림)
              </Text>
            ))}
          </View>
        </View>

        <TouchableOpacity style={styles.stopBtn} onPress={stopMonitoring}>
          <Text style={styles.stopBtnText}>알림 중단</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── 모니터링 시작 전 화면 ────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.card}>
        <Text style={styles.routeName}>{targetRoute.name}</Text>
        <Text style={styles.departTime}>출발 시간 {targetRoute.depart_time}</Text>
        <Text style={styles.dest}>목적지 {targetName || '–'}</Text>

        <View style={styles.divider} />

        <Text style={styles.segmentTitle}>구간 정보</Text>
        {targetRoute.segments.map((seg, i) => (
          <View key={i} style={styles.segmentRow}>
            <Text style={styles.segmentBadge}>{seg.mode === 'ktx' ? '🚄' : '🚌'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.segmentSub}>
                {seg.mode === 'ktx'
                  ? `${seg.start_stop_name || '–'}역 → ${seg.end_stop_name || '–'}역`
                  : `${seg.start_stop_name || '–'} → ${seg.end_stop_name || '–'}`}
              </Text>
              {seg.mode === 'ktx' && (
                <Text style={{ fontSize: 11, color: '#6B46C1', marginTop: 2 }}>KTX</Text>
              )}
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.startBtn} onPress={startMonitoring}>
        <Text style={styles.startBtnText}>사전 도착알림 시작</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.editBtn}
        onPress={() => navigation.navigate('RouteRegister', { routeId })}>
        <Text style={styles.editBtnText}>경로 수정</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA', padding: 20 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3, marginBottom: 16,
  },
  routeName:    { fontSize: 22, fontWeight: '800', color: '#1A73E8', marginBottom: 6 },
  departTime:   { fontSize: 14, color: '#888', marginBottom: 4 },
  dest:         { fontSize: 15, color: '#555', marginBottom: 16 },
  divider:      { height: 1, backgroundColor: '#EEE', marginBottom: 16 },
  segmentTitle: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 10 },
  segmentRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  segmentBadge: { fontSize: 20, marginTop: 1 },
  segmentMain:  { fontSize: 15, fontWeight: '700', color: '#222' },
  segmentSub:   { fontSize: 13, color: '#777', marginTop: 2 },
  statusText:   { fontSize: 18, fontWeight: '700', color: '#333', marginBottom: 12, marginTop: 8 },
  departBadge:  { fontSize: 12, color: '#1A73E8', backgroundColor: '#E8F0FE', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 16 },
  legend:       { marginTop: 8 },
  legendItem:   { fontSize: 13, color: '#999', textAlign: 'center', lineHeight: 22 },
  startBtn: {
    height: 52, backgroundColor: '#1A73E8', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  editBtn: {
    height: 52, backgroundColor: '#fff', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#1A73E8',
  },
  editBtnText:  { color: '#1A73E8', fontWeight: '700', fontSize: 16 },
  stopBtn: {
    height: 52, backgroundColor: '#E53935', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  stopBtnText:  { color: '#fff', fontWeight: '700', fontSize: 16 },
});
