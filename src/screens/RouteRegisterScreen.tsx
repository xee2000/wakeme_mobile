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
import { loadRouteCache } from '../store/useMonitoringStore';
import { useStopsStore } from '../store/useStopsStore';
import { RootStackParamList, RouteSegment, TransportMode, BusStop } from '../types';
import { searchStops, fetchRoutesByStop } from '../api/busApi';
import { RestApi } from '../api/RestApi';
import { searchKtxStations, KtxStation } from '../data/ktxStations';
import { scheduleDepartureNotification, cancelDepartureNotification } from '../utils/notifications';
import { cancelDeparture, scheduleDeparture } from '../utils/nativeService';
// Geolocation import 제거 (주소 검색으로 대체)

type Props = NativeStackScreenProps<RootStackParamList, 'RouteRegister'>;

const EMPTY_SEGMENT: Omit<RouteSegment, 'id' | 'route_id'> = {
  order_index: 0,
  mode: 'bus',
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
// 전국 지역 목록 (이름 → 지도 중심 좌표)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const REGIONS: { name: string; lat: number; lng: number }[] = [
  { name: '서울',  lat: 37.5665, lng: 126.9780 },
  { name: '경기',  lat: 37.4138, lng: 127.5183 },
  { name: '인천',  lat: 37.4563, lng: 126.7052 },
  { name: '부산',  lat: 35.1796, lng: 129.0756 },
  { name: '경남',  lat: 35.4606, lng: 128.2132 },
  { name: '대구',  lat: 35.8714, lng: 128.6014 },
  { name: '경북',  lat: 36.5760, lng: 128.5055 },
  { name: '대전',  lat: 36.3504, lng: 127.3845 },
  { name: '세종',  lat: 36.4800, lng: 127.2890 },
  { name: '충남',  lat: 36.5184, lng: 126.8000 },
  { name: '충북',  lat: 36.6357, lng: 127.4914 },
  { name: '광주',  lat: 35.1595, lng: 126.8526 },
  { name: '전남',  lat: 34.8161, lng: 126.4629 },
  { name: '전북',  lat: 35.8200, lng: 127.1089 },
  { name: '울산',  lat: 35.5384, lng: 129.3114 },
  { name: '강원',  lat: 37.8228, lng: 128.1555 },
  { name: '제주',  lat: 33.4890, lng: 126.4983 },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KTX 역 선택 모달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function KtxStationModal({
  visible,
  title,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  onSelect: (station: KtxStation) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState('');
  const results = React.useMemo(() => searchKtxStations(query), [query]);

  React.useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ktxModal.overlay}>
        <View style={ktxModal.sheet}>
          {/* 헤더 */}
          <View style={ktxModal.header}>
            <Text style={ktxModal.title}>🚄 {title}</Text>
            <TouchableOpacity onPress={onClose} style={ktxModal.closeBtn}>
              <Text style={ktxModal.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* 검색 */}
          <View style={ktxModal.searchBox}>
            <Text style={ktxModal.searchIcon}>🔍</Text>
            <TextInput
              style={ktxModal.searchInput}
              placeholder="역 이름 또는 노선명 검색"
              placeholderTextColor="#aaa"
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Text style={{ color: '#aaa', fontSize: 16, paddingRight: 4 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* 역 목록 */}
          <FlatList
            data={results}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={ktxModal.stationRow}
                onPress={() => { onSelect(item); onClose(); }}>
                <View style={{ flex: 1 }}>
                  <Text style={ktxModal.stationName}>{item.name}</Text>
                  <Text style={ktxModal.stationLines}>{item.lines.join(' · ')}</Text>
                </View>
                <Text style={ktxModal.stationArrow}>›</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: '#F0F0F0' }} />}
          />
        </View>
      </View>
    </Modal>
  );
}

