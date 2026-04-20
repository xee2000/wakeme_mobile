/**
 * 버스 API — 서버 프록시를 통해 호출
 * 서비스 키는 서버에서 관리 (모바일 노출 없음)
 */

import { BusStop } from '../types';

// TODO: 실제 서버 주소로 변경 (개발: http://10.0.2.2:3000, 배포: https://your-server.com)
const SERVER_BASE = process.env.SERVER_URL ?? 'http://10.0.2.2:3000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SERVER_BASE}${path}`);
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  const json = await res.json();
  return json.data as T;
}

/** 노선번호로 정류장 목록 조회 */
export async function fetchStopsByRouteName(routeNo: string): Promise<BusStop[]> {
  try {
    const items = await get<any[]>(`/api/bus/stops?routeNo=${encodeURIComponent(routeNo)}`);
    return items.map(item => ({
      nodeId: item.nodeid ?? '',
      nodeName: item.nodenm ?? '',
      gpslati: parseFloat(item.gpslati ?? '0'),
      gpslong: parseFloat(item.gpslong ?? '0'),
    }));
  } catch (err) {
    console.error('[busApi] fetchStopsByRouteName error:', err);
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
