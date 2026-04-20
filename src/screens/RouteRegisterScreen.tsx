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
  Dimensions,
} from 'react-native';
import MapView, { Marker, Circle, Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Geolocation from 'react-native-geolocation-service';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { RootStackParamList, RouteSegment, TransportMode, BusStop } from '../types';
import { searchStops, fetchNearbyStops, fetchRoutesByStop } from '../api/busApi';

type Props = NativeStackScreenProps<RootStackParamList, 'RouteRegister'>;

const SCREEN_H = Dimensions.get('window').height;

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
    },
    [data, onChange],
  );

  return (
    <View style={wp.wrap}>
      <Text style={wp.label}>{label}</Text>
      <View style={wp.box}>
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
  visible, hour, minute, onConfirm, onClose,
}: {
  visible: boolean; hour: string; minute: string;
  onConfirm: (h: string, m: string) => void; onClose: () => void;
}) {
  const [selH, setSelH] = useState(hour);
  const [selM, setSelM] = useState(minute);

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
// 지도 정류장 선택 모달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface RouteInfo { routeId: string; routeNo: string; routeType: string; startStop: string; endStop: string; }

function MapStopSelectModal({
  visible,
  title,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  onSelect: (stop: BusStop, routeNo?: string) => void;
  onClose: () => void;
}) {
  const mapRef = useRef<MapView>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [region, setRegion] = useState<Region>({
    latitude: 36.3504, longitude: 127.3845,
    latitudeDelta: 0.01, longitudeDelta: 0.01,
  });
  const [nearbyStops, setNearbyStops] = useState<BusStop[]>([]);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);

  // 노선 선택 단계
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);

  // 모달 열릴 때 내 위치로 이동 + 주변 정류장 로드
  useEffect(() => {
    if (!visible) {
      setSelectedStop(null);
      setNearbyStops([]);
      setShowRoutes(false);
      setRoutes([]);
      return;
    }
    loadCurrentLocation();
  }, [visible]);

  const loadCurrentLocation = async () => {
    setLoadingLocation(true);
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('위치 권한 필요', '정류장을 찾으려면 위치 권한이 필요합니다.');
          setLoadingLocation(false);
          return;
        }
      }
      Geolocation.getCurrentPosition(
        async pos => {
          const { latitude, longitude } = pos.coords;
          setUserLocation({ lat: latitude, lng: longitude });
          const newRegion: Region = {
            latitude, longitude,
            latitudeDelta: 0.008, longitudeDelta: 0.008,
          };
          setRegion(newRegion);
          mapRef.current?.animateToRegion(newRegion, 800);

          try {
            const stops = await fetchNearbyStops(latitude, longitude);
            setNearbyStops(stops);
          } finally {
            setLoadingLocation(false);
          }
        },
        err => {
          setLoadingLocation(false);
          Alert.alert('위치 오류', err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
      );
    } catch (e: any) {
      setLoadingLocation(false);
      Alert.alert('오류', e.message);
    }
  };

  // 마커 탭 → 정류장 선택
  const handleMarkerPress = (stop: BusStop) => {
    setSelectedStop(stop);
    setShowRoutes(false);
    setRoutes([]);
    // 해당 정류장으로 지도 이동
    mapRef.current?.animateToRegion({
      latitude: stop.gpslati,
      longitude: stop.gpslong,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    }, 400);
  };

  // "등록" 버튼 → 노선 조회
  const handleRegister = async () => {
    if (!selectedStop) return;
    setRouteLoading(true);
    setShowRoutes(true);
    try {
      const result = await fetchRoutesByStop(selectedStop.nodeId);
      setRoutes(result);
    } finally {
      setRouteLoading(false);
    }
  };

  // 노선 선택 완료
  const handleRoutePress = (route: RouteInfo) => {
    if (selectedStop) { onSelect(selectedStop, route.routeNo); onClose(); }
  };

  // 정류장만 선택
  const handleSelectStopOnly = () => {
    if (selectedStop) { onSelect(selectedStop); onClose(); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={ms.container}>
        {/* 헤더 */}
        <View style={ms.header}>
          <TouchableOpacity
            onPress={showRoutes ? () => setShowRoutes(false) : onClose}
            style={ms.closeBtn}>
            <Text style={ms.closeText}>{showRoutes ? '←' : '✕'}</Text>
          </TouchableOpacity>
          <Text style={ms.headerTitle}>
            {showRoutes && selectedStop
              ? `${selectedStop.nodeName} 노선 선택`
              : title}
          </Text>
          <TouchableOpacity onPress={loadCurrentLocation} style={ms.relocateBtn} disabled={loadingLocation}>
            {loadingLocation
              ? <ActivityIndicator size="small" color="#1A73E8" />
              : <Text style={ms.relocateText}>📍</Text>}
          </TouchableOpacity>
        </View>

        {!showRoutes ? (
          <>
            {/* 지도 */}
            <MapView
              ref={mapRef}
              style={ms.map}
              region={region}
              onRegionChangeComplete={setRegion}
              showsUserLocation
              showsMyLocationButton={false}>

              {/* 현재 위치 강조 원 */}
              {userLocation && (
                <Circle
                  center={{ latitude: userLocation.lat, longitude: userLocation.lng }}
                  radius={400}
                  fillColor="rgba(26,115,232,0.08)"
                  strokeColor="rgba(26,115,232,0.3)"
                  strokeWidth={1}
                />
              )}

              {/* 정류장 마커 */}
              {nearbyStops.map(stop => (
                <Marker
                  key={stop.nodeId}
                  coordinate={{ latitude: stop.gpslati, longitude: stop.gpslong }}
                  title={stop.nodeName}
                  description={stop.distance != null ? `${stop.distance}m` : undefined}
                  onPress={() => handleMarkerPress(stop)}
                  pinColor={selectedStop?.nodeId === stop.nodeId ? '#E53935' : '#1A73E8'}
                />
              ))}
            </MapView>

            {/* 선택된 정류장 바텀 카드 */}
            {selectedStop ? (
              <View style={ms.bottomCard}>
                <View style={ms.stopCardInfo}>
                  <Text style={ms.stopCardName}>{selectedStop.nodeName}</Text>
                  <Text style={ms.stopCardDist}>
                    {selectedStop.distance != null ? `📍 ${selectedStop.distance}m` : `코드: ${selectedStop.nodeId}`}
                  </Text>
                </View>
                <TouchableOpacity style={ms.registerBtn} onPress={handleRegister}>
                  <Text style={ms.registerBtnText}>등록</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={ms.hintBar}>
                <Text style={ms.hintText}>
                  {loadingLocation
                    ? '내 위치를 불러오는 중...'
                    : nearbyStops.length > 0
                    ? `주변 정류장 ${nearbyStops.length}개 • 마커를 눌러 선택`
                    : '지도를 이동하거나 📍 버튼으로 현재 위치를 찾아보세요'}
                </Text>
              </View>
            )}
          </>
        ) : (
          /* ── 노선 선택 단계 ── */
          <>
            <View style={ms.stopInfoBar}>
              <Text style={ms.stopInfoText}>🚏 {selectedStop?.nodeName}</Text>
              <TouchableOpacity onPress={handleSelectStopOnly}>
                <Text style={ms.stopOnlyText}>노선 없이 선택</Text>
              </TouchableOpacity>
            </View>

            {routeLoading ? (
              <View style={ms.center}>
                <ActivityIndicator size="large" color="#1A73E8" />
                <Text style={ms.loadingText}>노선 조회 중...</Text>
              </View>
            ) : routes.length === 0 ? (
              <View style={ms.center}>
                <Text style={ms.emptyText}>이 정류장의 노선 정보를{'\n'}불러올 수 없습니다.</Text>
                <TouchableOpacity style={ms.fallbackBtn} onPress={handleSelectStopOnly}>
                  <Text style={ms.fallbackBtnText}>정류장만 선택하기</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={routes}
                keyExtractor={(item, i) => `${item.routeId}-${i}`}
                contentContainerStyle={{ padding: 16 }}
                ListHeaderComponent={
                  <Text style={ms.routeCount}>총 {routes.length}개 노선 경유</Text>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity style={ms.routeItem} onPress={() => handleRoutePress(item)}>
                    <View style={ms.routeNoBox}>
                      <Text style={ms.routeNo}>{item.routeNo}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      {item.startStop ? (
                        <Text style={ms.routeDir}>{item.startStop} → {item.endStop}</Text>
                      ) : (
                        <Text style={ms.routeDir}>노선 선택</Text>
                      )}
                      {item.routeType ? <Text style={ms.routeType}>{item.routeType}</Text> : null}
                    </View>
                    <Text style={ms.selectArrow}>›</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </>
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

  const handleStopSelect = (stop: BusStop, routeNo?: string) => {
    const { segIndex, field } = stopModal;
    if (field === 'start') {
      updateSegment(segIndex, {
        start_stop_name: stop.nodeName,
        start_stop_id: stop.nodeId,
        ...(routeNo ? { bus_no: routeNo } : {}),
      });
    } else {
      updateSegment(segIndex, {
        end_stop_name: stop.nodeName,
        end_stop_id: stop.nodeId,
        ...(routeNo ? { bus_no: routeNo } : {}),
      });
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

                <Text style={styles.fieldLabel}>승차 정류장</Text>
                <TouchableOpacity
                  style={styles.stopPicker}
                  onPress={() => openStopModal(index, 'start')}>
                  <Text style={seg.start_stop_name ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.start_stop_name || '🗺️ 지도에서 정류장 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>하차 정류장</Text>
                <TouchableOpacity
                  style={[styles.stopPicker, { borderColor: '#E53935' }]}
                  onPress={() => openStopModal(index, 'end')}>
                  <Text style={seg.end_stop_name ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.end_stop_name || '🗺️ 지도에서 정류장 선택'}
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

      {/* 지도 정류장 선택 */}
      <MapStopSelectModal
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

// MapStopSelect 스타일
const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 20, color: '#666' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#222', flex: 1, textAlign: 'center' },
  relocateBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  relocateText: { fontSize: 22 },
  map: { flex: 1 },
  hintBar: {
    backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: '#EEE',
  },
  hintText: { fontSize: 13, color: '#888', textAlign: 'center' },
  bottomCard: {
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#EEE',
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 6,
  },
  stopCardInfo: { flex: 1 },
  stopCardName: { fontSize: 16, fontWeight: '700', color: '#222' },
  stopCardDist: { fontSize: 12, color: '#888', marginTop: 2 },
  registerBtn: {
    backgroundColor: '#1A73E8', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  registerBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  stopInfoBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#E8F0FE', paddingHorizontal: 16, paddingVertical: 12,
  },
  stopInfoText: { fontSize: 14, fontWeight: '700', color: '#1A73E8', flex: 1 },
  stopOnlyText: { fontSize: 12, color: '#888', textDecorationLine: 'underline' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: '#888', fontSize: 14 },
  emptyText: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  routeCount: { fontSize: 13, color: '#888', marginBottom: 10 },
  routeItem: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  routeNoBox: {
    minWidth: 56, paddingHorizontal: 10, height: 40, backgroundColor: '#1A73E8',
    borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  routeNo: { fontSize: 16, fontWeight: '900', color: '#fff' },
  routeDir: { fontSize: 13, color: '#444', fontWeight: '500' },
  routeType: { fontSize: 11, color: '#aaa', marginTop: 2 },
  selectArrow: { fontSize: 24, color: '#1A73E8', fontWeight: '700' },
  fallbackBtn: {
    marginTop: 16, paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: '#1A73E8', borderRadius: 10,
  },
  fallbackBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
