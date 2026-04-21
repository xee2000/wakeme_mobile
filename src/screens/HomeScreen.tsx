import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const { routes, loading, loadRoutes } = useRouteStore();

  useFocusEffect(
    useCallback(() => {
      if (user) loadRoutes(user.id);
    }, [user]),
  );

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* 인삿말 */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          안녕하세요,{' '}
          <Text style={styles.nickname}>{user?.nickname}</Text>님 👋
        </Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {/* 최근 경로 */}
      {routes.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>최근 경로</Text>
          <FlatList
            data={routes.slice(0, 3)}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingBottom: 8 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.routeCard}
                onPress={() =>
                  navigation.navigate('RouteActive', { routeId: item.id })
                }>
                <View>
                  <Text style={styles.routeName}>{item.name}</Text>
                  <Text style={styles.routeMeta}>
                    출발 {item.depart_time} · {item.segments.length}구간
                  </Text>
                </View>
                <Text style={styles.startBtn}>시작 ▶</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      ) : (
        <View style={styles.emptyArea}>
          <Text style={styles.emptyText}>등록된 경로가 없습니다.</Text>
          <Text style={styles.emptySubText}>아래 버튼으로 경로를 추가해보세요!</Text>
        </View>
      )}

      {/* 하단 버튼 — 홈 인디케이터 침범 방지 */}
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
  logoutText: { fontSize: 13, color: '#999' },
  section: { flex: 1 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#555',
    marginBottom: 12,
  },
  routeCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  routeName: { fontSize: 16, fontWeight: '700', color: '#222' },
  routeMeta: { fontSize: 13, color: '#888', marginTop: 4 },
  startBtn: { fontSize: 14, color: '#1A73E8', fontWeight: '700' },
  emptyArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 16, color: '#555', fontWeight: '600' },
  emptySubText: { fontSize: 13, color: '#999', marginTop: 8 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
    paddingHorizontal: 0,
    backgroundColor: '#F5F7FA',
  },
  btnPrimary: {
    flex: 1,
    height: 50,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    flex: 1,
    height: 50,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1A73E8',
  },
  btnSecondaryText: { color: '#1A73E8', fontWeight: '700', fontSize: 15 },
});
