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
import { requestNotificationPermission } from '../utils/notifications';
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
    const name =
      lastSeg.mode === 'bus'
        ? lastSeg.end_stop_name ?? ''
        : lastSeg.end_station ?? '';
    setTargetName(name);
  }, [targetRoute?.id]);

  // ── 모니터링 시작 ────────────────────────────────────────────────
  const startMonitoring = async () => {
    if (!targetRoute) {
      console.log('[WAKE][ERROR] targetRoute 없음');
      return;
    }

    console.log('[WAKE][ROUTE]', JSON.stringify(targetRoute, null, 2));

    const lastSeg: RouteSegment =
      targetRoute.segments[targetRoute.segments.length - 1];

    const stopName =
      lastSeg.mode === 'bus'
        ? lastSeg.end_stop_name ?? ''
        : lastSeg.end_station ?? '';

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

    // ── Supabase에서 하차 지점 좌표 조회 ─────────────────────────
    const waypoints: Waypoint[] = [];

    const allSegs = targetRoute.segments
      .slice()
      .sort((a, b) => a.order_index - b.order_index);

    for (let i = 0; i < allSegs.length; i++) {
      const seg           = allSegs[i];
      const isDestination = i === allSegs.length - 1;
      // 이 waypoint를 지난 후 탑승할 다음 구간 정보
      const nextSeg       = allSegs[i + 1];
      const nextMode      = isDestination ? undefined : (nextSeg?.mode as 'bus' | 'subway' | undefined);
      const nextStopId    = nextMode === 'bus' ? (nextSeg?.start_stop_id ?? undefined) : undefined;
      const nextStopName  = nextMode === 'bus' ? (nextSeg?.start_stop_name ?? undefined) : undefined;

      if (seg.mode === 'bus' && seg.end_stop_name && seg.end_stop_id) {
        const name   = seg.end_stop_name;
        const nodeId = seg.end_stop_id;
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
            console.log('[WAKE][WAYPOINT] 버스', name, nodeId, data.lat, data.lng, '→ next:', nextMode, nextStopId);
          } else {
            console.warn('[WAKE][WARN] bus_stops 미발견 node_id:', nodeId, name);
          }
        } catch (e) {
          console.warn('[WAKE][ERROR] bus_stops 조회 실패:', e);
        }
      } else if (seg.mode === 'subway' && seg.end_station) {
        const name      = seg.end_station;
        const stationId = seg.end_station_id;
        try {
          const query = supabase.from('subway_stations').select('lat, lng');
          const { data } = stationId
            ? await query.eq('station_id', stationId).maybeSingle()
            : await query.ilike('station_name', `%${name}%`).limit(1).maybeSingle();

          if (data) {
            waypoints.push({
              id: `wp_${i}`, lat: data.lat, lng: data.lng, name,
              type: isDestination ? 'destination' : 'transfer',
              ...(nextMode     && { nextMode }),
              ...(nextStopId   && { nextStopId }),
              ...(nextStopName && { nextStopName }),
            });
            console.log('[WAKE][WAYPOINT] 지하철', name, stationId ?? '(이름검색)', data.lat, data.lng, '→ next:', nextMode, nextStopId);
          } else {
            console.warn('[WAKE][WARN] subway_stations 미발견:', stationId ?? name);
          }
        } catch (e) {
          console.warn('[WAKE][ERROR] subway_stations 조회 실패:', e);
        }
      }
    }

    if (waypoints.length === 0) {
      console.warn('[WAKE][CRITICAL] waypoints 없음 → 지오펜스 미등록');
    }

    // ── 다중 경로 모니터링 시작 ───────────────────────────────────
    startRouteMonitoring({
      routeId,
      waypoints,
      departTime:    targetRoute.depart_time,
      startStopId:   firstBusSeg?.start_stop_id,
      startStopName: firstBusSeg?.start_stop_name,
    });

    // ── 출발 시간 알림 예약 ───────────────────────────────────────
    // 첫 번째 구간이 버스인 경우에만 예약
    // (지하철로 시작하는 경우 환승 지오펜스에서 버스 정보 제공)
    const firstSeg = allSegs[0];
    if (firstSeg?.mode === 'bus' && firstSeg.start_stop_id) {
      scheduleDeparture(
        routeId,
        targetRoute.depart_time,
        firstSeg.start_stop_name ?? '',
        firstSeg.start_stop_id,
      );
    } else {
      console.log('[WAKE] 첫 구간이 버스가 아님(mode=%s) → 출발 알람 미예약', firstSeg?.mode);
    }
  };

  // ── 모니터링 중단 ────────────────────────────────────────────────
  const stopMonitoring = () => {
    cancelDeparture(routeId);
    stopRouteMonitoring(routeId);
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
          <Text style={styles.statusText}>🟢 모니터링 중</Text>

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
            <Text style={styles.segmentBadge}>
              {seg.mode === 'bus' ? '🚌' : '🚇'}
            </Text>
            <View style={{ flex: 1 }}>
              {seg.mode === 'bus' ? (
                <Text style={styles.segmentSub}>
                  {seg.start_stop_name || '–'} → {seg.end_stop_name || '–'}
                </Text>
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
