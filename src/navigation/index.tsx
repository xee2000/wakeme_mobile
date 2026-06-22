import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAccessToken, me } from '@react-native-kakao/user';
import notifee, { EventType } from '@notifee/react-native';

import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types';
import { supabase } from '../api/supabaseClient';
import { useMonitoringStore, loadMonitoringState, loadActiveRoutes } from '../store/useMonitoringStore';
import { useStopsStore } from '../store/useStopsStore';
import { startNativeService, scheduleDeparture } from '../utils/nativeService';
import { scheduleDepartureNotification } from '../utils/notifications';

import LoginScreen from '../screens/LoginScreen';
import PermissionScreen from '../screens/PermissionScreen';
import HomeScreen from '../screens/HomeScreen';
import RouteListScreen from '../screens/RouteListScreen';
import RouteRegisterScreen from '../screens/RouteRegisterScreen';
import RouteActiveScreen from '../screens/RouteActiveScreen';
import CustomerSupportScreen from '../screens/CustomerSupportScreen';
import CustomerSupportDetailScreen from '../screens/CustomerSupportDetailScreen';
import AdminScreen from '../screens/AdminScreen';
import AdminQuestionDetailScreen from '../screens/AdminQuestionDetailScreen';
import SettingsModal from '../components/SettingsModal';
import SplashScreen from '../components/SplashScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();


export default function AppNavigator() {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const setUser = useAuthStore(s => s.setUser);
  const [checking, setChecking] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [exitVisible, setExitVisible] = useState(false);
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    // MMKV에 저장된 유저 데이터로 즉시 복원 (카카오 API 호출 불필요)
    // isLoggedIn은 store 초기값에서 이미 MMKV 기반으로 설정됨
    setChecking(false);

    // 백그라운드에서 카카오 토큰 유효성 검증 후 프로필 갱신 (실패해도 무시)
    getAccessToken()
      .then(tokenInfo => {
        if (!tokenInfo) return;
        return me().then(profile => {
          const userId = String(profile.id);
          const nickname = profile.nickname ?? '사용자';
          const profileImageUrl = profile.profileImageUrl ?? undefined;
          setUser({ id: userId, nickname, profileImageUrl });
          // Supabase v2 PostgrestFilterBuilder는 .catch()가 없어 Promise.resolve()로 래핑
          Promise.resolve(
            supabase.from('users').upsert({
              id: userId,
              nickname,
              profile_image_url: profileImageUrl,
              updated_at: new Date().toISOString(),
            })
          ).catch(() => {});
        });
      })
      .catch(() => {});
  }, []);

  // 로그인 완료 후 모니터링 복구 + 전국 정류장 백그라운드 로딩 시작
  useEffect(() => {
    if (!isLoggedIn) return;
    restoreMonitoringIfNeeded();
    // 전국 버스정류장 캐시 로딩 (1회만 실행, 이미 로딩 중이면 무시)
    useStopsStore.getState().startLoading();
  }, [isLoggedIn]);

  // 앱이 백그라운드 → 포그라운드로 돌아올 때 복구 시도
  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        restoreMonitoringIfNeeded();
      }
    });
    return () => sub.remove();
  }, [isLoggedIn]);

  // 뒤로가기 버튼 — 루트 화면에서 종료 확인 다이얼로그
  useEffect(() => {
    const onBackPress = () => {
      if (navRef.current?.canGoBack()) {
        // 스택에 이전 화면이 있으면 정상적으로 뒤로
        return false;
      }
      // 루트 화면(Home / Login)에서 뒤로가기 → 종료 확인
      setExitVisible(true);
      return true; // 기본 뒤로가기 동작 막기
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, []);

  // departure 알림 탭 → 해당 경로 화면으로 이동
  useEffect(() => {
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        const id = detail.notification?.id ?? '';
        if (id.startsWith('departure-')) {
          const routeId = id.replace('departure-', '');
          navRef.current?.navigate('RouteActive', { routeId });
        }
      }
    });
    return unsub;
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#1A73E8" />
      </View>
    );
  }

  return (
  <>
    <NavigationContainer ref={navRef}>
      <Stack.Navigator
        key={isLoggedIn ? 'loggedIn' : 'loggedOut'}
        screenOptions={{
          headerStyle: { backgroundColor: '#1A73E8' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}>
        {!isLoggedIn ? (
          <>
            <Stack.Screen
              name="Permission"
              component={PermissionScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false }}
            />
          </>
        ) : (
          <>
            <Stack.Screen
              name="Home"
              component={HomeScreen}
              options={{
                title: 'WakeMe',
                // 설정⚙️ → 홈 화면 헤더 우측으로 이동, 네비 헤더에는 설정 없음
                headerRight: () => (
                  <TouchableOpacity
                    onPress={() => setSettingsVisible(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginRight: 4 }}>
                    <Text style={{ fontSize: 20 }}>⚙️</Text>
                  </TouchableOpacity>
                ),
              }}
            />
            <Stack.Screen
              name="RouteList"
              component={RouteListScreen}
              options={{ title: '내 경로' }}
            />
            <Stack.Screen
              name="RouteRegister"
              component={RouteRegisterScreen}
              options={{ title: '경로 등록' }}
            />
            <Stack.Screen
              name="RouteActive"
              component={RouteActiveScreen}
              options={{ title: '도착알림서비스 상세' }}
            />
            <Stack.Screen
              name="CustomerSupport"
              component={CustomerSupportScreen}
              options={{ title: '고객센터' }}
            />
            <Stack.Screen
              name="CustomerSupportDetail"
              component={CustomerSupportDetailScreen}
              options={{ title: '문의 상세' }}
            />
            <Stack.Screen
              name="Admin"
              component={AdminScreen}
              options={{ title: '관리자 — 문의 목록', headerBackTitle: '뒤로' }}
            />
            <Stack.Screen
              name="AdminQuestionDetail"
              component={AdminQuestionDetailScreen}
              options={{ title: '문의 상세', headerBackTitle: '목록' }}
            />
          </>
        )}
      </Stack.Navigator>
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      />
    </NavigationContainer>

    {/* 스플래시 — Modal 기반 전체화면, 애니메이션 완료 후 자동 닫힘 */}
    {!splashDone && (
      <SplashScreen onDone={() => setSplashDone(true)} />
    )}

    {/* 앱 종료 확인 모달 */}
    <Modal
      visible={exitVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setExitVisible(false)}>
      <TouchableOpacity
        style={exitStyles.overlay}
        activeOpacity={1}
        onPress={() => setExitVisible(false)}>
        <TouchableOpacity activeOpacity={1} style={exitStyles.card}>
          {/* 버스 아이콘 */}
          <View style={exitStyles.iconWrap}>
            <Text style={exitStyles.busIcon}>🚌</Text>
          </View>

          <Text style={exitStyles.title}>잠깐, 벌써 가세요?</Text>
          <Text style={exitStyles.desc}>
            등록된 버스 알림이 꺼집니다.{'\n'}앱을 종료할까요?
          </Text>

          <View style={exitStyles.btnRow}>
            <TouchableOpacity
              style={exitStyles.btnCancel}
              onPress={() => setExitVisible(false)}>
              <Text style={exitStyles.btnCancelText}>계속 이용</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={exitStyles.btnExit}
              onPress={() => BackHandler.exitApp()}>
              <Text style={exitStyles.btnExitText}>종료</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>

  </>
  );
}

