import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface Props {
  onDone: () => void;
}

/**
 * 스플래시 애니메이션 시퀀스 (총 ~1.9초)
 *
 * 0.0s — 로고 슬라이드인
 * 0.3s — 승객 졸고 있음 (💤 위아래 반복)
 * 0.9s — 🔔 팝인 + 흔들림, 💤 사라짐
 * 1.3s — 😮 깜짝 깨기 + "지금 내리세요!" 텍스트 등장
 * 1.6s — 전체 페이드아웃 → onDone 호출
 */
export default function SplashScreen({ onDone }: Props) {
  const [modalVisible, setModalVisible] = useState(true);
  // ── 애니메이션 값 ──────────────────────────────────────────────
  const screenOpacity    = useRef(new Animated.Value(1)).current;

  const logoOpacity      = useRef(new Animated.Value(0)).current;
  const logoY            = useRef(new Animated.Value(-24)).current;

  const windowOpacity    = useRef(new Animated.Value(0)).current;
  const windowScale      = useRef(new Animated.Value(0.85)).current;

  const sleepOpacity     = useRef(new Animated.Value(1)).current;
  const zzzOpacity       = useRef(new Animated.Value(0)).current;
  const zzzY             = useRef(new Animated.Value(0)).current;

  const bellScale        = useRef(new Animated.Value(0)).current;
  const bellRotate       = useRef(new Animated.Value(0)).current;

  const awakeOpacity     = useRef(new Animated.Value(0)).current;
  const awakeScale       = useRef(new Animated.Value(0.5)).current;

  const alertOpacity     = useRef(new Animated.Value(0)).current;
  const alertX           = useRef(new Animated.Value(20)).current;

  // zzz 루프 제어
  const zzzRunning = useRef(true);

  useEffect(() => {
    // ── 0.0s: 로고 슬라이드인 ─────────────────────────────────
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1, duration: 350,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
      Animated.timing(logoY, {
        toValue: 0, duration: 350,
        easing: Easing.out(Easing.back(1.4)), useNativeDriver: true,
      }),
    ]).start();

    // ── 0.2s: 지하철 창문 팝인 ───────────────────────────────
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(windowOpacity, {
          toValue: 1, duration: 300,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(windowScale, {
          toValue: 1, duration: 300,
          easing: Easing.out(Easing.back(1.5)), useNativeDriver: true,
        }),
      ]).start();
    }, 200);

    // ── 0.4s: 💤 등장 + 반복 부유 ────────────────────────────
    setTimeout(() => {
      Animated.timing(zzzOpacity, {
        toValue: 1, duration: 200, useNativeDriver: true,
      }).start();

      const floatZzz = () => {
        if (!zzzRunning.current) return;
        Animated.sequence([
          Animated.timing(zzzY, {
            toValue: -10, duration: 450,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
          Animated.timing(zzzY, {
            toValue: 0, duration: 450,
            easing: Easing.inOut(Easing.sin), useNativeDriver: true,
          }),
        ]).start(({ finished }) => { if (finished) floatZzz(); });
      };
      floatZzz();
    }, 400);

    // ── 0.9s: 🔔 팝인 + 흔들림, 💤 퇴장 ─────────────────────
    setTimeout(() => {
      // 💤 페이드아웃
      zzzRunning.current = false;
      Animated.timing(zzzOpacity, {
        toValue: 0, duration: 200, useNativeDriver: true,
      }).start();

      // 🔔 팝인
      Animated.spring(bellScale, {
        toValue: 1, friction: 4, tension: 200, useNativeDriver: true,
      }).start();

      // 🔔 흔들림
      Animated.sequence([
        Animated.timing(bellRotate, { toValue:  18, duration: 70, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: -18, duration: 70, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue:  14, duration: 65, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: -14, duration: 65, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue:   9, duration: 55, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue:  -9, duration: 55, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue:   0, duration: 50, useNativeDriver: true }),
      ]).start();
    }, 900);

    // ── 1.3s: 😮 깜짝 깨기 + "지금 내리세요!" ─────────────────
    setTimeout(() => {
      // 😴 → 😮
      Animated.timing(sleepOpacity, {
        toValue: 0, duration: 120, useNativeDriver: true,
      }).start();
      Animated.parallel([
        Animated.timing(awakeOpacity, {
          toValue: 1, duration: 180, useNativeDriver: true,
        }),
        Animated.spring(awakeScale, {
          toValue: 1, friction: 4, tension: 200, useNativeDriver: true,
        }),
      ]).start();

      // 텍스트 슬라이드인
      Animated.parallel([
        Animated.timing(alertOpacity, {
          toValue: 1, duration: 200, useNativeDriver: true,
        }),
        Animated.timing(alertX, {
          toValue: 0, duration: 220,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
      ]).start();
    }, 1300);

    // ── 1.65s: 전체 페이드아웃 ───────────────────────────────
    setTimeout(() => {
      Animated.timing(screenOpacity, {
        toValue: 0, duration: 380,
        easing: Easing.in(Easing.quad), useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setModalVisible(false); // 페이드아웃 완료 후 Modal 닫기
          onDone();
        }
      });
    }, 1650);

    return () => { zzzRunning.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bellRotateDeg = bellRotate.interpolate({
    inputRange: [-18, 0, 18],
    outputRange: ['-18deg', '0deg', '18deg'],
  });

  return (
    <Modal
      visible={modalVisible}
      transparent={false}
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => {}}>
      <StatusBar hidden />
      <Animated.View style={[styles.root, { opacity: screenOpacity }]}>

      {/* ── 로고 ──────────────────────────────────────────── */}
      <Animated.View style={[styles.logoWrap, {
        opacity: logoOpacity,
        transform: [{ translateY: logoY }],
      }]}>
        <Text style={styles.logoText}>WakeMe</Text>
        <Text style={styles.tagline}>놓치지 마세요, 내릴 곳</Text>
      </Animated.View>

      {/* ── 지하철 창문 씬 ──────────────────────────────── */}
      <Animated.View style={[styles.window, {
        opacity: windowOpacity,
        transform: [{ scale: windowScale }],
      }]}>
        {/* 창문 프레임 내부 배경 */}
        <View style={styles.windowInner}>

          {/* 바깥 흐르는 라인 (정적 장식) */}
          <View style={styles.trackLine} />
          <View style={[styles.trackLine, { top: 28 }]} />

          {/* 좌석 */}
          <View style={styles.seat} />

          {/* 😴 자는 사람 */}
          <Animated.View style={[styles.personWrap, { opacity: sleepOpacity }]}>
            <Text style={styles.faceEmoji}>😴</Text>
            {/* 💤 */}
            <Animated.View style={[styles.zzzWrap, {
              opacity: zzzOpacity,
              transform: [{ translateY: zzzY }],
            }]}>
              <Text style={styles.zzzEmoji}>💤</Text>
            </Animated.View>
          </Animated.View>

          {/* 😮 깬 사람 */}
          <Animated.View style={[styles.personWrap, {
            opacity: awakeOpacity,
            transform: [{ scale: awakeScale }],
          }]}>
            <Text style={styles.faceEmoji}>😮</Text>
          </Animated.View>

        </View>

        {/* 창문 상단 손잡이 */}
        <View style={styles.handleBar}>
          {[0, 1, 2].map(i => (
            <View key={i} style={styles.handle} />
          ))}
        </View>
      </Animated.View>

      {/* ── 알림 영역 ────────────────────────────────────── */}
      <View style={styles.alertRow}>
        {/* 🔔 */}
        <Animated.View style={{
          transform: [{ scale: bellScale }, { rotate: bellRotateDeg }],
        }}>
          <Text style={styles.bellEmoji}>🔔</Text>
        </Animated.View>

        {/* "지금 내리세요!" */}
        <Animated.Text style={[styles.alertText, {
          opacity: alertOpacity,
          transform: [{ translateX: alertX }],
        }]}>
          지금 내리세요!
        </Animated.Text>
      </View>

      </Animated.View>
    </Modal>
  );
}

// ── 스타일 ─────────────────────────────────────────────────────
const WINDOW_W = 220;
const WINDOW_H = 150;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B1929',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 로고
  logoWrap: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoText: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1.5,
  },
  tagline: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.3,
  },

  // 창문
  window: {
    width: WINDOW_W,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: '#122540',
    overflow: 'hidden',
  },
  windowInner: {
    width: '100%',
    height: WINDOW_H,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  trackLine: {
    position: 'absolute',
    top: 14,
    left: 12,
    right: 12,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  seat: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 44,
    backgroundColor: '#1C3D62',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  personWrap: {
    position: 'absolute',
    bottom: 32,
    alignItems: 'center',
  },
  faceEmoji: {
    fontSize: 48,
  },
  zzzWrap: {
    position: 'absolute',
    top: -8,
    right: -28,
  },
  zzzEmoji: {
    fontSize: 20,
  },

  // 손잡이 바
  handleBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  handle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'transparent',
  },

  // 알림 영역
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    gap: 10,
    height: 44,
  },
  bellEmoji: {
    fontSize: 30,
  },
  alertText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FF6B6B',
    letterSpacing: 0.5,
  },
});
