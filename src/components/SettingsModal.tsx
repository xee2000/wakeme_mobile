import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ALERT_RADIUS_OPTIONS,
  getAlertRadius,
  getTtsVolume,
  previewTts,
  setAlertRadius,
  setTtsVolume,
} from '../utils/nativeService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** 볼륨 값(0~1)을 레이블로 변환 */
function volumeLabel(v: number): string {
  if (v <= 0.1) return '아주 작게';
  if (v <= 0.3) return '작게';
  if (v <= 0.5) return '보통';
  if (v <= 0.7) return '크게';
  if (v <= 0.9) return '아주 크게';
  return '최대';
}

const TRACK_WIDTH = 260;

export default function SettingsModal({ visible, onClose }: Props) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [volume, setVolume] = useState(0.8);
  const volumeRef = useRef(0.8);       // PanResponder는 stale closure라 ref 사용
  const touchStartX = useRef(0);       // 터치 시작 시점의 트랙 내 x좌표 (고정)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const [alertRadius, setAlertRadiusState] = useState(500);

  // 모달 열릴 때 저장된 볼륨/반경 불러오기
  useEffect(() => {
    if (visible) {
      const saved = getTtsVolume();
      setVolume(saved);
      volumeRef.current = saved;
      setAlertRadiusState(getAlertRadius());
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(0);
    }
  }, [visible, slideAnim]);

  const handleSelectRadius = useCallback((radiusM: number) => {
    setAlertRadiusState(radiusM);
    setAlertRadius(radiusM);
  }, []);

  /** 슬라이더 위치(px) → 볼륨(0~1) */
  const pxToVolume = (px: number) =>
    Math.min(1, Math.max(0, Math.round((px / TRACK_WIDTH) * 20) / 20)); // 5% 단위

  /** 슬라이더 이동 처리 */
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        // 터치 시작 x를 고정으로 기억 (이후 gs.dx의 기준점)
        const x = Math.max(0, Math.min(TRACK_WIDTH, evt.nativeEvent.locationX));
        touchStartX.current = x;
        const newVol = pxToVolume(x);
        volumeRef.current = newVol;
        setVolume(newVol);
      },
      onPanResponderMove: (_evt, gs) => {
        // 절대 위치 = 터치 시작 x + 누적 이동거리 (gs.dx는 터치 시작 기준 누적값)
        const absX = touchStartX.current + gs.dx;
        const newVol = pxToVolume(absX);
        volumeRef.current = newVol;
        setVolume(newVol);
        // 이동 중 미리듣기 debounce (500ms)
        if (previewTimer.current) clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(() => previewTts(newVol), 500);
      },
      onPanResponderRelease: () => {
        // 손 뗐을 때 즉시 미리듣기 + 저장
        if (previewTimer.current) clearTimeout(previewTimer.current);
        previewTts(volumeRef.current);
        setTtsVolume(volumeRef.current);
      },
    }),
  ).current;

  const handleClose = useCallback(() => {
    setTtsVolume(volumeRef.current);
    onClose();
  }, [onClose]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  const thumbLeft = Math.round(volume * TRACK_WIDTH);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}>
      {/* 딤 배경 */}
      <Pressable style={styles.backdrop} onPress={handleClose} />

      <Animated.View style={[styles.sheet, { paddingBottom: 24 + bottomInset, transform: [{ translateY }] }]}>
        {/* 핸들 바 */}
        <View style={styles.handle} />

        <Text style={styles.title}>설정</Text>

        {/* TTS 볼륨 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🔊 음성 안내 볼륨</Text>
            <Text style={styles.sectionSub}>이어폰 연결 시 하차·환승 알림을 음성으로 안내합니다</Text>
          </View>

          {/* 볼륨 레이블 + 퍼센트 */}
          <View style={styles.volumeRow}>
            <Text style={styles.volumeLabel}>{volumeLabel(volume)}</Text>
            <Text style={styles.volumePct}>{Math.round(volume * 100)}%</Text>
          </View>

          {/* 슬라이더 트랙 */}
          <View style={styles.trackContainer} {...panResponder.panHandlers}>
            {/* 배경 트랙 */}
            <View style={styles.trackBg} />
            {/* 채워진 부분 */}
            <View style={[styles.trackFill, { width: thumbLeft }]} />
            {/* 썸 */}
            <View style={[styles.thumb, { left: thumbLeft - 12 }]} />
          </View>

          {/* 눈금 레이블 */}
          <View style={styles.tickRow}>
            <Text style={styles.tickLabel}>0%</Text>
            <Text style={styles.tickLabel}>50%</Text>
            <Text style={styles.tickLabel}>100%</Text>
          </View>

          {/* 미리듣기 버튼 */}
          <TouchableOpacity
            style={styles.previewBtn}
            activeOpacity={0.7}
            onPress={() => previewTts(volume)}>
            <Text style={styles.previewBtnText}>▶ 미리듣기</Text>
          </TouchableOpacity>
        </View>

        {/* 알림 반경 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>📍 하차·환승 알림 반경</Text>
            <Text style={styles.sectionSub}>
              목적지/환승지에 이 거리만큼 가까워지면 알림을 보냅니다. 정류장 간격이 좁은 도심은 짧게, 정류장이 드문 외곽·고속 구간은 길게 설정하세요.
            </Text>
          </View>

          <View style={styles.radiusRow}>
            {ALERT_RADIUS_OPTIONS.map(option => {
              const selected = option === alertRadius;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.radiusBtn, selected && styles.radiusBtnSelected]}
                  activeOpacity={0.7}
                  onPress={() => handleSelectRadius(option)}>
                  <Text style={[styles.radiusBtnText, selected && styles.radiusBtnTextSelected]}>
                    {option}m
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 닫기 버튼 */}
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.8}>
          <Text style={styles.closeBtnText}>닫기</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 12,
    color: '#888',
    lineHeight: 17,
  },
  volumeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  volumeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A73E8',
  },
  volumePct: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  trackContainer: {
    width: TRACK_WIDTH,
    height: 36,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E0E0E0',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1A73E8',
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 2.5,
    borderColor: '#1A73E8',
    shadowColor: '#1A73E8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    top: 6,
  },
  tickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: TRACK_WIDTH,
    alignSelf: 'center',
    marginTop: 6,
  },
  tickLabel: {
    fontSize: 11,
    color: '#aaa',
  },
  previewBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#1A73E8',
  },
  previewBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A73E8',
  },
  radiusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  radiusBtn: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    alignItems: 'center',
  },
  radiusBtnSelected: {
    borderColor: '#1A73E8',
    backgroundColor: '#EAF1FD',
  },
  radiusBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
  },
  radiusBtnTextSelected: {
    color: '#1A73E8',
  },
  closeBtn: {
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
