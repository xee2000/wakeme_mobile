/**
 * 전국 버스정류장 전역 캐시 스토어
 *
 * - 로그인 시 1회 백그라운드 로딩 (48타일, 약 7초)
 * - 앱 세션 동안 캐시 유지 → 지도 열 때마다 재다운로드 불필요
 * - 지도 모달은 이 스토어에서 필터링만 수행
 */

import { create } from 'zustand';
import { fetchStopsByBbox } from '../api/busApi';
import { BusStop } from '../types';

// 한국 전체를 1°×1° 격자로 분할 (48개 타일)
const KOREA_TILES = (() => {
  const tiles: { latMin: number; latMax: number; lngMin: number; lngMax: number }[] = [];
  for (let lat = 33; lat <= 38; lat++) {
    for (let lng = 124; lng <= 131; lng++) {
      tiles.push({ latMin: lat, latMax: lat + 1, lngMin: lng, lngMax: lng + 1 });
    }
  }
  return tiles;
})();

interface StopsState {
  // nodeId → BusStop 캐시 (앱 세션 동안 유지)
  stopsMap: Map<string, BusStop>;
  loadedTiles: number;       // 완료된 타일 수
  totalTiles: number;        // 전체 타일 수
  isLoading: boolean;
  isReady: boolean;          // 전국 로드 완료 여부

  // 로그인 시 호출 — 이미 로딩 중/완료면 무시
  startLoading: () => void;

  // 뷰포트 기준 정류장 필터링 (지도 모달에서 사용)
  getStopsInView: (lat: number, lng: number, zoom: number) => BusStop[];
}

export const useStopsStore = create<StopsState>((set, get) => ({
  stopsMap:    new Map(),
  loadedTiles: 0,
  totalTiles:  KOREA_TILES.length,
  isLoading:   false,
  isReady:     false,

  startLoading: () => {
    const { isLoading, isReady } = get();
    if (isLoading || isReady) return; // 이미 로딩 중 or 완료 → 스킵

    set({ isLoading: true });
    console.log('[STOPS] 전국 정류장 백그라운드 로딩 시작 (48타일)');

    let idx = 0;
    const loadNext = async () => {
      if (idx >= KOREA_TILES.length) {
        set({ isLoading: false, isReady: true });
        console.log(`[STOPS] 전국 로딩 완료: ${get().stopsMap.size.toLocaleString()}개`);
        return;
      }

      const tile = KOREA_TILES[idx++];
      try {
        const stops = await fetchStopsByBbox(
          tile.latMin, tile.latMax, tile.lngMin, tile.lngMax,
        );
        const current = get().stopsMap;
        stops.forEach(s => current.set(s.nodeId, s));
        set({ loadedTiles: idx });
      } catch {
        // 타일 실패는 스킵하고 계속
      }

      // 150ms 딜레이 후 다음 타일 (서버 부하 분산)
      setTimeout(loadNext, 150);
    };

    loadNext();
  },

  getStopsInView: (lat, lng, zoom) => {
    const { stopsMap } = get();
    if (stopsMap.size === 0) return [];

    // 줌 레벨에 따라 표시 반경 결정
    const deg = zoom >= 16 ? 0.008
              : zoom >= 15 ? 0.015
              : zoom >= 14 ? 0.030
              : zoom >= 13 ? 0.060
              : 0.120;

    const result: BusStop[] = [];
    for (const s of stopsMap.values()) {
      if (Math.abs(s.gpslati - lat) <= deg && Math.abs(s.gpslong - lng) <= deg * 1.4) {
        result.push(s);
        if (result.length >= 300) break;
      }
    }
    return result;
  },
}));
