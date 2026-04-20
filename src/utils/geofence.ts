/**
 * 지오펜싱 유틸
 * - Haversine 공식으로 두 좌표 간 거리 계산
 * - 정류장까지 거리가 임계값 이하면 알림 트리거
 */

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** Haversine 공식으로 두 좌표 간 거리(m) 계산 */
export function getDistanceMeters(a: Coordinate, b: Coordinate): number {
  const R = 6371000; // 지구 반지름 (m)
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 알림 임계 거리 (m) */
export const ALERT_DISTANCE = {
  PREPARE: 300, // 하차 전 정류장 (준비 알림)
  EXIT: 150,    // 하차 정류장 (하차 알림)
} as const;
