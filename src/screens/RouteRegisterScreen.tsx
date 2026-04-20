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
} from 'react-native';
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

export default function RouteRegisterScreen({ navigation }: Props) {
  const user = useAuthStore(s => s.user);
  const { addRoute, loading } = useRouteStore();

  const [routeName, setRouteName] = useState('');
  const [departTime, setDepartTime] = useState('');
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
    setSegments(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order_index: i })));
  };

  const handleSave = async () => {
    if (!routeName.trim()) {
      Alert.alert('알림', '경로 이름을 입력해주세요.');
      return;
    }
    if (!departTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert('알림', '출발 시간을 HH:MM 형식으로 입력해주세요. (예: 08:30)');
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

    await addRoute(user!.id, routeName.trim(), departTime, segments);
    navigation.goBack();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      {/* 기본 정보 */}
      <Text style={styles.label}>경로 이름</Text>
      <TextInput
        style={styles.input}
        placeholder="예) 학교 가는 길"
        value={routeName}
        onChangeText={setRouteName}
      />

      <Text style={styles.label}>출발 시간</Text>
      <TextInput
        style={styles.input}
        placeholder="HH:MM (예: 08:30)"
        value={departTime}
        onChangeText={setDepartTime}
        keyboardType="numeric"
        maxLength={5}
      />

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

          {/* 교통수단 선택 */}
          <View style={styles.modeRow}>
            {(['bus', 'subway'] as TransportMode[]).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.modeBtn, seg.mode === m && styles.modeBtnActive]}
                onPress={() => setMode(index, m)}>
                <Text style={[styles.modeBtnText, seg.mode === m && styles.modeBtnTextActive]}>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 16 },
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
    marginBottom: 40,
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
