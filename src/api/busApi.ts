/**
 * 대전광역시 버스 공공 API
 * base: https://apis.data.go.kr/6300000/busposinfo
 */

import { BusStop } from '../types';

const SERVICE_KEY =
  'ZF3DPM7I7+cM+lDf8i6VQZHdB0L9tkmHSPYehTBJm2MPgr+6Gu6z1PywaVDYS31BN0GFhkdF1cGVJjY2Rxy0NA==';
const BASE_URL = 'https://apis.data.go.kr/6300000/busposinfo';

function buildUrl(endpoint: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    resultType: 'json',
    ...params,
  });
  return `${BASE_URL}/${endpoint}?${searchParams.toString()}`;
}

/** 노선명으로 정류장 목록 조회 */
export async function fetchStopsByRouteName(routeName: string): Promise<BusStop[]> {
  try {
    const url = buildUrl('getBusStopList', { routeNo: routeName });
    const res = await fetch(url);
    const json = await res.json();
    const items = json?.response?.body?.items?.item ?? [];
    const list = Array.isArray(items) ? items : [items];
    return list.map((item: any) => ({
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
    const url = buildUrl('getSttnAcctoArvlPrearngeInfoList', { nodeId });
    const res = await fetch(url);
    const json = await res.json();
    const items = json?.response?.body?.items?.item ?? [];
    return Array.isArray(items) ? items : [items];
  } catch (err) {
    console.error('[busApi] fetchArrivingBuses error:', err);
    return [];
  }
}

/** 노선 ID로 버스 현재 위치 조회 */
export async function fetchBusPositions(routeId: string): Promise<any[]> {
  try {
    const url = buildUrl('getBusPosByRtidList', { routeId });
    const res = await fetch(url);
    const json = await res.json();
    const items = json?.response?.body?.items?.item ?? [];
    return Array.isArray(items) ? items : [items];
  } catch (err) {
    console.error('[busApi] fetchBusPositions error:', err);
    return [];
  }
}
