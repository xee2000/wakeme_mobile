// ────────────────────────────────────────
//  공통 타입 정의
// ────────────────────────────────────────

export type TransportMode = 'bus' | 'subway';

export interface User {
  id: string; // 카카오 ID (문자열)
  nickname: string;
  profileImageUrl?: string;
}

// 경로 구간 (버스 or 지하철 1개 leg)
export interface RouteSegment {
  id?: string;
  route_id?: string;
  order_index: number;
  mode: TransportMode;
  // 버스
  bus_no?: string;
  start_stop_name?: string;
  start_stop_id?: string;
  end_stop_name?: string;
  end_stop_id?: string;
  // 지하철
  line_name?: string;
  start_station?: string;
  start_station_id?: string;  // subway_stations.station_id (예: "DJM-101")
  end_station?: string;
  end_station_id?: string;    // subway_stations.station_id (예: "DJM-119")
}

// 등록된 경로 전체
export interface Route {
  id: string;
  user_id: string;
  name: string;
  depart_time: string; // "HH:MM"
  segments: RouteSegment[];
  created_at?: string;
}

// 버스 실시간 정류장
export interface BusStop {
  nodeId: string;
  nodeName: string;
  gpslati: number;
  gpslong: number;
  distance?: number; // 근처 정류장 조회 시 서버에서 계산된 거리(m)
}

// 내비게이션 스택 파라미터
export type RootStackParamList = {
  Permission: undefined;
  Login: undefined;
  Home: undefined;
  RouteList: undefined;
  RouteRegister: { routeId?: string };
  RouteActive: { routeId: string };
};
