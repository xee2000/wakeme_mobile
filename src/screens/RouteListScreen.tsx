import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { useMonitoringStore } from '../store/useMonitoringStore';
import { RootStackParamList, Route } from '../types';
import { ensureServiceRunning } from '../utils/nativeService';
import { fetchRoutes } from '../api/routeApi';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteList'>;

export default function RouteListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { routes, loading, loadRoutes, removeRoute } = useRouteStore();
  const isRouteActive = useMonitoringStore(s => s.isRouteActive);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      fetchRoutes(user.id)
        .then(data => { if (!cancelled) useRouteStore.setState({ routes: data }); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [user.id]),
  );

  useEffect(() => {
    // 출발 알림은 "사전 도착알림 시작" 버튼을 눌렀을 때만 등록됨
    // 렌더 사이클 완료 후 실행 — Fabric 렌더 중 네이티브 작업 충돌 방지
    const timer = setTimeout(() => ensureServiceRunning(), 0);
    return () => clearTimeout(timer);
  }, [routes]);

  const handleDelete = (route: Route) => {
    Alert.alert('경로 삭제', `"${route.name}" 경로를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => removeRoute(route.id),
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A73E8" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {routes.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>등록된 경로가 없습니다.</Text>
        </View>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 80, // 하단 버튼 + 홈 인디케이터
          }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.cardMain}
                onPress={() =>
                  navigation.navigate('RouteActive', { routeId: item.id })
                }>
                <Text style={styles.routeName}>{item.name}</Text>
                <Text style={styles.routeMeta}>
                  출발 {item.depart_time} · {item.segments.length}구간
                </Text>
                {item.segments.map((seg, i) => (
                  <Text key={i} style={styles.segText}>
                    {i + 1}. 🚌 {seg.start_stop_name || '–'} → {seg.end_stop_name || '–'}
                  </Text>
                ))}
              </TouchableOpacity>
              <View style={styles.cardActions}>
                {isRouteActive(item.id) && (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>🟢 작동중</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.startBtn}
                  onPress={() =>
                    navigation.navigate('RouteActive', { routeId: item.id })
                  }>
                  <Text style={styles.startBtnText}>시작 ›</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(item)}>
                  <Text style={styles.deleteBtnText}>삭제</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* 하단 버튼 — 홈 인디케이터 침범 방지 */}
      <TouchableOpacity
        style={[styles.addBtn, { marginBottom: insets.bottom + 12 }]}
        onPress={() => navigation.navigate('RouteRegister', {})}>
        <Text style={styles.addBtnText}>+ 새 경로 등록</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 16, color: '#888' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardMain: { marginBottom: 12 },
  routeName: { fontSize: 17, fontWeight: '700', color: '#222' },
  routeMeta: { fontSize: 13, color: '#888', marginTop: 4, marginBottom: 8 },
  segText: { fontSize: 13, color: '#555', marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 8 },
  activeBadge: {
    height: 38,
    paddingHorizontal: 12,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#A5D6A7',
  },
  activeBadgeText: { color: '#2E7D32', fontWeight: '700', fontSize: 13 },
  startBtn: {
    flex: 1,
    height: 38,
    backgroundColor: '#1A73E8',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  deleteBtn: {
    height: 38,
    paddingHorizontal: 16,
    backgroundColor: '#FFE5E5',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { color: '#E53935', fontWeight: '700', fontSize: 14 },
  addBtn: {
    marginHorizontal: 16,
    height: 50,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
