import React, { useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { logout as kakaoLogout } from '@react-native-kakao/user';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { useMonitoringStore } from '../store/useMonitoringStore';
import { RootStackParamList } from '../types';
import { ensureServiceRunning } from '../utils/nativeService';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const { routes, loadRoutes } = useRouteStore();
  const isRouteActive = useMonitoringStore(s => s.isRouteActive);

  // 관리자 모드: 닉네임 5번 연속 터치
  const nickTapCount = useRef(0);
  const nickTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) loadRoutes(user.id);
      ensureServiceRunning();
    }, [user]),
  );

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          try { await kakaoLogout(); } catch (e) { /* 무시 */ }
          logout();
        },
      },
    ]);
  };

  const handleNicknameTap = () => {
    nickTapCount.current += 1;
    if (nickTapTimer.current) clearTimeout(nickTapTimer.current);
    if (nickTapCount.current >= 5) {
      nickTapCount.current = 0;
      navigation.navigate('Admin');
      return;
    }
    nickTapTimer.current = setTimeout(() => { nickTapCount.current = 0; }, 1500);
  };

  return (
    <View style={styles.container}>
      {/* 인삿말 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleNicknameTap} activeOpacity={1}>
          <Text style={styles.greeting}>
            안녕하세요,{' '}
            <Text style={styles.nickname}>{user?.nickname}</Text>님 👋
          </Text>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleLogout}>
            <Text style={styles.actionText}>로그아웃</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 최근 경로 */}
      {routes.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>최근 경로</Text>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {routes.map(item => {
              const active = isRouteActive(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.routeCard, active && styles.routeCardActive]}
                  onPress={() => navigation.navigate('RouteActive', { routeId: item.id })}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.routeName, active && styles.routeNameActive]}>
                      {item.name}
                    </Text>
                    <Text style={styles.routeMeta}>
                      출발 {item.depart_time} · {item.segments.length}구간
                    </Text>
                  </View>
                  {active ? (
                    <View style={styles.activeBadge}>
                      <View style={styles.activeDot} />
                      <Text style={styles.activeBadgeText}>경로 안내 작동중</Text>
                    </View>
                  ) : (
                    <Text style={styles.startBtn}>시작 ▶</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.emptyArea}>
          <View style={styles.infoBox}>
            <Text style={styles.infoIcon}>🚌</Text>
            <Text style={styles.infoTitle}>깨워드릴게요</Text>
            <Text style={styles.infoDesc}>
              사용자가 등록한 경로에 따라{'\n'}
              GPS를 감지하여 하차 알림을 드리는 서비스입니다.{'\n\n'}
              경로를 등록해야만 이용하실 수 있습니다.
            </Text>
          </View>
          <Text style={styles.emptySubText}>아래 버튼으로 경로를 추가해보세요!</Text>
        </View>
      )}

      {/* 하단 버튼 */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={() => navigation.navigate('RouteList')}>
          <Text style={styles.btnSecondaryText}>내 경로 보기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={() => navigation.navigate('RouteRegister', {})}>
          <Text style={styles.btnPrimaryText}>+ 경로 등록</Text>
        </TouchableOpacity>
      </View>

      {/* 고객센터 플로팅 버튼 — 우측 하단 고정 */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 92 }]}
        onPress={() => navigation.navigate('CustomerSupport')}
        activeOpacity={0.85}>
        <Text style={styles.fabIcon}>🎧</Text>
        <Text style={styles.fabText}>고객센터</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA', padding: 20, paddingBottom: 0 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: { fontSize: 18, color: '#333' },
  nickname: { fontWeight: '700', color: '#1A73E8' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: 13, color: '#999' },
  dividerDot: { fontSize: 13, color: '#ccc' },
  section: { flex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#555', marginBottom: 12 },
  routeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  routeCardActive: {
    backgroundColor: '#F0FFF4',
    borderColor: '#38A169',
    shadowColor: '#38A169',
    shadowOpacity: 0.12,
    elevation: 4,
  },
  routeName: { fontSize: 16, fontWeight: '700', color: '#222' },
  routeNameActive: { color: '#276749' },
  routeMeta: { fontSize: 13, color: '#888', marginTop: 4 },
  startBtn: { fontSize: 14, color: '#1A73E8', fontWeight: '700' },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#C6F6D5',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#38A169' },
  activeBadgeText: { fontSize: 12, color: '#276749', fontWeight: '700' },
  emptyArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  emptySubText: { fontSize: 13, color: '#999', marginTop: 16 },
  infoBox: {
    backgroundColor: '#fff', borderRadius: 16, padding: 24,
    alignItems: 'center', marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    width: '100%',
  },
  infoIcon:  { fontSize: 40, marginBottom: 10 },
  infoTitle: { fontSize: 18, fontWeight: '800', color: '#1A73E8', marginBottom: 12 },
  infoDesc:  { fontSize: 14, color: '#555', lineHeight: 22, textAlign: 'center' },
  footer: {
    flexDirection: 'row', gap: 12,
    paddingTop: 12,
    backgroundColor: '#F5F7FA',
  },
  btnPrimary: {
    flex: 1, height: 50, backgroundColor: '#1A73E8',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    flex: 1, height: 50, backgroundColor: '#fff',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1A73E8',
  },
  btnSecondaryText: { color: '#1A73E8', fontWeight: '700', fontSize: 15 },
  fab: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1A73E8',
    borderRadius: 28,
    paddingHorizontal: 16,
    height: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: { fontSize: 18 },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
