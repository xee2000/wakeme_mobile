import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  PermissionsAndroid,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import notifee, { AndroidNotificationSetting } from '@notifee/react-native';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Permission'>;

const PERMISSIONS_INFO = [
  {
    icon: '📍',
    title: '위치 권한 (항상 허용)',
    desc: '버스 정류장에 가까워졌을 때 알림을 보내려면 백그라운드 위치 접근이 필요합니다. 설정에서 "항상 허용"을 선택해주세요.',
    required: true,
  },
  {
    icon: '🔔',
    title: '알림 권한',
    desc: '출발 시간 알림과 하차 알림을 받으려면 알림 권한이 필요합니다.',
    required: true,
  },
  {
    icon: '⏰',
    title: '정확한 알람',
    desc: '설정한 출발 시간에 정확하게 알림을 보내기 위해 필요합니다.',
    required: true,
  },
  {
    icon: '🔋',
    title: '배터리 최적화 제외',
    desc: '앱이 절전 모드에서도 GPS 추적이 멈추지 않도록 배터리 최적화 예외 설정이 필요합니다.',
    required: true,
  },
];

export default function PermissionScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  const requestAll = async () => {
    setLoading(true);
    try {
      if (Platform.OS === 'android') {
        // 1. 위치 권한
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: '위치 권한 필요',
            message: '버스 정류장 접근 감지를 위해 정확한 위치 권한이 필요합니다.',
            buttonPositive: '허용',
            buttonNegative: '거부',
          },
        );

        // 2. 백그라운드 위치 (Android 10+ — 반드시 별도 요청)
        if (parseInt(String(Platform.Version), 10) >= 29) {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
            {
              title: '백그라운드 위치 권한 필요',
              message:
                '앱이 닫혀 있어도 정류장 접근을 감지하려면 위치를 "항상 허용"으로 설정해주세요.',
              buttonPositive: '설정 열기',
              buttonNegative: '나중에',
            },
          );
        }
      }

      // 3. 알림 권한 (notifee — Android 13+, iOS)
      await notifee.requestPermission();

      // 4. 정확한 알람 (Android 12+)
      if (Platform.OS === 'android' && parseInt(String(Platform.Version), 10) >= 31) {
        const settings = await notifee.getNotificationSettings();
        if (settings.android?.alarm !== AndroidNotificationSetting.ENABLED) {
          Alert.alert(
            '정확한 알람 권한 필요',
            '출발 시간 정확한 알림을 위해 다음 설정 화면에서 "알람 및 알림" 권한을 허용해주세요.',
            [{ text: '설정 열기', onPress: () => notifee.openAlarmPermissionSettings() }],
          );
          // 설정 열기 후 잠시 대기
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // 5. 배터리 최적화 제외 (Android) — notifee 제공 API
      if (Platform.OS === 'android') {
        const powerSettings = await notifee.getPowerManagerInfo();
        if (powerSettings.activity) {
          Alert.alert(
            '배터리 최적화 제외 권장',
            '절전 모드에서도 하차 알림이 울리려면 배터리 최적화를 해제해주세요.',
            [
              { text: '나중에', style: 'cancel' },
              { text: '설정 열기', onPress: () => notifee.openPowerManagerSettings() },
            ],
          );
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.warn('[Permission]', e);
    } finally {
      setLoading(false);
      navigation.replace('Login');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      {/* 헤더 */}
      <View style={styles.logoArea}>
        <Text style={styles.appName}>WakeMe</Text>
        <Text style={styles.subtitle}>앱을 사용하기 위해 아래 권한이 필요합니다</Text>
      </View>

      {/* 권한 목록 */}
      <ScrollView style={styles.list} contentContainerStyle={{ paddingHorizontal: 24 }}>
        {PERMISSIONS_INFO.map((p, i) => (
          <View key={i} style={styles.permItem}>
            <Text style={styles.permIcon}>{p.icon}</Text>
            <View style={styles.permText}>
              <View style={styles.permTitleRow}>
                <Text style={styles.permTitle}>{p.title}</Text>
                {p.required && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>필수</Text>
                  </View>
                )}
              </View>
              <Text style={styles.permDesc}>{p.desc}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* 안내 문구 */}
      <Text style={styles.note}>
        권한을 허용하지 않으면 하차 알림 기능이 정상 동작하지 않을 수 있습니다.
      </Text>

      {/* 버튼 */}
      <TouchableOpacity
        style={[styles.btn, loading && { opacity: 0.7 }]}
        onPress={requestAll}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>권한 허용하고 시작하기</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.skipBtn}
        onPress={() => navigation.replace('Login')}
        disabled={loading}>
        <Text style={styles.skipText}>나중에 설정하기</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  logoArea: { alignItems: 'center', marginBottom: 32, paddingHorizontal: 24 },
  appName: { fontSize: 40, fontWeight: '900', color: '#1A73E8', letterSpacing: -1 },
  subtitle: { fontSize: 14, color: '#666', marginTop: 8, textAlign: 'center' },
  list: { flex: 1 },
  permItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  permIcon: { fontSize: 28, marginTop: 2 },
  permText: { flex: 1 },
  permTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  permTitle: { fontSize: 15, fontWeight: '700', color: '#222' },
  badge: { backgroundColor: '#E8F0FE', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, color: '#1A73E8', fontWeight: '700' },
  permDesc: { fontSize: 13, color: '#666', lineHeight: 19 },
  note: {
    fontSize: 12,
    color: '#E53935',
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 16,
    lineHeight: 18,
  },
  btn: {
    marginHorizontal: 24,
    height: 52,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  skipBtn: { alignItems: 'center', paddingVertical: 8 },
  skipText: { fontSize: 14, color: '#999' },
});
