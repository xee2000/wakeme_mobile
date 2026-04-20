import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { login, me } from '@react-native-kakao/user';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../api/supabaseClient';

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore(s => s.setUser);

  const handleKakaoLogin = async () => {
    setLoading(true);
    try {
      // 1. 카카오 로그인
      await login();
      const profile = await me();

      const userId = String(profile.id);        // id는 number → string 변환
      const nickname = profile.nickname ?? '사용자';
      const profileImageUrl = profile.profileImageUrl ?? undefined;

      // 2. Supabase users 테이블 upsert
      const { error } = await supabase.from('users').upsert({
        id: userId,
        nickname,
        profile_image_url: profileImageUrl,
        updated_at: new Date().toISOString(),
      });
      if (error) console.warn('[Login] supabase upsert error:', error.message);

      // 3. 스토어에 저장 → 네비게이션 자동 전환
      setUser({ id: userId, nickname, profileImageUrl });
    } catch (e: any) {
      Alert.alert('로그인 실패', e.message ?? '다시 시도해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
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