/**
 * 저장된 모니터링 상태가 있고 현재 서비스가 꺼져 있으면 WakeMeService를 재시작한다.
 * 앱 재시작 시 AlarmManager 알람도 함께 재등록한다.
 */
function restoreMonitoringIfNeeded() {
  const saved = loadMonitoringState();
  if (!saved) {
    console.log('[WAKE] 복구: 저장된 모니터링 상태 없음 — 스킵');
    return;
  }

  const currentStore = useMonitoringStore.getState();
  if (currentStore.routeId) {
    console.log('[WAKE] 복구: 이미 모니터링 중 (routeId=%s) — 스킵', currentStore.routeId);
    // 이미 모니터링 중이어도 AlarmManager 알람은 앱 재시작 시 사라지므로 재등록
    rescheduleDepartureAlarms();
    return;
  }

  console.log('[WAKE] 복구: routeId=%s — 네이티브 서비스 재시작', saved.routeId);
  startNativeService();

  // store 상태 복구 → UI가 모니터링 화면으로 전환됨
  useMonitoringStore.getState().activate(
    saved.routeId,
    saved.waypoints ?? [],
    saved.departTime,
    saved.startStopId,
    saved.startStopName,
  );

  // AlarmManager 출발 알람 재등록
  rescheduleDepartureAlarms();
}

/**
 * 저장된 모든 활성 경로의 출발 알람을 재등록한다.
 * 오늘이 운행 요일에 포함된 경우에만 등록.
 */
function rescheduleDepartureAlarms() {
  const routes = loadActiveRoutes();
  const today = new Date().getDay(); // 0=일, 6=토

  routes.forEach(r => {
    if (!r.startStopId || !r.startStopName || !r.departTime) return;

    const validDays = r.daysOfWeek && r.daysOfWeek.length > 0 ? r.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];

    if (validDays.includes(today)) {
      // 오늘이 운행일 → 네이티브 AlarmManager 등록
      console.log('[WAKE] 출발 알람 재등록: routeId=%s departTime=%s stop=%s', r.routeId, r.departTime, r.startStopName);
      scheduleDeparture(r.routeId, r.departTime, r.startStopName, r.startStopId);
    } else {
      console.log('[WAKE] 출발 알람 스킵 (운행 안 함): routeId=%s today=%d validDays=%s', r.routeId, today, validDays.join(','));
    }

    // Notifee 출발 알림: 다음 유효한 운행일에 맞춰 재등록
    if (r.routeName) {
      scheduleDepartureNotification(r.routeId, r.routeName, r.departTime, r.daysOfWeek)
        .catch(() => {});
    }
  });
}

// ── 앱 종료 확인 모달 스타일 ────────────────────────────────────────
const exitStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 300,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    alignItems: 'center',
    // 그림자
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EEF4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  busIcon: {
    fontSize: 36,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 8,
    textAlign: 'center',
  },
  desc: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  btnCancel: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: {
    color: '#1A73E8',
    fontSize: 15,
    fontWeight: '600',
  },
  btnExit: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnExitText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
