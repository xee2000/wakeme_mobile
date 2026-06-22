// ────────────────────────────────────────
//  공통 타입 정의
// ────────────────────────────────────────

export type TransportMode = 'bus' | 'ktx';

export interface User {
  id: string; // 카카오 ID (문자열)
  nickname: string;
  profileImageUrl?: string;
}

// 경로 구간 (버스 1개 leg)
export interface RouteSegment {
  id?: string;
  route_id?: string;
  order_index: number;
  mode: TransportMode;
  bus_no?: string;
  start_stop_name?: string;
  start_stop_id?: string;
  end_stop_name?: string;
  end_stop_id?: string;
}

// 등록된 경로 전체
export interface Route {
  id: string;
  user_id: string;
  name: string;
  depart_time: string; // "HH:MM"
  segments: RouteSegment[];
  created_at?: string;
  // 최종 목적지 (정류장/역 이후 실제 도착지 — 설정 시 여기 도착하면 모니터링 자동 종료)
  final_dest_name?: string | null;
  final_dest_lat?:  number | null;
  final_dest_lng?:  number | null;
  // 운행 요일 (0=일,1=월,...,6=토, JS Date.getDay() 방식). 없으면 매일
  days_of_week?: number[];
}

// 버스 실시간 정류장
export interface BusStop {
  nodeId: string;
  nodeName: string;
  gpslati: number;
  gpslong: number;
  city?: string;    // 시/도 이름 (서울, 경기, 대전 등)
  distance?: number; // 근처 정류장 조회 시 서버에서 계산된 거리(m)
}

// 사용자 문의 (질문하기)
export interface UserQuestion {
  id: string;
  user_id: string;
  user_nickname: string;
  title: string;
  content: string;
  created_at: string;
  answer?: string | null;
  answered_at?: string | null;
}

// 내비게이션 스택 파라미터
export type RootStackParamList = {
  Permission: undefined;
  Login: undefined;
  Home: undefined;
  RouteList: undefined;
  RouteRegister: { routeId?: string };
  RouteActive: { routeId: string };
  CustomerSupport: undefined;
  CustomerSupportDetail: { questionId: string };
  Admin: undefined;
  AdminQuestionDetail: { questionId: string };
};
