import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAccessTokenInfo, me } from '@react-native-kakao/user';
import { MMKV } from 'react-native-mmkv';

import { useAuthStore } from '../store/useAuthStore';
import { RootStackParamList } from '../types';
import { supabase } from '../api/supabaseClient';

import LoginScreen from '../screens/LoginScreen';
import PermissionScreen from '../screens/PermissionScreen';
import HomeScreen from '../screens/HomeScreen';
import RouteListScreen from '../screens/RouteListScreen';
import RouteRegisterScreen from '../screens/RouteRegisterScreen';
import RouteActiveScreen from '../screens/RouteActiveScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const storage = new MMKV();
const LOGGED_IN_KEY = 'wakeme_logged_in_before';

export default function AppNavigator() {
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const setUser = useAuthStore(s => s.setUser);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // 재설치 후엔 MMKV가 비어있으므로 플래그 없음 → 자동 로그인 건너뜀
        const loggedInBefore = storage.getBoolean(LOGGED_IN_KEY);
        if (!loggedInBefore) return; // Permission → Login 화면으로

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

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#1A73E8" />
      </View>
    );
  }

  return (
    <NavigationContainer>
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
