import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAccessToken, me } from '@react-native-kakao/user';
import notifee, { EventType } from '@notifee/react-native';

import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types';
import { supabase } from '../api/supabaseClient';
import { useMonitoringStore, loadMonitoringState } from '../store/useMonitoringStore';
import { startNativeService } from '../utils/nativeService';

import LoginScreen from '../screens/LoginScreen';
import PermissionScreen from '../screens/PermissionScreen';
import HomeScreen from '../screens/HomeScreen';
import RouteListScreen from '../screens/RouteListScreen';
import RouteRegisterScreen from '../screens/RouteRegisterScreen';
import RouteActiveScreen from '../screens/RouteActiveScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();


export default function AppNavigator() {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const setUser = useAuthStore(s => s.setUser);
  const [checking, setChecking] = useState(true);
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
          supabase.from('users').upsert({
            id: userId,
            nickname,
            profile_image_url: profileImageUrl,
            updated_at: new Date().toISOString(),
          }).catch(() => {});
        });
      })
      .catch(() => {});
  }, []);

  // 로그인 완료 후 모니터링 복구 시도
  useEffect(() => {
    if (!isLoggedIn) return;
    restoreMonitoringIfNeeded();
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
    <NavigationContainer ref={navRef}>
      <Stack.Navigator
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
              options={{ title: 'WakeMe' }}
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
              options={{ title: '알림 활성화' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * 저장된 모니터링 상태가 있고 현재 서비스가 꺼져 있으면 WakeMeService를 재시작한다.
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
}
