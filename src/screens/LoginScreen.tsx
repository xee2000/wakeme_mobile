import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { login, me } from '@react-native-kakao/user';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../api/supabaseClient';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore(s => s.setUser);
  const insets = useSafeAreaInsets();

  const handleKakaoLogin = async () => {
    setLoading(true);
    try {
      await login();
      const profile = await me();

      const userId = String(profile.id);
      const nickname = profile.nickname ?? '사용자';
      const profileImageUrl = profile.profileImageUrl ?? undefined;

      const { error } = await supabase.from('users').upsert({
        id: userId,
        nickname,
        profile_image_url: profileImageUrl,
        updated_at: new Date().toISOString(),
      });
      if (error) console.warn('[Login] supabase upsert error:', error.message);

      setUser({ id: userId, nickname, profileImageUrl });
    } catch (e: any) {
      Alert.alert('로그인 실패', e.message ?? '다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}>
      <View style={styles.logoArea}>
        <Text style={styles.appName}>WakeMe</Text>
        <Text style={styles.tagline}>졸아도 괜찮아, 내가 깨워줄게</Text>
      </View>

      <TouchableOpacity
        style={styles.kakaoBtn}
        onPress={handleKakaoLogin}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#3C1E1E" />
        ) : (
          <Text style={styles.kakaoBtnText}>카카오로 시작하기</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 64,
  },
  appName: {
    fontSize: 48,
    fontWeight: '900',
    color: '#1A73E8',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 15,
    color: '#666',
    marginTop: 8,
  },
  kakaoBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#FEE500',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3C1E1E',
  },
});
