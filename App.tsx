import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation';
import { RestApi } from './src/api/RestApi';
import InAppUpdates from 'sp-react-native-in-app-updates';
import {
  AndroidStartUpdateOptions,
  IAUUpdateKind,
  StatusUpdateEvent,
  AndroidInstallStatus,
} from 'sp-react-native-in-app-updates';

// ── In-App Update 훅 ──────────────────────────────────────────────
const inAppUpdates = new InAppUpdates(false);

function useInAppUpdate() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    inAppUpdates
      .checkNeedsUpdate()
      .then(result => {
        if (!result.shouldUpdate) return;

        // FLEXIBLE: 백그라운드 다운로드 → 완료 시 재시작 유도
        const options: AndroidStartUpdateOptions = {
          updateType: IAUUpdateKind.FLEXIBLE,
        };

        inAppUpdates.addStatusUpdateListener((event: StatusUpdateEvent) => {
          if (event.status === AndroidInstallStatus.DOWNLOADED) {
            // 다운로드 완료 → 재시작 시 자동 설치
            inAppUpdates.installUpdate();
            inAppUpdates.removeStatusUpdateListener(() => {});
          }
        });

        inAppUpdates.startUpdate(options).catch((err: unknown) => {
          console.warn('[UPDATE] startUpdate 실패:', err);
        });
      })
      .catch((err: unknown) => {
        // 개발 환경 / Play Store 미연동 시 무시
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
