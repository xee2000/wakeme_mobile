import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation';
import { RestApi } from './src/api/RestApi';
import { checkForUpdate, UpdateFlow } from 'react-native-in-app-updates';

// ── In-App Update 훅 ──────────────────────────────────────────────
// FLEXIBLE: 백그라운드 다운로드 → 다운로드 완료 시 재시작 유도 알림
// IMMEDIATE: 전체화면 강제 업데이트 (중요 업데이트 시 사용)
function useInAppUpdate() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    checkForUpdate(UpdateFlow.FLEXIBLE)
      .then(() => {
        // FLEXIBLE 모드: Play Store가 백그라운드에서 다운로드 후
        // 다음 앱 실행 시 자동 설치됨 (별도 처리 불필요)
        console.log('[UPDATE] 업데이트 확인 완료');
      })
      .catch((err: unknown) => {
        // 개발 환경 또는 Play Store 미연동 시 에러 무시
        console.warn('[UPDATE] 업데이트 확인 실패 (무시):', err);
      });
  }, []);
}

// ── Error Boundary ────────────────────────────────────────────────
interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    fetch(`${RestApi.BASE_URL}/api/log/crash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: `${error.stack ?? ''}\n\nComponent Stack:\n${info.componentStack ?? ''}`,
        isFatal: false,
        platform: Platform.OS,
        platformVersion: Platform.Version,
        monitoringRouteId: null,
        source: 'ErrorBoundary',
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>앱 오류가 발생했습니다</Text>
          <Text style={styles.errorMessage}>{this.state.errorMessage}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, errorMessage: '' })}>
            <Text style={styles.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ── 메인 App ──────────────────────────────────────────────────────
export default function App() {
  useInAppUpdate();

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AppNavigator />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#F5F7FA',
  },
  errorTitle: { fontSize: 20, fontWeight: '700', color: '#E53935', marginBottom: 12 },
  errorMessage: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 32 },
  retryBtn: {
    height: 48,
    paddingHorizontal: 32,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
