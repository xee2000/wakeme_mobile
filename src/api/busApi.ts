import { BusStop } from '../types';

const SERVER_BASE = process.env.SERVER_URL ?? 'http://10.0.2.2:3000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_BASE}${path}`);
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  const json = await res.json();
  return json.data as T;
}

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
    const items = await get<any[]>(`/api/bus/stops?routeNo=${encodeURIComponent(routeNo)}`);
    return items.map(mapStop);
  } catch (err) {
    console.error('[busApi] fetchStopsByRouteName error:', err);
    return [];
  }
}

/** 정류장 이름으로 검색 (서버 정적 데이터) */
export async function searchStops(name: string): Promise<BusStop[]> {
  try {
    const res = await fetch(`${SERVER_BASE}/api/stops/search?name=${encodeURIComponent(name)}`);
    const json = await res.json();
    return (json.data ?? []).map(mapLocalStop);
  } catch (err) {
    console.error('[busApi] searchStops error:', err);
    return [];
  }
}

/** GPS 좌표로 근처 정류장 조회 (서버 정적 데이터 + 거리 계산) */
export async function fetchNearbyStops(lat: number, lng: number): Promise<BusStop[]> {
  try {
    const res = await fetch(`${SERVER_BASE}/api/stops/nearby?lat=${lat}&lng=${lng}`);
    const json = await res.json();
    return (json.data ?? []).map(mapLocalStop);
  } catch (err) {
    console.error('[busApi] fetchNearbyStops error:', err);
    return [];
  }
}

/** 정류장에 경유하는 노선 목록 조회 */
export async function fetchRoutesByStop(stopId: string): Promise<{ routeId: string; routeNo: string; routeType: string; startStop: string; endStop: string }[]> {
  try {
    const res = await fetch(`${SERVER_BASE}/api/stops/${encodeURIComponent(stopId)}/routes`);
    const json = await res.json();
    return json.data ?? [];
  } catch (err) {
    console.error('[busApi] fetchRoutesByStop error:', err);
    return [];
  }
}

/** 정류장 ID로 도착 예정 버스 조회 */
export async function fetchArrivingBuses(nodeId: string): Promise<any[]> {
  try {
    return await get<any[]>(`/api/bus/arriving?nodeId=${encodeURIComponent(nodeId)}`);
  } catch (err) {
    console.error('[busApi] fetchArrivingBuses error:', err);
    return [];
  }
}

/** 노선 ID로 버스 현재 위치 조회 */
export async function fetchBusPositions(routeId: string): Promise<any[]> {
  try {
    return await get<any[]>(`/api/bus/positions?routeId=${encodeURIComponent(routeId)}`);
  } catch (err) {
    console.error('[busApi] fetchBusPositions error:', err);
    return [];
  }
}
