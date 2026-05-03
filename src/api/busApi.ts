import { BusStop } from '../types';
import { RestApi } from './RestApi';

// 공공 API 응답 매핑
function mapStop(item: any): BusStop {
  return {
    nodeId: item.nodeid ?? item.nodeId ?? '',
    nodeName: item.nodenm ?? item.nodeName ?? '',
    gpslati: parseFloat(item.gpslati ?? item.gpsLati ?? '0'),
    gpslong: parseFloat(item.gpslong ?? item.gpsLong ?? '0'),
  };
}

// 서버 정적 데이터 매핑 (stops.json)
function mapLocalStop(item: any): BusStop & { distance?: number } {
  return {
    nodeId: item.id ?? '',
    nodeName: item.name ?? '',
    gpslati: item.lat ?? 0,
    gpslong: item.lng ?? 0,
    distance: item.distance,
  };
}

/** 노선번호로 정류장 목록 조회 */
export async function fetchStopsByRouteName(routeNo: string): Promise<BusStop[]> {
  try {
    const items = await RestApi.get<any[]>(`/api/bus/stops?routeNo=${encodeURIComponent(routeNo)}`);
    return items.map(mapStop);
  } catch (err) {
    console.error('[WAKE] fetchStopsByRouteName error:', err);
    return [];
  }
}

/** 정류장 이름으로 검색 (서버 정적 데이터) */
export async function searchStops(name: string): Promise<BusStop[]> {
  try {
    const items = await RestApi.get<any[]>(`/api/stops/search?name=${encodeURIComponent(name)}`);
    return items.map(mapLocalStop);
  } catch (err) {
    console.error('[WAKE] searchStops error:', err);
    return [];
  }
}

/** GPS 좌표로 근처 정류장 조회 (서버 정적 데이터 + 거리 계산) */
export async function fetchNearbyStops(lat: number, lng: number): Promise<BusStop[]> {
  try {
    const items = await RestApi.get<any[]>(`/api/stops/nearby?lat=${lat}&lng=${lng}`);
    return items.map(mapLocalStop);
  } catch (err) {
    console.error('[WAKE] fetchNearbyStops error:', err);
    return [];
  }
}

/** 정류장에 경유하는 노선 목록 조회 */
export async function fetchRoutesByStop(stopId: string): Promise<{
  routeId: string; routeNo: string; routeType: string; startStop: string; endStop: string;
}[]> {
  try {
    const data = await RestApi.get<any>(`/api/stops/${encodeURIComponent(stopId)}/routes`);
    // 서버 응답: { success, stopName, data: [...] } — RestApi.get 은 data 필드 추출
    // 여기서는 배열 or 객체 모두 대응
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch (err) {
    console.error('[WAKE] fetchRoutesByStop error:', err);
    return [];
  }
}

/** 정류장 ID로 도착 예정 버스 목록 조회 */
export async function fetchArrivingBuses(nodeId: string): Promise<any[]> {
  try {
    return await RestApi.get<any[]>(`/api/bus/arriving?nodeId=${encodeURIComponent(nodeId)}`);
  } catch (err) {
    console.error('[WAKE] fetchArrivingBuses error:', err);
    return [];
  }
}

/** 노선 ID로 버스 현재 위치 조회 */
export async function fetchBusPositions(routeId: string): Promise<any[]> {
  try {
    return await RestApi.get<any[]>(`/api/bus/positions?routeId=${encodeURIComponent(routeId)}`);
  } catch (err) {
    console.error('[WAKE] fetchBusPositions error:', err);
    return [];
  }
}

/** 지하철 역 목록 조회 */
export interface SubwayStation {
  stationId: string;
  line: string;
  seq: number;
  name: string;
  fullName: string;
  color: string;
}

export async function fetchSubwayStations(line?: string, city?: string): Promise<SubwayStation[]> {
  try {
    const params = new URLSearchParams();
    if (city) params.set('city', city);
    if (line) params.set('line', line);
    const qs = params.toString();
    const path = `/api/subway/stations${qs ? '?' + qs : ''}`;
    return await RestApi.get<SubwayStation[]>(path);
  } catch (err) {
    console.error('[WAKE] fetchSubwayStations error:', err);
    return [];
  }
}