const ktxModal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingBottom: 32,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  title: { fontSize: 17, fontWeight: '700', color: '#1A1A2E' },
  closeBtn: { padding: 4 },
  closeText: { fontSize: 18, color: '#999' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    margin: 12, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#F5F7FA', borderRadius: 12,
  },
  searchIcon: { fontSize: 15, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#222', padding: 0 },
  stationRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  stationName: { fontSize: 16, fontWeight: '600', color: '#222', marginBottom: 3 },
  stationLines: { fontSize: 12, color: '#1A73E8' },
  stationArrow: { fontSize: 20, color: '#ccc', marginLeft: 8 },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 지도 정류장 선택 모달 (버스번호 선택 없이 정류장만 선택)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function MapStopSelectModal({
  visible,
  title,
  initialLat,
  initialLng,
  initialZoom,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  initialLat?: number;
  initialLng?: number;
  initialZoom?: number;
  onSelect: (stop: BusStop) => void;
  onClose: () => void;
}) {
  const mapRef = useRef<NaverMapViewRef>(null);
  const [nearbyStops, setNearbyStops] = useState<BusStop[]>([]);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);

  // 전역 정류장 스토어 (로그인 시 이미 로딩 중)
  const getStopsInView = useStopsStore(s => s.getStopsInView);
  const loadedTiles    = useStopsStore(s => s.loadedTiles);
  const totalTiles     = useStopsStore(s => s.totalTiles);

  // 지역 선택 시 해당 중심으로, 없으면 대전 기본값
  const initLat  = initialLat  ?? 36.35;
  const initLng  = initialLng  ?? 127.38;
  const initZoom = initialZoom ?? 14;
  const cameraRef = useRef<{ lat: number; lng: number; zoom: number }>({ lat: initLat, lng: initLng, zoom: initZoom });
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stopRoutes, setStopRoutes] = useState<{ routeNo: string; endStop: string }[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BusStop[]>([]);
  const [addrResults, setAddrResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 스토어 캐시에서 현재 뷰포트 정류장 필터링
  const updateDisplayedStops = useCallback(() => {
    const { lat, lng, zoom } = cameraRef.current;
    setNearbyStops(getStopsInView(lat, lng, zoom));
  }, [getStopsInView]);

  // 주소 검색으로 지도 이동
  const handleAddressSelect = useCallback((lat: number, lng: number) => {
    setSearchQuery('');
    setSearchResults([]);
    setAddrResults([]);
    setSelectedStop(null);
    mapRef.current?.animateCameraTo({ latitude: lat, longitude: lng, zoom: 16, duration: 600 });
  }, []);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!text.trim()) { setSearchResults([]); setAddrResults([]); return; }
    let cancelled = false;
    searchTimerRef.current = setTimeout(async () => {
      if (cancelled) return;
      setSearchLoading(true);
      try {
        // ① 정류장 이름 검색 + ② 주소/지역명 검색 동시 실행
        const [stopRes, geoRes] = await Promise.allSettled([
          searchStops(text.trim()),
          RestApi.get<{ addresses: { roadAddress: string; jibunAddress: string; lat: number; lng: number }[] }>(
            `/api/geocode?query=${encodeURIComponent(text.trim())}`,
          ),
        ]);
        if (cancelled) return;
        if (stopRes.status === 'fulfilled') setSearchResults(stopRes.value);
        if (geoRes.status === 'fulfilled') {
          setAddrResults(
            (geoRes.value.addresses ?? []).slice(0, 5).map(a => ({
              name: a.roadAddress || a.jibunAddress,
              lat: a.lat,
              lng: a.lng,
            })),
          );
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 400);
    return () => { cancelled = true; };
  }, []);

  // 모달 열림/닫힘
  useEffect(() => {
    if (!visible) {
      setSelectedStop(null);
      setNearbyStops([]);
      setUserLat(null);
      setUserLng(null);
      setSearchQuery('');
      setSearchResults([]);
      setAddrResults([]);
      setStopRoutes([]);
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      return;
    }

    if (initialLat && initialLng) {
      // 지역 선택된 경우: 해당 지역으로 이동 + NoFollow (GPS 중심 이동 막기)
      setTimeout(() => {
        mapRef.current?.animateCameraTo({ latitude: initialLat, longitude: initialLng, zoom: initZoom, duration: 500 });
        mapRef.current?.setLocationTrackingMode('NoFollow');
        cameraRef.current = { lat: initialLat, lng: initialLng, zoom: initZoom };
        updateDisplayedStops();
      }, 400);
    } else {
      // 지역 미선택: GPS 위치 추적
      setTimeout(() => mapRef.current?.setLocationTrackingMode('Follow'), 400);
    }
    updateDisplayedStops();
  }, [visible, updateDisplayedStops]);

  // 카메라 이동 시 캐시에서 뷰포트 필터링
  const handleCameraChanged = useCallback(
    (params: any) => {
      const { latitude, longitude, zoom, reason } = params;

      if (reason === 'Location') {
        setUserLat(latitude);
        setUserLng(longitude);
      }

      cameraRef.current = { lat: latitude, lng: longitude, zoom };

      // debounce: 드래그 중 과도한 렌더링 방지
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = setTimeout(updateDisplayedStops, 200);
    },
    [updateDisplayedStops],
  );

  const handleMarkerTap = (stop: BusStop) => {
    setSelectedStop(stop);
    setStopRoutes([]);
    mapRef.current?.animateCameraTo({
      latitude: stop.gpslati,
      longitude: stop.gpslong,
      zoom: 17,
      duration: 400,
    });
    setRoutesLoading(true);
    fetchRoutesByStop(stop.nodeId)
      .then(routes => setStopRoutes(routes.map(r => ({ routeNo: r.routeNo, endStop: r.endStop }))))
      .catch(() => {})
      .finally(() => setRoutesLoading(false));
  };

  const handleRelocate = () => {
    mapRef.current?.setLocationTrackingMode('Follow');
  };

  const handleSelect = () => {
    if (!selectedStop) return;
    onSelect(selectedStop);
    onClose();
  };

  const isSearching = searchQuery.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={ms.container}>
        <View style={ms.header}>
          <TouchableOpacity onPress={onClose} style={ms.closeBtn}>
            <Text style={ms.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={ms.headerTitle}>{title}</Text>
          <TouchableOpacity onPress={handleRelocate} style={ms.relocateBtn}>
            <Text style={ms.relocateText}>📍</Text>
          </TouchableOpacity>
        </View>

        {/* 검색창 */}
        <View style={ms.searchBar}>
          <TextInput
            style={ms.searchInput}
            placeholder="정류장 이름 또는 지역명 검색 (예: 서정리, 강남역)"
            value={searchQuery}
            onChangeText={handleSearchChange}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchLoading && <ActivityIndicator size="small" color="#1A73E8" style={{ marginLeft: 8 }} />}
        </View>

        {/* 검색 결과 */}
        {isSearching && (
          <ScrollView
            style={{ flex: 1, backgroundColor: '#fff' }}
            keyboardShouldPersistTaps="handled">

            {/* ① 정류장 이름 검색 결과 */}
            {searchResults.length > 0 && (
              <>
                <Text style={ms.sectionLabel}>🚏 정류장 검색 결과</Text>
                {searchResults.map((item, i) => (
                  <TouchableOpacity
                    key={`stop-${item.nodeId}-${i}`}
                    style={ms.searchResultItem}
                    onPress={() => {
                      setNearbyStops(prev =>
                        prev.some(s => s.nodeId === item.nodeId) ? prev : [item, ...prev],
                      );
                      setSearchQuery('');
                      setSearchResults([]);
                      setAddrResults([]);
                      setTimeout(() => handleMarkerTap(item), 50);
                    }}>
                    <View style={ms.searchResultRow}>
                      <Text style={ms.searchResultName}>🚏 {item.nodeName}</Text>
                      {item.city ? (
                        <View style={ms.cityTag}>
                          <Text style={ms.cityTagText}>{item.city}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={ms.searchResultId}>{item.nodeId}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* ② 주소/지역명 검색 결과 → 지도 이동 */}
            {addrResults.length > 0 && (
              <>
                <Text style={ms.sectionLabel}>📍 이 위치 주변 정류장 보기</Text>
                {addrResults.map((item, i) => (
                  <TouchableOpacity
                    key={`addr-${i}`}
                    style={ms.searchResultItem}
                    onPress={() => handleAddressSelect(item.lat, item.lng)}>
                    <Text style={ms.searchResultName}>📍 {item.name}</Text>
                    <Text style={ms.searchResultId}>지도에서 주변 정류장 확인</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* 결과 없음 */}
            {!searchLoading && searchResults.length === 0 && addrResults.length === 0 && (
              <View style={ms.center}>
                <Text style={ms.emptyText}>검색 결과가 없습니다.</Text>
                <Text style={[ms.emptyText, { fontSize: 12, marginTop: 6, color: '#aaa' }]}>
                  정류장 이름이나 근처 지역명을 입력해보세요
                </Text>
              </View>
            )}
          </ScrollView>
        )}

        <View style={{ flex: 1, display: isSearching ? 'none' : 'flex' }}>
          <NaverMapView
            ref={mapRef}
            style={ms.map}
            initialCamera={{ latitude: initLat, longitude: initLng, zoom: initZoom }}
            isShowLocationButton={true}
            isShowZoomControls={true}
            isShowCompass={false}
            onCameraChanged={handleCameraChanged}
            onInitialized={() => console.log('[WAKE] NaverMap 초기화 성공')}
            onOptionChanged={() => console.log('[WAKE] NaverMap 옵션 변경됨')}>

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

          {selectedStop ? (
            <View style={ms.bottomCard}>
              {/* 정류장 헤더 */}
              <View style={ms.stopCardHeader}>
                <View style={ms.stopCardInfo}>
                  <Text style={ms.stopCardName}>{selectedStop.nodeName}</Text>
                  <Text style={ms.stopCardDist}>
                    {selectedStop.distance != null ? `📍 ${selectedStop.distance}m` : `코드: ${selectedStop.nodeId}`}
                  </Text>
                </View>
                <TouchableOpacity style={ms.registerBtn} onPress={handleSelect}>
                  <Text style={ms.registerBtnText}>선택</Text>
                </TouchableOpacity>
              </View>

              {/* 경유 버스 목록 — 전국 노선 데이터 연동 전까지 비활성
              {routesLoading ? (
                <View style={{ paddingVertical: 10, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color="#1A73E8" />
                </View>
              ) : stopRoutes.length > 0 ? (
                <ScrollView
                  style={ms.routeList}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingVertical: 8, paddingHorizontal: 2 }}>
                  {stopRoutes.map((r, i) => (
                    <View key={i} style={ms.routeChip}>
                      <Text style={ms.routeChipNo}>{r.routeNo}번</Text>
                      {r.endStop ? (
                        <Text style={ms.routeChipDest}>{r.endStop}방면</Text>
                      ) : null}
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={ms.noRouteText}>노선 정보를 불러올 수 없습니다</Text>
              )}
              */}
            </View>
          ) : (
            <View style={ms.hintBar}>
              <Text style={ms.hintText}>
                {loadedTiles < totalTiles
                  ? `🌏 전국 정류장 로딩 중... ${Math.round(loadedTiles / totalTiles * 100)}%`
                  : nearbyStops.length > 0
                  ? `정류장 ${nearbyStops.length}개 • 마커를 눌러 선택`
                  : '이 지역에 정류장 정보가 없습니다'}
              </Text>
            </View>
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

  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  const [routeName, setRouteName] = useState('');
  const [hour, setHour] = useState('08');
  const [minute, setMinute] = useState('00');
  const [selectedDays, setSelectedDays] = useState<number[]>(ALL_DAYS);
  const [finalDest, setFinalDest] = useState<{
    name: string; lat: number; lng: number;
  } | null>(null);
  const [addrModal, setAddrModal]     = useState(false);
  const [addrQuery, setAddrQuery]     = useState('');
  const [addrResults, setAddrResults] = useState<{ roadAddress: string; jibunAddress: string; lat: number; lng: number }[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  // KTX 역 선택 모달
  const [ktxModalVisible, setKtxModalVisible] = useState(false);
  const [ktxModalTarget, setKtxModalTarget] = useState<{ segIndex: number; field: 'start' | 'end' } | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const log = (msg: string) => setDebugLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 9)]);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showTimeHint, setShowTimeHint] = useState(false);
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
        start_stop_name: seg.start_stop_name,
        start_stop_id: seg.start_stop_id,
        end_stop_name: seg.end_stop_name,
        end_stop_id: seg.end_stop_id,

      })),
    );
    if (existingRoute.final_dest_lat && existingRoute.final_dest_lng) {
      setFinalDest({
        name: existingRoute.final_dest_name ?? '최종 목적지',
        lat:  existingRoute.final_dest_lat,
        lng:  existingRoute.final_dest_lng,
      });
    }
    setSelectedDays(
      existingRoute.days_of_week && existingRoute.days_of_week.length > 0
        ? existingRoute.days_of_week
        : ALL_DAYS,
    );

  }, [editingRouteId]);

  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);  // 빈 배열 = 현위치

  /** 지역 칩 토글 (다중 선택) */
  const toggleRegion = (name: string) => {
    setSelectedRegions(prev =>
      prev.includes(name) ? prev.filter(r => r !== name) : [...prev, name],
    );
  };

  /**
   * 선택된 지역들의 중심 좌표 + 적절한 줌 레벨 계산
   * - 0개: undefined (GPS 현위치 모드)
   * - 1개: 해당 지역 중심, zoom 13
   * - 2개+: 바운딩박스 중심, 범위에 따라 zoom 8~12
   */
  const regionCamera = (() => {
    const picked = REGIONS.filter(r => selectedRegions.includes(r.name));
    if (picked.length === 0) return undefined;

    const lats = picked.map(r => r.lat);
    const lngs = picked.map(r => r.lng);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    const zoom = span < 0.5 ? 13 : span < 1.5 ? 11 : span < 3 ? 10 : span < 5 ? 9 : 8;
    return { lat, lng, zoom };
  })();

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
          ? { order_index: seg.order_index, mode, start_stop_name: '', start_stop_id: '', end_stop_name: '', end_stop_id: '' }
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
      updateSegment(segIndex, {
        start_stop_name: stop.nodeName,
        start_stop_id: stop.nodeId,
      });
    } else {
      updateSegment(segIndex, {
        end_stop_name: stop.nodeName,
        end_stop_id: stop.nodeId,
      });
    }
  };

  const addSegment = () =>
    setSegments(prev => [...prev, { ...EMPTY_SEGMENT, order_index: prev.length }]);

  const openKtxModal = (segIndex: number, field: 'start' | 'end') => {
    setKtxModalTarget({ segIndex, field });
    setKtxModalVisible(true);
  };

  const handleKtxStationSelect = (station: KtxStation) => {
    if (!ktxModalTarget) return;
    const { segIndex, field } = ktxModalTarget;
    if (field === 'start') {
      updateSegment(segIndex, { start_stop_name: station.name, start_stop_id: station.id });
    } else {
      updateSegment(segIndex, { end_stop_name: station.name, end_stop_id: station.id });
    }
    setKtxModalVisible(false);
    setKtxModalTarget(null);
  };

  const removeSegment = (index: number) => {
    if (segments.length === 1) return;
    setSegments(prev =>
      prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, order_index: i })),
    );
  };

  const openAddrModal = () => {
    setAddrQuery('');
    setAddrResults([]);
    setAddrModal(true);
  };

  const searchAddress = async () => {
    if (!addrQuery.trim()) return;
    setAddrLoading(true);
    try {
      const res = await RestApi.get<{ addresses: { roadAddress: string; jibunAddress: string; lat: number; lng: number }[] }>(
        `/api/geocode?query=${encodeURIComponent(addrQuery.trim())}`,
      );
      setAddrResults(res.addresses ?? []);
      if ((res.addresses ?? []).length === 0) {
        Alert.alert('검색 결과 없음', '다른 주소로 다시 검색해보세요.');
      }
    } catch (e: any) {
      Alert.alert('오류', `주소 검색 실패: ${e.message}`);
    } finally {
      setAddrLoading(false);
    }
  };

  const selectAddress = (item: { roadAddress: string; jibunAddress: string; lat: number; lng: number }) => {
    const name = item.roadAddress || item.jibunAddress;
    setFinalDest({ name, lat: item.lat, lng: item.lng });
    setAddrModal(false);
  };

  const handleSave = async () => {
    log(`handleSave 호출됨 user=${user?.id ?? 'null'} editingRouteId=${editingRouteId ?? 'none'}`);
    if (!routeName.trim()) { Alert.alert('알림', '경로 이름을 입력해주세요.'); return; }
    for (const seg of segments) {
      if (seg.mode === 'bus' && !seg.end_stop_name?.trim()) {
        Alert.alert('알림', '하차 정류장을 선택해주세요.'); return;
      }
      if (seg.mode === 'ktx' && !seg.end_stop_id?.trim()) {
        Alert.alert('알림', 'KTX 하차역을 선택해주세요.'); return;
      }

    }
    if (!finalDest) {
      Alert.alert('알림', '최종 도착지를 설정해주세요.\n집이나 회사 주소를 검색해서 추가해주세요.');
      return;
    }
    if (selectedDays.length === 0) {
      Alert.alert('알림', '운행 요일을 1개 이상 선택해주세요.'); return;
    }
    log(`저장 시작 - 세그먼트 ${segments.length}개`);
    try {
      if (editingRouteId) {
        await updateRoute(editingRouteId, routeName.trim(), `${hour}:${minute}`, segments, finalDest, selectedDays);
        log('수정 성공 ✅');

        // ── 출발 시간 변경 → 알람 재예약 ────────────────────────────
        const newDepartTime = `${hour}:${minute}`;
        // 기존 AlarmManager 알람 취소 후 재등록
        cancelDeparture(editingRouteId);
        const firstSeg = segments[0];
        if (firstSeg?.start_stop_id) {
          scheduleDeparture(
            editingRouteId,
            newDepartTime,
            firstSeg.start_stop_name ?? '',
            firstSeg.start_stop_id,
          );
        }
        // Notifee 트리거 알림도 취소 후 재등록
        await cancelDepartureNotification(editingRouteId);
        await scheduleDepartureNotification(editingRouteId, routeName.trim(), newDepartTime);
        log('알람 재예약 완료');
      } else {
        await addRoute(user!.id, routeName.trim(), `${hour}:${minute}`, segments, finalDest, selectedDays);
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
        <View style={styles.labelRow}>
          <Text style={styles.label}>출발 시간</Text>
          <TouchableOpacity onPress={() => setShowTimeHint(true)} style={styles.hintBtn}>
            <Text style={styles.hintBtnText}>?</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.timePicker} onPress={() => setShowTimePicker(true)}>
          <Text style={styles.timeValue}>{hour} : {minute}</Text>
          <Text style={styles.timeChevron}>⏰ 탭하여 변경</Text>
        </TouchableOpacity>

        {/* 출발 시간 안내 모달 */}
        <Modal visible={showTimeHint} transparent animationType="fade" onRequestClose={() => setShowTimeHint(false)}>
          <TouchableOpacity style={styles.hintOverlay} activeOpacity={1} onPress={() => setShowTimeHint(false)}>
            <View style={styles.hintBox}>
              <Text style={styles.hintTitle}>출발 시간이란?</Text>
              <Text style={styles.hintBody}>
                이 앱은 <Text style={styles.hintBold}>GPS 기반</Text>으로 동작하기 때문에 상시 켜질 경우{' '}
                <Text style={styles.hintBold}>배터리 소모가 큽니다.</Text>{'\n\n'}
                설정한 <Text style={styles.hintBold}>출발 시간에 맞춰 앱이 자동으로 활성화</Text>되어{' '}
                GPS 수집을 시작하고 알림을 드립니다.{'\n\n'}
                출발 시간 <Text style={styles.hintBold}>10분 전부터 도착지 도달 시까지</Text> 동작하며{' '}
                도착지에 도달하지 못한 경우 <Text style={styles.hintBold}>최대 3시간</Text> 후 자동 종료됩니다.
              </Text>
              <TouchableOpacity onPress={() => setShowTimeHint(false)} style={styles.hintClose}>
                <Text style={styles.hintCloseText}>확인</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* 운행 요일 */}
        <Text style={[styles.label, { marginTop: 16 }]}>운행 요일</Text>
        <View style={styles.daysRow}>
          {ALL_DAYS.map(day => {
            const isActive = selectedDays.includes(day);
            return (
              <TouchableOpacity
                key={day}
                style={[styles.dayBtn, isActive && styles.dayBtnActive]}
                onPress={() => {
                  setSelectedDays(prev =>
                    prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day],
                  );
                }}>
                <Text style={[styles.dayBtnText, isActive && styles.dayBtnTextActive]}>
                  {DAY_LABELS[day]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {selectedDays.length === 0 && (
          <Text style={{ color: '#E53E3E', fontSize: 12, marginTop: 4 }}>
            요일을 1개 이상 선택해주세요.
          </Text>
        )}

        {/* 지역 선택 (다중) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 4 }}>
          <Text style={styles.label}>정류장 지역</Text>
          {selectedRegions.length > 0 && (
            <TouchableOpacity onPress={() => setSelectedRegions([])} style={{ marginLeft: 10 }}>
              <Text style={{ fontSize: 12, color: '#E53935', fontWeight: '600' }}>초기화</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          여러 지역을 함께 선택할 수 있습니다. 미선택 시 현위치 기준으로 열립니다.
        </Text>
        {/* 지역 칩 — flexWrap으로 모두 표시 */}
        <View style={styles.regionChipWrap}>
          {REGIONS.map(r => {
            const active = selectedRegions.includes(r.name);
            return (
              <TouchableOpacity
                key={r.name}
                style={[styles.regionChip, active && styles.regionChipActive]}
                onPress={() => toggleRegion(r.name)}>
                {active && <Text style={{ fontSize: 10, color: '#fff', marginRight: 3 }}>✓</Text>}
                <Text style={[styles.regionChipText, active && styles.regionChipTextActive]}>
                  {r.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 구간 */}
        <Text style={[styles.label, { marginTop: 16 }]}>구간 정보</Text>
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

            {/* 교통수단 탭 */}
            <View style={styles.modeTabRow}>
              <TouchableOpacity
                style={[styles.modeTab, seg.mode === 'bus' && styles.modeTabActive]}
                onPress={() => updateSegment(index, {
                  mode: 'bus',
                  start_stop_name: '', start_stop_id: '',
                  end_stop_name: '', end_stop_id: '',
                })}>
                <Text style={[styles.modeTabText, seg.mode === 'bus' && styles.modeTabTextActive]}>
                  🚌 버스
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeTab, seg.mode === 'ktx' && styles.modeTabKtxActive]}
                onPress={() => updateSegment(index, {
                  mode: 'ktx',
                  start_stop_name: '', start_stop_id: '',
                  end_stop_name: '', end_stop_id: '',
                })}>
                <Text style={[styles.modeTabText, seg.mode === 'ktx' && styles.modeTabKtxTextActive]}>
                  🚄 KTX{' '}
                  <Text style={{ fontSize: 10, fontWeight: '400' }}>(개발진행중)</Text>
                </Text>
              </TouchableOpacity>
            </View>

            {seg.mode === 'bus' ? (
              <>
                <View style={styles.stopNotice}>
                  <Text style={styles.stopNoticeText}>
                    📍 해당 정류장의 좌표 기준으로 500m 이전에 알려드립니다
                  </Text>
                </View>
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
                <Text style={styles.fieldLabel}>탑승역</Text>
                <TouchableOpacity
                  style={[styles.stopPicker, { borderColor: '#6B46C1' }]}
                  onPress={() => openKtxModal(index, 'start')}>
                  <Text style={seg.start_stop_name ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.start_stop_name ? `🚄 ${seg.start_stop_name}역` : '🚄 탑승역 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>하차역 (알림 기준)</Text>
                <TouchableOpacity
                  style={[styles.stopPicker, { borderColor: '#E53935' }]}
                  onPress={() => openKtxModal(index, 'end')}>
                  <Text style={seg.end_stop_name ? styles.stopSelected : styles.stopPlaceholder}>
                    {seg.end_stop_name ? `🚄 ${seg.end_stop_name}역` : '🚄 하차역 선택'}
                  </Text>
                  <Text style={styles.stopArrow}>›</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  ※ 하차역 반경 500m 이내 접근 시 알림이 발송됩니다
                </Text>
              </>
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addSegBtn} onPress={addSegment}>
          <Text style={styles.addSegBtnText}>+ 구간 추가 (환승)</Text>
        </TouchableOpacity>

        {/* 최종 목적지 (필수) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 4 }}>
          <Text style={styles.label}>최종 목적지</Text>
          <View style={{ backgroundColor: '#E53E3E', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>필수</Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          정류장/역 하차 후 실제로 도착할 곳.{' '}
          <Text style={{ fontWeight: '700', color: '#555' }}>도착지 근처에 가까이 접근하거나 출발시간부터 3시간 경과 시 배터리 소모를 줄이기 위해 앱이 정지 상태로 들어가니 참고 부탁드립니다.</Text>
        </Text>
        {finalDest ? (
          <View style={styles.finalDestCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.finalDestName}>📍 {finalDest.name}</Text>
              <Text style={styles.finalDestCoords}>
                {finalDest.lat.toFixed(5)}, {finalDest.lng.toFixed(5)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setFinalDest(null)}>
              <Text style={{ color: '#E53E3E', fontWeight: '600', paddingLeft: 12 }}>삭제</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.locationBtn, { borderColor: '#E53E3E', borderWidth: 1.5 }]} onPress={openAddrModal}>
            <Text style={[styles.locationBtnText, { color: '#E53E3E' }]}>🔍 주소 검색으로 목적지 설정</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.saveBtn, selectedDays.length === 0 && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={selectedDays.length === 0}>
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
        initialLat={regionCamera?.lat}
        initialLng={regionCamera?.lng}
        initialZoom={regionCamera?.zoom}
        onSelect={handleStopSelect}
        onClose={() => setStopModal(s => ({ ...s, visible: false }))}
      />


      {/* KTX 역 선택 모달 */}
      <KtxStationModal
        visible={ktxModalVisible}
        title={ktxModalTarget?.field === 'start' ? '탑승역 선택' : '하차역 선택'}
        onSelect={handleKtxStationSelect}
        onClose={() => { setKtxModalVisible(false); setKtxModalTarget(null); }}
      />

      {/* 주소 검색 모달 */}
      <Modal visible={addrModal} animationType="slide" onRequestClose={() => setAddrModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.addrModal}>
            {/* 헤더 */}
            <View style={styles.addrHeader}>
              <Text style={styles.addrHeaderTitle}>목적지 주소 검색</Text>
              <TouchableOpacity onPress={() => setAddrModal(false)}>
                <Text style={{ fontSize: 16, color: '#555' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 검색 입력 */}
            <View style={styles.addrSearchRow}>
              <TextInput
                style={styles.addrInput}
                placeholder="주소 또는 장소명 입력 (예: 강남구청)"
                placeholderTextColor="#aaa"
                value={addrQuery}
                onChangeText={setAddrQuery}
                onSubmitEditing={searchAddress}
                returnKeyType="search"
                autoFocus
              />
              <TouchableOpacity style={styles.addrSearchBtn} onPress={searchAddress} disabled={addrLoading}>
                {addrLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.addrSearchBtnText}>검색</Text>
                }
              </TouchableOpacity>
            </View>

            {/* 결과 목록 */}
            <FlatList
              data={addrResults}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.addrItem} onPress={() => selectAddress(item)}>
                  <Text style={styles.addrRoad}>{item.roadAddress || '(도로명 없음)'}</Text>
                  {item.jibunAddress ? (
                    <Text style={styles.addrJibun}>{item.jibunAddress}</Text>
                  ) : null}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                !addrLoading && addrResults.length === 0 && addrQuery.length > 0 ? null : null
              }
              contentContainerStyle={{ paddingBottom: 40 }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 스타일
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  label: { fontSize: 14, fontWeight: '600', color: '#555', marginBottom: 6, marginTop: 16 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 6 },
  hintBtn: {
    marginLeft: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBtnText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 14 },
  hintOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  hintBox: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 22,
    width: '100%',
  },
  hintTitle: { fontSize: 16, fontWeight: '700', color: '#1A73E8', marginBottom: 12 },
  hintBody: { fontSize: 14, color: '#444', lineHeight: 22 },
  hintBold: { fontWeight: '700', color: '#222' },
  hintClose: {
    marginTop: 20,
    backgroundColor: '#1A73E8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  hintCloseText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  stopNotice: {
    backgroundColor: '#EBF3FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1A73E8',
  },
  stopNoticeText: { fontSize: 12, color: '#1A73E8', fontWeight: '600', lineHeight: 18 },
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
  // 교통수단 탭
  modeTabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeTab: {
    flex: 1, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F7FA', borderWidth: 1, borderColor: '#E0E0E0',
  },
  modeTabActive: { backgroundColor: '#EBF3FF', borderColor: '#1A73E8' },
  modeTabKtxActive: { backgroundColor: '#F3E8FF', borderColor: '#6B46C1' },
  modeTabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  modeTabTextActive: { color: '#1A73E8' },
  modeTabKtxTextActive: { color: '#6B46C1' },
  addSegBtn: {
    height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1A73E8', borderStyle: 'dashed', marginBottom: 16,
  },
  addSegBtnText: { color: '#1A73E8', fontWeight: '600', fontSize: 14 },
  saveBtn: { height: 52, backgroundColor: '#1A73E8', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  finalDestCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EBF8FF', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#BEE3F8', marginBottom: 16,
  },
  finalDestName: { fontSize: 15, fontWeight: '600', color: '#2D3748' },
  finalDestCoords: { fontSize: 11, color: '#718096', marginTop: 2 },
  locationBtn: {
    height: 48, borderRadius: 10, borderWidth: 1.5, borderColor: '#1A73E8',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  locationBtnText: { color: '#1A73E8', fontWeight: '600', fontSize: 14 },
  // 지역 선택 칩
  regionChipWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4,
  },
  regionChip: {
    height: 36, paddingHorizontal: 14, borderRadius: 18,
    borderWidth: 1.5, borderColor: '#C5D5F5', backgroundColor: '#fff',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  regionChipActive: { backgroundColor: '#1A73E8', borderColor: '#1A73E8' },
  regionChipText: { fontSize: 13, color: '#555', fontWeight: '600' },
  regionChipTextActive: { color: '#fff' },
  // 요일 선택
  daysRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 },
  dayBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#ccc',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  dayBtnActive: { backgroundColor: '#1A73E8', borderColor: '#1A73E8' },
  dayBtnText: { fontSize: 13, color: '#888', fontWeight: '600' },
  dayBtnTextActive: { color: '#fff' },
  // 주소 검색 모달
  addrModal: { flex: 1, backgroundColor: '#F5F7FA' },
  addrHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 56, paddingBottom: 16,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  addrHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  addrSearchRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  addrInput: {
    flex: 1, height: 44, backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 14, fontSize: 15, color: '#222',
  },
  addrSearchBtn: {
    height: 44, paddingHorizontal: 16, backgroundColor: '#1A73E8',
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  addrSearchBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  addrItem: {
    backgroundColor: '#fff', paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  addrRoad: { fontSize: 15, fontWeight: '600', color: '#222' },
  addrJibun: { fontSize: 12, color: '#888', marginTop: 3 },
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
    backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: '#EEE',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 6,
  },
  stopCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  stopCardInfo: { flex: 1 },
  stopCardName: { fontSize: 16, fontWeight: '700', color: '#222' },
  stopCardDist: { fontSize: 12, color: '#888', marginTop: 2 },
  registerBtn: {
    backgroundColor: '#1A73E8', borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  registerBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  routeList: { maxHeight: 80 },
  routeChip: {
    backgroundColor: '#F0F4FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: 'center', borderWidth: 1, borderColor: '#C5D5F5',
  },
  routeChipNo: { fontSize: 15, fontWeight: '800', color: '#1A73E8' },
  routeChipDest: { fontSize: 11, color: '#666', marginTop: 2 },
  noRouteText: { fontSize: 12, color: '#aaa', paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#EEE',
  },
  searchInput: {
    flex: 1, height: 40, backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 12, fontSize: 14, color: '#222',
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: '#888',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6,
    backgroundColor: '#F8F8F8',
  },
  searchResultItem: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#EEE',
  },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  searchResultName: { fontSize: 15, fontWeight: '600', color: '#222', flex: 1 },
  searchResultId: { fontSize: 12, color: '#aaa', marginTop: 2 },
  cityTag: {
    backgroundColor: '#EEF4FF', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#C5D5F5',
  },
  cityTagText: { fontSize: 11, color: '#1A73E8', fontWeight: '700' },
});
