/**
 * 공용 REST API 클라이언트
 *
 * 서버 IP/포트를 한 곳에서 관리합니다.
 * IP가 바뀌면 SERVER_IP 상수만 수정하면 됩니다.
 *
 * 사용 예:
 *   import { RestApi } from './RestApi';
 *   const data = await RestApi.get<MyType>('/api/stops/nearby?lat=36.3&lng=127.3');
 *   const result = await RestApi.post<Result>('/api/user', { id: '123' });
 */

import { Platform } from 'react-native';

// ────────────────────────────────────────────────────────────────
//  ✏️  IP 변경 시 이 줄만 수정
// ────────────────────────────────────────────────────────────────
const SERVER_IP = '192.168.219.104';
const SERVER_PORT = 3000;
// ────────────────────────────────────────────────────────────────

const BASE_URL =
  process.env.SERVER_URL ??
  (Platform.OS === 'android'
    ? `http://${SERVER_IP}:${SERVER_PORT}`
    : `http://localhost:${SERVER_PORT}`);

// ── 공통 헤더 ──────────────────────────────────────────────────
function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

// ── 응답 파싱 ──────────────────────────────────────────────────
async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`[${res.status}] ${text}`);
  }
  const json = await res.json();
  // 서버 응답이 { data: ... } 형태면 data 추출, 아니면 전체 반환
  return ('data' in json ? json.data : json) as T;
}

// ── HTTP 메서드 ────────────────────────────────────────────────
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers: headers(), signal });
  return parseResponse<T>(res);
}

async function post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });
  return parseResponse<T>(res);
}

async function put<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });
  return parseResponse<T>(res);
}

async function del<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: headers(), signal });
  return parseResponse<T>(res);
}

// ── 외부 공개 ──────────────────────────────────────────────────
export const RestApi = { get, post, put, del, BASE_URL };
