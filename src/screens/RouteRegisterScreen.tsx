import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { RootStackParamList, RouteSegment, TransportMode } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteRegister'>;

const EMPTY_SEGMENT: Omit<RouteSegment, 'id' | 'route_id'> = {
  order_index: 0,
  mode: 'bus',
  bus_no: '',
  start_stop_name: '',
  end_stop_name: '',
};

// ── 시간 피커 모달 (+/- 버튼) ────────────────────────────────────
function TimePickerModal({
  visible,
  hour,
  minute,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  hour: string;
  minute: string;
  onConfirm: (h: string, m: string) => void;
  onClose: () => void;
}) {
  const [h, setH] = useState(Number(hour));
  const [m, setM] = useState(Number(minute));

  const pad = (n: number) => String(n).padStart(2, '0');

  const changeH = (delta: number) => setH(prev => (prev + delta + 24) % 24);
  const changeM = (delta: number) => setM(prev => (prev + delta + 60) % 60);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={tp.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={tp.sheet}>
          <Text style={tp.title}>출발 시간 선택</Text>

          <View style={tp.row}>
            {/* 시 */}
            <View style={tp.col}>
              <Text style={tp.colLabel}>시</Text>
              <TouchableOpacity style={tp.arrowBtn} onPress={() => changeH(1)}>
                <Text style={tp.arrow}>▲</Text>
              </TouchableOpacity>
              <View style={tp.valueBox}>
                <Text style={tp.valueText}>{pad(h)}</Text>
              </View>
              <TouchableOpacity style={tp.arrowBtn} onPress={() => changeH(-1)}>
                <Text style={tp.arrow}>▼</Text>
              </TouchableOpacity>
            </View>

            <Text style={tp.colon}>:</Text>

            {/* 분 */}
            <View style={tp.col}>
              <Text style={tp.colLabel}>분</Text>
              <TouchableOpacity style={tp.arrowBtn} onPress={() => changeM(5)}>
                <Text style={tp.arrow}>▲</Text>
              </TouchableOpacity>
              <View style={tp.valueBox}>
                <Text style={tp.valueText}>{pad(m)}</Text>
              </View>
              <TouchableOpacity style={tp.arrowBtn} onPress={() => changeM(-5)}>
                <Text style={tp.arrow}>▼</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={tp.hint}>▲▼ 5분 단위 조정 · 자정 넘으면 자동 순환</Text>

          <View style={tp.btnRow}>
            <TouchableOpacity style={tp.cancelBtn} onPress={onClose}>
              <Text style={tp.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={tp.confirmBtn}
              onPress={() => { onConfirm(pad(h), pad(m)); onClose(); }}>
              <Text style={tp.confirmText}>확인</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── 메인 스크린 ──────────────────────────────────────────────────
export default function RouteRegisterScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { addRoute, loading } = useRouteStore();

  const [routeName, setRouteName] = useState('');
  const [hour, setHour] = useState('08');
  const [minute, setMinute] = useState('00');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [segments, setSegments] = useState<Omit<RouteSegment, 'id' | 'route_id'>[]>([
    { ...EMPTY_SEGMENT },
  ]);

  const updateSegment = (
    index: number,
    field: keyof Omit<RouteSegment, 'id' | 'route_id'>,
    value: string,
  ) => {
    setSegments(prev =>
      prev.map((seg, i) => (i === index ? { ...seg, [field]: value } : seg)),
    );
  };

  const setMode = (index: number, mode: TransportMode) => {
    setSegments(prev =>
      prev.map((seg, i) =>
        i === index
          ? {
              order_index: seg.order_index,
              mode,
              ...(mode === 'bus'
                ? { bus_no: '', start_stop_name: '', end_stop_name: '' }
                : { line_name: '', start_station: '', end_station: '' }),
            }
          : seg,
      ),
    );
  };

  const addSegment = () => {
    setSegments(prev => [
      ...prev,
      { ...EMPTY_SEGMENT, order_index: prev.length },
    ]);
  };

  const removeSegment = (index: number) => {
    if (segments.length === 1) return;
    setSegments(prev =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order_index: i })),
    );
  };

  const handleSave = async () => {
    if (!routeName.trim()) {
      Alert.alert('알림', '경로 이름을 입력해주세요.');
      return;
    }
    for (const seg of segments) {
      if (seg.mode === 'bus' && !seg.bus_no?.trim()) {
        Alert.alert('알림', '버스 번호를 입력해주세요.');
        return;
      }
      if (seg.mode === 'subway' && !seg.line_name?.trim()) {
        Alert.alert('알림', '지하철 노선명을 입력해주세요.');
        return;
      }
    }

    await addRoute(user!.id, routeName.trim(), `${hour}:${minute}`, segments);
    navigation.goBack();
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 100,
        }}
        keyboardShouldPersistTaps="handled">

        {/* 경로 이름 */}
        <Text style={styles.label}>경로 이름</Text>
        <TextInput
          style={styles.input}
          placeholder="예) 학교 가는 길"
          value={routeName}
          onChangeText={setRouteName}
        />

        {/* 출발 시간 — 다이얼 피커 */}
        <Text style={styles.label}>출발 시간</Text>
        <TouchableOpacity
          style={styles.timePicker}
          onPress={() => setShowTimePicker(true)}>
          <Text style={styles.timeValue}>{hour} : {minute}</Text>
          <Text style={styles.timeChevron}>⏰</Text>
        </TouchableOpacity>

        {/* 구간 목록 */}
        <Text style={[styles.label, { marginTop: 8 }]}>구간 정보</Text>

        {segments.map((seg, index) => (
          <View key={index} style={styles.segCard}>
            <View style={styles.segHeader}>
              <Text style={styles.segTitle}>구간 {index + 1}</Text>
              {segments.length > 1 && (
                <TouchableOpacity onPress={() => removeSegment(index)}>
                  <Text style={styles.removeText}>제거</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.modeRow}>
              {(['bus', 'subway'] as TransportMode[]).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, seg.mode === m && styles.modeBtnActive]}
                  onPress={() => setMode(index, m)}>
                  <Text
                    style={[
                      styles.modeBtnText,
                      seg.mode === m && styles.modeBtnTextActive,
                    ]}>
                    {m === 'bus' ? '🚌 버스' : '🚇 지하철'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {seg.mode === 'bus' ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="버스 번호 (예: 107)"
                  value={seg.bus_no}
                  onChangeText={v => updateSegment(index, 'bus_no', v)}
                  keyboardType="numeric"
                />
                <TextInput
                  style={styles.input}
                  placeholder="승차 정류장 이름"
                  value={seg.start_stop_name}
                  onChangeText={v => updateSegment(index, 'start_stop_name', v)}
                />
                <TextInput
                  style={styles.input}
                  placeholder="하차 정류장 이름"
                  value={seg.end_stop_name}
                  onChangeText={v => updateSegment(index, 'end_stop_name', v)}
                />
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="노선명 (예: 1호선)"
                  value={seg.line_name}
                  onChangeText={v => updateSegment(index, 'line_name', v)}
                />
                <TextInput
                  style={styles.input}
                  placeholder="승차 역 이름"
                  value={seg.start_station}
                  onChangeText={v => updateSegment(index, 'start_station', v)}
                />
                <TextInput
                  style={styles.input}
                  placeholder="하차 역 이름"
                  value={seg.end_station}
                  onChangeText={v => updateSegment(index, 'end_station', v)}
                />
              </>
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addSegBtn} onPress={addSegment}>
          <Text style={styles.addSegBtnText}>+ 구간 추가 (환승)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSave}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>경로 저장</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <TimePickerModal
        visible={showTimePicker}
        hour={hour}
        minute={minute}
        onConfirm={(h, m) => { setHour(h); setMinute(m); }}
        onClose={() => setShowTimePicker(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginBottom: 8,
  },
  timePicker: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timeValue: { fontSize: 22, fontWeight: '700', color: '#1A73E8', letterSpacing: 2 },
  timeChevron: { fontSize: 20 },
  segCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8EAF0',
  },
  segHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  segTitle: { fontSize: 15, fontWeight: '700', color: '#222' },
  removeText: { fontSize: 13, color: '#E53935' },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: '#F5F5F5',
  },
  modeBtnActive: { backgroundColor: '#E8F0FE', borderColor: '#1A73E8' },
  modeBtnText: { fontSize: 14, color: '#666' },
  modeBtnTextActive: { color: '#1A73E8', fontWeight: '700' },
  addSegBtn: {
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1A73E8',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  addSegBtnText: { color: '#1A73E8', fontWeight: '600', fontSize: 14 },
  saveBtn: {
    height: 52,
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

// ── 타임피커 스타일 ──────────────────────────────────────────────
const tp = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 36,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#222',
    textAlign: 'center',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  col: { alignItems: 'center', width: 100 },
  colLabel: { fontSize: 13, color: '#888', marginBottom: 8 },
  arrowBtn: {
    width: 64,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F7FA',
    borderRadius: 10,
  },
  arrow: { fontSize: 18, color: '#1A73E8', fontWeight: '700' },
  valueBox: {
    width: 80,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1A73E8',
    borderRadius: 12,
    marginVertical: 8,
    backgroundColor: '#EEF4FF',
  },
  valueText: { fontSize: 36, fontWeight: '900', color: '#1A73E8' },
  colon: {
    fontSize: 32,
    fontWeight: '800',
    color: '#333',
    marginHorizontal: 12,
    marginTop: 32,
  },
  hint: {
    fontSize: 12,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 20,
  },
  btnRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0F0F0',
  },
  cancelText: { fontSize: 15, color: '#666', fontWeight: '600' },
  confirmBtn: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A73E8',
  },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
