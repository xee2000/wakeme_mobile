import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  FlatList,
  Platform,
  PermissionsAndroid,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { RootStackParamList, RouteSegment, TransportMode, BusStop } from '../types';
import { searchStops, fetchNearbyStops } from '../api/busApi';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteRegister'>;

const EMPTY_SEGMENT: Omit<RouteSegment, 'id' | 'route_id'> = {
  order_index: 0,
  mode: 'bus',
  bus_no: '',
  start_stop_name: '',
  start_stop_id: '',
  end_stop_name: '',
  end_stop_id: '',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 스크롤 휠 피커
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ITEM_H = 52;
const VISIBLE = 5;

interface WheelPickerProps {
  data: string[];
  selected: string;
  onChange: (val: string) => void;
  label: string;
}

function WheelPicker({ data, selected, onChange, label }: WheelPickerProps) {
  const ref = useRef<ScrollView>(null);
  const selectedIndex = data.indexOf(selected);
  const isScrolling = useRef(false);

  // 모달 열릴 때 현재 값으로 스크롤
  const scrollToSelected = useCallback((animated = false) => {
    const idx = Math.max(0, data.indexOf(selected));
    ref.current?.scrollTo({ y: idx * ITEM_H, animated });
  }, [selected, data]);

  const handleLayout = useCallback(() => {
    setTimeout(() => scrollToSelected(false), 50);
  }, [scrollToSelected]);

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const idx = Math.max(0, Math.min(data.length - 1, Math.round(y / ITEM_H)));
      onChange(data[idx]);
      isScrolling.current = false;
    },
    [data, onChange],
  );

  return (
    <View style={wp.wrap}>
      <Text style={wp.label}>{label}</Text>
      <View style={wp.box}>
        {/* 선택 영역 표시선 (텍스트 위에 오지 않게 포인터 이벤트 없음) */}
        <View style={wp.topLine} pointerEvents="none" />
        <View style={wp.bottomLine} pointerEvents="none" />

        <ScrollView
          ref={ref}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_H}
          decelerationRate="fast"
          onLayout={handleLayout}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
          style={{ height: ITEM_H * VISIBLE }}>
          {data.map((item, i) => (
            <TouchableOpacity
              key={item}
              style={[wp.item, { height: ITEM_H }]}
              onPress={() => {
                ref.current?.scrollTo({ y: i * ITEM_H, animated: true });
                onChange(item);
              }}
              activeOpacity={0.7}>
              <Text
                style={[
                  wp.itemText,
                  item === selected && wp.itemTextActive,
                  Math.abs(i - selectedIndex) === 1 && wp.itemTextNear,
                ]}>
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 시간 피커 모달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

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
  const [selH, setSelH] = useState(hour);
  const [selM, setSelM] = useState(minute);

  // 모달 열릴 때마다 현재 값으로 초기화
  useEffect(() => {
    if (visible) { setSelH(hour); setSelM(minute); }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={tp.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={tp.sheet}>
          <View style={tp.handle} />
          <Text style={tp.title}>출발 시간 선택</Text>

          <View style={tp.pickerRow}>
            <WheelPicker data={HOURS} selected={selH} onChange={setSelH} label="시" />
            <Text style={tp.colon}>:</Text>
            <WheelPicker data={MINUTES} selected={selM} onChange={setSelM} label="분" />
          </View>

          <View style={tp.btnRow}>
            <TouchableOpacity style={tp.cancelBtn} onPress={onClose}>
              <Text style={tp.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={tp.confirmBtn}
              onPress={() => { onConfirm(selH, selM); onClose(); }}>
              <Text style={tp.confirmText}>확인</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 정류장 선택 모달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function StopSelectModal({
  visible,
  title,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  onSelect: (stop: BusStop) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [stops, setStops] = useState<BusStop[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) { setQuery(''); setStops([]); }
  }, [visible]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const result = await searchStops(query.trim());
      setStops(result);
      if (result.length === 0) Alert.alert('결과 없음', '검색 결과가 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleNearby = async () => {
    setLoading(true);
    try {
      // 위치 권한 요청
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('위치 권한 필요', '근처 정류장을 찾으려면 위치 권한이 필요합니다.');
          setLoading(false);
          return;
        }
      }

      // GPS 위치 가져오기
      Geolocation.getCurrentPosition(
        async pos => {
          try {
            const result = await fetchNearbyStops(
              pos.coords.latitude,
              pos.coords.longitude,
            );
            setStops(result);
            if (result.length === 0)
              Alert.alert('결과 없음', '주변에 정류장이 없거나 API가 응답하지 않습니다.');
          } finally {
            setLoading(false);
          }
        },
        err => {
          setLoading(false);
          Alert.alert('위치 오류', err.message);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
      );
    } catch (e: any) {
      setLoading(false);
      Alert.alert('오류', e.message);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={ss.container}>
        {/* 헤더 */}
        <View style={ss.header}>
          <TouchableOpacity onPress={onClose} style={ss.closeBtn}>
            <Text style={ss.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={ss.headerTitle}>{title}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* 내 주변 정류장 버튼 */}
        <TouchableOpacity style={ss.nearbyBtn} onPress={handleNearby} disabled={loading}>
          <Text style={ss.nearbyIcon}>📍</Text>
          <Text style={ss.nearbyText}>내 주변 정류장 찾기</Text>
        </TouchableOpacity>

        {/* 이름 검색 */}
        <View style={ss.searchRow}>
          <TextInput
            style={ss.searchInput}
            placeholder="정류장 이름으로 검색"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          <TouchableOpacity style={ss.searchBtn} onPress={handleSearch}>
            <Text style={ss.searchBtnText}>검색</Text>
          </TouchableOpacity>
        </View>

        {/* 결과 목록 */}
        {loading ? (
          <View style={ss.center}>
            <ActivityIndicator size="large" color="#1A73E8" />
            <Text style={ss.loadingText}>검색 중...</Text>
          </View>
        ) : (
          <FlatList
            data={stops}
            keyExtractor={item => item.nodeId}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={
              <View style={ss.center}>
                <Text style={ss.emptyText}>
                  📍 버튼으로 주변 정류장을 찾거나{'\n'}이름으로 검색해보세요
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={ss.stopItem}
                onPress={() => { onSelect(item); onClose(); }}>
                <View style={{ flex: 1 }}>
                  <Text style={ss.stopName}>{item.nodeName}</Text>
                  <Text style={ss.stopId}>
                    {item.distance != null ? `📍 ${item.distance}m` : `코드: ${item.nodeId}`}
                  </Text>
                </View>
                <Text style={ss.selectArrow}>›</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 스크린
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  // 정류장 선택 모달 상태
  const [stopModal, setStopModal] = useState<{
    visible: boolean;
    segIndex: number;
    field: 'start' | 'end';
  }>({ visible: false, segIndex: 0, field: 'start' });

  const updateSegment = (
    index: number,
    patch: Partial<Omit<RouteSegment, 'id' | 'route_id'>>,
  ) => {
    setSegments(prev =>
      prev.map((seg, i) => (i === index ? { ...seg, ...patch } : seg)),
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
                ? { bus_no: '', start_stop_name: '', start_stop_id: '', end_stop_name: '', end_stop_id: '' }
                : { line_name: '', start_station: '', end_station: '' }),
            }
          : seg,
      ),
    );
  };

  const openStopModal = (segIndex: number, field: 'start' | 'end') => {
    setStopModal({ visible: true, segIndex, field });
  };

  const handleStopSelect = (stop: BusStop) => {
    const { segIndex, field } = stopModal;
    if (field === 'start') {
      updateSegment(segIndex, { start_stop_name: stop.nodeName, start_stop_id: stop.nodeId });
    } else {
      updateSegment(segIndex, { end_stop_name: stop.nodeName, end_stop_id: stop.nodeId });
    }
  };

  const addSegment = () =>
    setSegments(prev => [...prev, { ...EMPTY_SEGMENT, order_index: prev.length }]);

  const removeSegment = (index: number) => {
    if (segments.length === 1) return;
    setSegments(prev =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order_index: i })),
    );
  };

  const handleSave = async () => {
    if (!routeName.trim()) { Alert.alert('알림', '경로 이름을 입력해주세요.'); return; }
    for (const seg of segments) {
      if (seg.mode === 'bus' && !seg.bus_no?.trim()) {
        Alert.alert('알림', '버스 번호를 입력해주세요.'); return;
      }
      if (seg.mode === 'bus' && !seg.end_stop_name?.trim()) {
        Alert.alert('알림', '하차 정류장을 선택해주세요.'); return;
      }
      if (seg.mode === 'subway' && !seg.line_name?.trim()) {
        Alert.alert('알림', '지하철 노선명을 입력해주세요.'); return;
      }
    }
    await addRoute(user!.id, routeName.trim(), `${hour}:${minute}`, segments);
    navigation.goBack();
  };

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled">

        <Text style={styles.label}>경로 이름</Text>
        <TextInput
          style={styles.input}
          placeholder="예) 학교 가는 길"
          value={routeName}
          onChangeText={setRouteName}
        />

        {/* 출발 시간 */}
        <Text style={styles.label}>출발 시간</Text>
        <TouchableOpacity style={styles.timePicker} onPress={() => setShowTimePicker(true)}>
          <Text style={styles.timeValue}>{hour} : {minute}</Text>
          <Text style={styles.timeChevron}>⏰ 탭하여 변경</Text>
        </TouchableOpacity>

        {/* 구간 */}
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

            {/* 교통수단 */}
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
                  onChangeText={v => updateSegment(index, { bus_no: v })}
                  keyboardType="numeric"
                />

                {/* 승차 정류장 */}
                <Text style={styles.fieldLabel}>승차 정류장</Text>
                <TouchableOpacity
                  style={styles.stopPicker}
                  onPress={() => openStopModal(index, 'start')}>
                  <Text style={seg.start_stop_name ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.start_stop_name || '📍 정류장 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>

                {/* 하차 정류장 */}
                <Text style={styles.fieldLabel}>하차 정류장</Text>
                <TouchableOpacity
                  style={[styles.stopPicker, { borderColor: '#E53935' }]}
                  onPress={() => openStopModal(index, 'end')}>
                  <Text style={seg.end_stop_name ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.end_stop_name || '🚏 하차 정류장 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput style={styles.input} placeholder="노선명 (예: 1호선)"
                  value={seg.line_name} onChangeText={v => updateSegment(index, { line_name: v })} />
                <TextInput style={styles.input} placeholder="승차 역 이름"
                  value={seg.start_station} onChangeText={v => updateSegment(index, { start_station: v })} />
                <TextInput style={styles.input} placeholder="하차 역 이름"
                  value={seg.end_station} onChangeText={v => updateSegment(index, { end_station: v })} />
              </>
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addSegBtn} onPress={addSegment}>
          <Text style={styles.addSegBtnText}>+ 구간 추가 (환승)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>경로 저장</Text>}
        </TouchableOpacity>
      </ScrollView>

      {/* 시간 피커 */}
      <TimePickerModal
        visible={showTimePicker}
        hour={hour}
        minute={minute}
        onConfirm={(h, m) => { setHour(h); setMinute(m); }}
        onClose={() => setShowTimePicker(false)}
      />

      {/* 정류장 선택 */}
      <StopSelectModal
        visible={stopModal.visible}
        title={stopModal.field === 'start' ? '승차 정류장 선택' : '하차 정류장 선택'}
        onSelect={handleStopSelect}
        onClose={() => setStopModal(s => ({ ...s, visible: false }))}
      />
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 스타일
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 16 },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0', marginBottom: 8,
  },
  timePicker: {
    backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: '#1A73E8', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  timeValue: { fontSize: 24, fontWeight: '800', color: '#1A73E8', letterSpacing: 3 },
  timeChevron: { fontSize: 12, color: '#1A73E8' },
  stopPicker: {
    backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1.5, borderColor: '#1A73E8', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  stopSelected: { fontSize: 15, color: '#222', fontWeight: '600', flex: 1 },
  stopPlaceholder: { fontSize: 14, color: '#aaa', flex: 1 },
  stopArrow: { fontSize: 20, color: '#1A73E8', fontWeight: '700' },
  segCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: '#E8EAF0',
  },
  segHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  segTitle: { fontSize: 15, fontWeight: '700', color: '#222' },
  removeText: { fontSize: 13, color: '#E53935' },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  modeBtn: {
    flex: 1, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#DDD', backgroundColor: '#F5F5F5',
  },
  modeBtnActive: { backgroundColor: '#E8F0FE', borderColor: '#1A73E8' },
  modeBtnText: { fontSize: 14, color: '#666' },
  modeBtnTextActive: { color: '#1A73E8', fontWeight: '700' },
  addSegBtn: {
    height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1A73E8', borderStyle: 'dashed', marginBottom: 16,
  },
  addSegBtnText: { color: '#1A73E8', fontWeight: '600', fontSize: 14 },
  saveBtn: { height: 52, backgroundColor: '#1A73E8', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

// WheelPicker 스타일
const wp = StyleSheet.create({
  wrap: { alignItems: 'center', flex: 1 },
  label: { fontSize: 13, color: '#888', marginBottom: 6 },
  box: { width: 100, position: 'relative' },
  topLine: {
    position: 'absolute', top: ITEM_H * 2, left: 8, right: 8,
    height: 2, backgroundColor: '#1A73E8', zIndex: 10,
  },
  bottomLine: {
    position: 'absolute', top: ITEM_H * 3 - 2, left: 8, right: 8,
    height: 2, backgroundColor: '#1A73E8', zIndex: 10,
  },
  item: { alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 18, color: '#ccc', fontWeight: '400' },
  itemTextNear: { fontSize: 22, color: '#999', fontWeight: '500' },
  itemTextActive: { fontSize: 30, color: '#1A73E8', fontWeight: '900' },
});

// TimePicker 스타일
const tp = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: '#DDD', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', color: '#222', textAlign: 'center', marginBottom: 16 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  colon: { fontSize: 36, fontWeight: '900', color: '#333', marginHorizontal: 8, marginTop: 16 },
  btnRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 24, marginTop: 20 },
  cancelBtn: { flex: 1, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F0F0' },
  cancelText: { fontSize: 15, color: '#666', fontWeight: '600' },
  confirmBtn: { flex: 1, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A73E8' },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});

// StopSelect 스타일
const ss = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE' },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 18, color: '#666' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#222' },
  nearbyBtn: {
    flexDirection: 'row', alignItems: 'center', margin: 16, padding: 16,
    backgroundColor: '#1A73E8', borderRadius: 12, gap: 8,
  },
  nearbyIcon: { fontSize: 20 },
  nearbyText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  searchRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  searchInput: {
    flex: 1, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#E0E0E0',
  },
  searchBtn: { backgroundColor: '#1A73E8', borderRadius: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#888', fontSize: 14 },
  emptyText: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  stopItem: {
    backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  stopName: { fontSize: 15, fontWeight: '600', color: '#222' },
  stopId: { fontSize: 12, color: '#aaa', marginTop: 2 },
  selectArrow: { fontSize: 24, color: '#1A73E8', fontWeight: '700' },
});
