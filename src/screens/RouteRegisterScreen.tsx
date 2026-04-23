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
  KeyboardAvoidingView,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import {
  NaverMapView,
  NaverMapMarkerOverlay,
  NaverMapCircleOverlay,
  type NaverMapViewRef,
} from '@mj-studio/react-native-naver-map';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuthStore } from '../store/useAuthStore';
import { useRouteStore } from '../store/useRouteStore';
import { RootStackParamList, RouteSegment, TransportMode, BusStop } from '../types';
import { searchStops, fetchNearbyStops, fetchRoutesByStop, fetchSubwayStations, SubwayStation } from '../api/busApi';

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
  skipRouteSelection,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** 하차 정류장처럼 노선 선택이 필요 없을 때 true */
  skipRouteSelection?: boolean;
  onSelect: (stop: BusStop, routeNo?: string) => void;
  onClose: () => void;
}) {
  const mapRef = useRef<NaverMapViewRef>(null);
  const [nearbyStops, setNearbyStops] = useState<BusStop[]>([]);
  const [loadingStops, setLoadingStops] = useState(false);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);

  // 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BusStop[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 노선 선택 단계
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showRoutes, setShowRoutes] = useState(false);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!text.trim()) { setSearchResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const results = await searchStops(text.trim());
        setSearchResults(results);
      } finally {
        setSearchLoading(false);
      }
    }, 400);
  }, []);

  // 모달 열릴 때 위치 추적 활성화 (Naver Maps SDK 내부 GPS — react-native-geolocation 미사용)
  useEffect(() => {
    if (!visible) {
      setSelectedStop(null);
      setNearbyStops([]);
      setShowRoutes(false);
      setRoutes([]);
      setUserLat(null);
      setUserLng(null);
      setSearchQuery('');
      setSearchResults([]);
      return;
    }
    // 지도가 렌더된 후 Follow 모드 시작
    const timer = setTimeout(() => {
      mapRef.current?.setLocationTrackingMode('Follow');
    }, 400);
    return () => clearTimeout(timer);
  }, [visible]);

  // 위치 추적으로 카메라가 이동하면 주변 정류장 조회
  const handleCameraChanged = useCallback(
    async (params: { latitude: number; longitude: number; reason: string }) => {
      if (params.reason !== 'Location') return;
      const { latitude, longitude } = params;
      setUserLat(latitude);
      setUserLng(longitude);
      setLoadingStops(true);
      try {
        const stops = await fetchNearbyStops(latitude, longitude);
        setNearbyStops(stops);
      } finally {
        setLoadingStops(false);
      }
    },
    [],
  );

  // 마커 탭 → 정류장 선택
  const handleMarkerTap = (stop: BusStop) => {
    setSelectedStop(stop);
    setShowRoutes(false);
    setRoutes([]);
    mapRef.current?.animateCameraTo({
      latitude: stop.gpslati,
      longitude: stop.gpslong,
      zoom: 17,
      duration: 400,
    });
  };

  // 재탐색 버튼 → 다시 Follow 모드
  const handleRelocate = () => {
    mapRef.current?.setLocationTrackingMode('Follow');
  };

  // "등록" 버튼 → 노선 조회 (하차인 경우 바로 완료)
  const handleRegister = async () => {
    if (!selectedStop) return;
    if (skipRouteSelection) {
      onSelect(selectedStop);
      onClose();
      return;
    }
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

  const isSearching = searchQuery.trim().length > 0;

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
          <TouchableOpacity onPress={handleRelocate} style={ms.relocateBtn}>
            <Text style={ms.relocateText}>📍</Text>
          </TouchableOpacity>
        </View>

        {/* 검색창 */}
        {!showRoutes && (
          <View style={ms.searchBar}>
            <TextInput
              style={ms.searchInput}
              placeholder="정류장 이름으로 검색..."
              value={searchQuery}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {searchLoading && <ActivityIndicator size="small" color="#1A73E8" style={{ marginLeft: 8 }} />}
          </View>
        )}

        {/* 검색 결과 목록 */}
        {!showRoutes && isSearching && (
          <FlatList
            data={searchResults}
            keyExtractor={(item, i) => `${item.nodeId}-${i}`}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1, backgroundColor: '#fff' }}
            contentContainerStyle={{ padding: 12 }}
            ListEmptyComponent={
              !searchLoading ? (
                <View style={ms.center}>
                  <Text style={ms.emptyText}>검색 결과가 없습니다.</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={ms.searchResultItem}
                onPress={() => {
                  setNearbyStops(prev =>
                    prev.some(s => s.nodeId === item.nodeId) ? prev : [item, ...prev],
                  );
                  setSearchQuery('');
                  setSearchResults([]);
                  setTimeout(() => handleMarkerTap(item), 50);
                }}>
                <Text style={ms.searchResultName}>🚏 {item.nodeName}</Text>
                <Text style={ms.searchResultId}>{item.nodeId}</Text>
              </TouchableOpacity>
            )}
          />
        )}

        {!showRoutes ? (
          <View style={{ flex: 1, display: isSearching ? 'none' : 'flex' }}>
            {/* 네이버 지도 — isShowLocationButton=true: SDK 내부 GPS 처리 */}
            <NaverMapView
              ref={mapRef}
              style={ms.map}
              initialCamera={{ latitude: 36.3504, longitude: 127.3845, zoom: 14 }}
              isShowLocationButton={true}
              isShowZoomControls={true}
              isShowCompass={false}
              onCameraChanged={handleCameraChanged}
              onInitialized={() => console.log('[NaverMap] 초기화 성공')}
              onOptionChanged={() => console.log('[NaverMap] 옵션 변경됨')}>

              {/* 현재 위치 반경 표시 */}
              {userLat !== null && userLng !== null && (
                <NaverMapCircleOverlay
                  latitude={userLat}
                  longitude={userLng}
                  radius={400}
                  color="rgba(26,115,232,0.06)"
                  outlineColor="rgba(26,115,232,0.3)"
                  outlineWidth={1}
                />
              )}

              {/* 정류장 마커 */}
              {nearbyStops.map(stop => (
                <NaverMapMarkerOverlay
                  key={stop.nodeId}
                  latitude={stop.gpslati}
                  longitude={stop.gpslong}
                  caption={{ text: stop.nodeName, textSize: 11, color: '#222' }}
                  image={
                    selectedStop?.nodeId === stop.nodeId
                      ? { symbol: 'red' }
                      : { symbol: 'blue' }
                  }
                  width={32}
                  height={40}
                  onTap={() => handleMarkerTap(stop)}
                />
              ))}
            </NaverMapView>

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
                  <Text style={ms.registerBtnText}>
                    {skipRouteSelection ? '선택' : '등록'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={ms.hintBar}>
                <Text style={ms.hintText}>
                  {loadingStops
                    ? '주변 정류장 불러오는 중...'
                    : nearbyStops.length > 0
                    ? `주변 정류장 ${nearbyStops.length}개 • 마커를 눌러 선택`
                    : '지도 우측 📍 버튼으로 내 위치를 찾아보세요'}
                </Text>
              </View>
            )}
          </View>
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
                      {item.routeType ? <Text style={ms.routeNoType}>{item.routeType}</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      {item.endStop ? (
                        <>
                          <Text style={ms.routeDestLabel}>방향</Text>
                          <Text style={ms.routeDest}>{item.endStop}</Text>
                          {item.startStop ? (
                            <Text style={ms.routeDir}>{item.startStop} 출발</Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={ms.routeDir}>노선 선택</Text>
                      )}
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
// 버스 번호 태그 입력
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function BusNoTagInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [input, setInput] = useState('');
  const tags = value ? value.split(',').map(s => s.trim()).filter(Boolean) : [];

  const addTag = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!tags.includes(trimmed)) onChange([...tags, trimmed].join(','));
    setInput('');
  };

  const removeTag = (tag: string) => onChange(tags.filter(t => t !== tag).join(','));

  return (
    <View>
      <View style={styles.tagRow}>
        {tags.map(tag => (
          <TouchableOpacity key={tag} style={styles.tag} onPress={() => removeTag(tag)}>
            <Text style={styles.tagText}>{tag}</Text>
            <Text style={styles.tagRemove}> ✕</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.tagInputRow}>
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          placeholder="번호 입력 후 + 버튼"
          value={input}
          onChangeText={setInput}
          keyboardType="numeric"
          onSubmitEditing={addTag}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.tagAddBtn} onPress={addTag}>
          <Text style={styles.tagAddText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 대전 지하철 호선 선택
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const DAEJEON_LINES = [
  { label: '1호선', color: '#F5A200' },
];

function SubwayLinePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.lineRow}>
      {DAEJEON_LINES.map(line => (
        <TouchableOpacity
          key={line.label}
          style={[styles.lineBtn, { borderColor: line.color }, value === line.label && { backgroundColor: line.color }]}
          onPress={() => onChange(line.label)}>
          <Text style={[styles.lineBtnText, value === line.label && { color: '#fff' }]}>
            {line.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 지하철 역 선택 모달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SubwayStationPickerModal({
  visible,
  title,
  line,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  line: string;
  onSelect: (stationName: string) => void;
  onClose: () => void;
}) {
  const [stations, setStations] = useState<SubwayStation[]>([]);
  const [filtered, setFiltered] = useState<SubwayStation[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) { setQuery(''); return; }
    setLoading(true);
    fetchSubwayStations(line || undefined)
      .then(data => { setStations(data); setFiltered(data); })
      .finally(() => setLoading(false));
  }, [visible, line]);

  useEffect(() => {
    if (!query.trim()) { setFiltered(stations); return; }
    setFiltered(stations.filter(s =>
      s.name.includes(query) || s.fullName.includes(query),
    ));
  }, [query, stations]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={ss.overlay}>
        <View style={ss.sheet}>
          {/* 핸들 */}
          <View style={ss.handle} />

          {/* 헤더 */}
          <View style={ss.header}>
            <TouchableOpacity onPress={onClose} style={ss.closeBtn}>
              <Text style={ss.closeText}>✕</Text>
            </TouchableOpacity>
            <Text style={ss.title}>{title}</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* 검색창 */}
          <View style={ss.searchWrap}>
            <TextInput
              style={ss.searchInput}
              placeholder="역 이름으로 검색..."
              value={query}
              onChangeText={setQuery}
              clearButtonMode="while-editing"
            />
          </View>

          {/* 역 목록 */}
          {loading ? (
            <View style={ss.center}>
              <ActivityIndicator size="large" color="#F5A200" />
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={item => `${item.line}-${item.seq}`}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={ss.center}>
                  <Text style={ss.emptyText}>검색 결과가 없습니다.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={ss.stationItem}
                  onPress={() => { onSelect(item.name); onClose(); }}>
                  <View style={[ss.lineTag, { backgroundColor: item.color }]}>
                    <Text style={ss.lineTagText}>{item.line}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={ss.stationName}>{item.name}</Text>
                    {item.fullName !== item.name && (
                      <Text style={ss.stationFullName}>{item.fullName}</Text>
                    )}
                  </View>
                  <Text style={ss.arrow}>›</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 스크린
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function RouteRegisterScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const { addRoute, updateRoute, routes, loading } = useRouteStore();
  const editingRouteId = route.params?.routeId;
  const existingRoute = editingRouteId ? routes.find(r => r.id === editingRouteId) : undefined;

  const [routeName, setRouteName] = useState('');
  const [hour, setHour] = useState('08');
  const [minute, setMinute] = useState('00');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const log = (msg: string) => setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 9)]);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [segments, setSegments] = useState<Omit<RouteSegment, 'id' | 'route_id'>[]>([
    { ...EMPTY_SEGMENT },
  ]);

  useEffect(() => {
    if (!existingRoute) return;
    setRouteName(existingRoute.name);
    const [h, m] = existingRoute.depart_time.split(':');
    setHour(h ?? '08');
    setMinute(m ?? '00');
    setSegments(
      existingRoute.segments.map(seg => ({
        order_index: seg.order_index,
        mode: seg.mode,
        bus_no: seg.bus_no,
        start_stop_name: seg.start_stop_name,
        start_stop_id: seg.start_stop_id,
        end_stop_name: seg.end_stop_name,
        end_stop_id: seg.end_stop_id,
        line_name: seg.line_name,
        start_station: seg.start_station,
        end_station: seg.end_station,
      })),
    );
  }, [editingRouteId]);

  const [stopModal, setStopModal] = useState<{
    visible: boolean;
    segIndex: number;
    field: 'start' | 'end';
  }>({ visible: false, segIndex: 0, field: 'start' });

  const [subwayPicker, setSubwayPicker] = useState<{
    visible: boolean;
    segIndex: number;
    field: 'start' | 'end';
  }>({ visible: false, segIndex: 0, field: 'start' });

  const openSubwayPicker = (segIndex: number, field: 'start' | 'end') =>
    setSubwayPicker({ visible: true, segIndex, field });

  const handleSubwayStationSelect = (stationName: string) => {
    const { segIndex, field } = subwayPicker;
    if (field === 'start') {
      updateSegment(segIndex, { start_station: stationName });
    } else {
      updateSegment(segIndex, { end_station: stationName });
    }
  };

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
    log(`handleSave 호출됨 user=${user?.id ?? 'null'} editingRouteId=${editingRouteId ?? 'none'}`);
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
    log(`저장 시작 - 세그먼트 ${segments.length}개`);
    try {
      if (editingRouteId) {
        await updateRoute(editingRouteId, routeName.trim(), `${hour}:${minute}`, segments);
        log('수정 성공 ✅');
      } else {
        await addRoute(user!.id, routeName.trim(), `${hour}:${minute}`, segments);
        log('저장 성공 ✅');
      }
      navigation.goBack();
    } catch (e: any) {
      const msg = e?.message ?? e?.error_description ?? JSON.stringify(e);
      log(`❌ 저장 실패: ${msg}`);
      Alert.alert('저장 실패', msg);
    }
  };

  return (
    <>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
                {/* 버스 번호 태그 입력 */}
                <Text style={styles.fieldLabel}>버스 번호 (여러 개 가능)</Text>
                <BusNoTagInput
                  value={seg.bus_no ?? ''}
                  onChange={v => updateSegment(index, { bus_no: v })}
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
                {/* 대전 지하철 호선 선택 */}
                <Text style={styles.fieldLabel}>호선 선택</Text>
                <SubwayLinePicker
                  value={seg.line_name ?? ''}
                  onChange={v => updateSegment(index, { line_name: v })}
                />

                <Text style={styles.fieldLabel}>승차 역</Text>
                <TouchableOpacity
                  style={styles.stopPicker}
                  onPress={() => openSubwayPicker(index, 'start')}>
                  <Text style={seg.start_station ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.start_station || '🚇 승차 역 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>하차 역</Text>
                <TouchableOpacity
                  style={[styles.stopPicker, { borderColor: '#E53935' }]}
                  onPress={() => openSubwayPicker(index, 'end')}>
                  <Text style={seg.end_station ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.end_station || '🚇 하차 역 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addSegBtn} onPress={addSegment}>
          <Text style={styles.addSegBtnText}>+ 구간 추가 (환승)</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={false}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>{editingRouteId ? '수정 완료' : '경로 저장'}</Text>
          )}
        </TouchableOpacity>

        {debugLog.length > 0 && (
          <View style={{ marginTop: 12, backgroundColor: '#111', borderRadius: 8, padding: 10 }}>
            {debugLog.map((line, i) => (
              <Text key={i} style={{ color: '#0f0', fontSize: 11, fontFamily: 'monospace' }}>{line}</Text>
            ))}
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

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
        skipRouteSelection={stopModal.field === 'end'}
        onSelect={handleStopSelect}
        onClose={() => setStopModal(s => ({ ...s, visible: false }))}
      />

      {/* 지하철 역 선택 */}
      <SubwayStationPickerModal
        visible={subwayPicker.visible}
        title={subwayPicker.field === 'start' ? '승차 역 선택' : '하차 역 선택'}
        line={
          segments[subwayPicker.segIndex]?.line_name ?? '1호선'
        }
        onSelect={handleSubwayStationSelect}
        onClose={() => setSubwayPicker(s => ({ ...s, visible: false }))}
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
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A73E8', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  tagText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  tagRemove: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  tagInputRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tagAddBtn: { width: 46, height: 46, backgroundColor: '#1A73E8', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tagAddText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  lineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  lineBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 2 },
  lineBtnText: { fontSize: 14, fontWeight: '700', color: '#333' },
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

// SubwayStationPicker 스타일
const ss = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%', paddingBottom: 8,
  },
  handle: { width: 40, height: 4, backgroundColor: '#DDD', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 18, color: '#666' },
  title: { fontSize: 17, fontWeight: '700', color: '#222' },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  searchInput: {
    backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#222',
  },
  center: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#aaa', fontSize: 14 },
  stationItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  lineTag: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minWidth: 44, alignItems: 'center',
  },
  lineTagText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  stationName: { fontSize: 16, fontWeight: '700', color: '#222' },
  stationFullName: { fontSize: 12, color: '#888', marginTop: 2 },
  arrow: { fontSize: 22, color: '#ccc', fontWeight: '700' },
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
  routeNo: { fontSize: 18, fontWeight: '900', color: '#fff' },
  routeNoType: { fontSize: 10, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  routeDestLabel: { fontSize: 10, color: '#aaa', marginBottom: 2 },
  routeDest: { fontSize: 15, fontWeight: '700', color: '#222' },
  routeDir: { fontSize: 12, color: '#888', marginTop: 2 },
  routeType: { fontSize: 11, color: '#aaa', marginTop: 2 },
  selectArrow: { fontSize: 24, color: '#1A73E8', fontWeight: '700' },
  fallbackBtn: {
    marginTop: 16, paddingHorizontal: 24, paddingVertical: 12,
    backgroundColor: '#1A73E8', borderRadius: 10,
  },
  fallbackBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  searchInput: {
    flex: 1, height: 40, backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 12, fontSize: 14, color: '#222',
  },
  searchResultItem: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#EEE',
  },
  searchResultName: { fontSize: 15, fontWeight: '600', color: '#222' },
  searchResultId: { fontSize: 12, color: '#aaa', marginTop: 2 },
});
