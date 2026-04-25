import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, PermissionsAndroid, View } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAccessTokenInfo, me } from '@react-native-kakao/user';
import { MMKV } from 'react-native-mmkv';
import notifee, { AndroidForegroundServiceType, EventType } from '@notifee/react-native';

import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types';
import { supabase } from '../api/supabaseClient';
import {
  useMonitoringStore,
  loadMonitoringState,
} from '../store/useMonitoringStore';
import {
  setupNotificationChannel,
  CHANNEL_TRACKING,
} from '../utils/notifications';

import LoginScreen from '../screens/LoginScreen';
import PermissionScreen from '../screens/PermissionScreen';
import HomeScreen from '../screens/HomeScreen';
import RouteListScreen from '../screens/RouteListScreen';
import RouteRegisterScreen from '../screens/RouteRegisterScreen';
import RouteActiveScreen from '../screens/RouteActiveScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const storage = new MMKV();
const LOGGED_IN_KEY = 'wakeme_logged_in_before';

const FG_NOTIFICATION_ID = 'wakeme_tracking';

export default function AppNavigator() {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const setUser = useAuthStore(s => s.setUser);
  const [checking, setChecking] = useState(true);
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    (async () => {
      try {
        const loggedInBefore = storage.getBoolean(LOGGED_IN_KEY);
        if (!loggedInBefore) return;

        const tokenInfo = await getAccessTokenInfo();
        if (tokenInfo) {
          const profile = await me();
          const userId = String(profile.id);
          const nickname = profile.nickname ?? '사용자';
          const profileImageUrl = profile.profileImageUrl ?? undefined;
          await supabase.from('users').upsert({
            id: userId,
            nickname,
            profile_image_url: profileImageUrl,
            updated_at: new Date().toISOString(),
          });
          setUser({ id: userId, nickname, profileImageUrl });
        }
      } catch {
        // 토큰 만료 → 로그인 화면으로
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  // 로그인 완료 후 모니터링 복구 시도 (앱 최초 시작)
  useEffect(() => {
    if (!isLoggedIn) return;
    restoreMonitoringIfNeeded();
  }, [isLoggedIn]);

  // 앱이 백그라운드 → 포그라운드로 돌아올 때 복구 시도
  // (OS가 앱을 킬했다가 재시작하거나, 알림이 사라진 후 앱을 다시 열었을 때)
  useEffect(() => {
    if (!isLoggedIn) return;
    const sub = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        restoreMonitoringIfNeeded();
      }
    });
    return () => sub.remove();
  }, [isLoggedIn]);

  // 포그라운드 이벤트: 알림 탭 / 알림 제거 감지
  useEffect(() => {
    const unsub = notifee.onForegroundEvent(({ type, detail }) => {
      // departure 알림 탭 → 해당 경로로 이동
      if (type === EventType.PRESS) {
        const id = detail.notification?.id ?? '';
        if (id.startsWith('departure-')) {
          const routeId = id.replace('departure-', '');
          navRef.current?.navigate('RouteActive', { routeId });
        }
      }
      // 포그라운드 서비스 알림이 제거됐을 때 즉시 재시작
      if (type === EventType.DISMISSED && detail.notification?.id === FG_NOTIFICATION_ID) {
        restoreMonitoringIfNeeded();
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
 * 포그라운드 서비스 알림만 재표시한다.
 * GPS는 registerForegroundService 콜백이 서비스 시작과 동시에 알아서 실행하므로
 * 여기서는 알림 표시만 담당한다.
 */
async function restoreMonitoringIfNeeded() {
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

  console.log('[WAKE] 복구: 저장된 상태 발견 routeId=%s targetName=%s', saved.routeId, saved.targetName);

  try {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (!granted) {
        console.warn('[WAKE] 복구: 위치 권한 없음 — 중단');
        return;
      }
    }

    console.log('[WAKE] 복구: 포그라운드 서비스 알림 재표시 중...');
    await setupNotificationChannel();
    try { await notifee.stopForegroundService(); } catch (_) {}

    // 알림 표시 → OS가 서비스 재시작 → registerForegroundService 콜백 → GPS 자동 시작
    await notifee.displayNotification({
      id: FG_NOTIFICATION_ID,
      title: 'WakeMe 모니터링 재개',
      body: saved.targetName ? `${saved.targetName} 하차 감지 중` : '하차 지점 모니터링 중...',
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

    console.log('[WAKE] 복구: 포그라운드 서비스 알림 재표시 완료 — GPS는 FG서비스 콜백이 시작');
  } catch (e) {
    console.error('[WAKE] 복구: 포그라운드 서비스 재시작 실패:', e);
  }
}
