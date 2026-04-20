import { supabase } from './supabaseClient';
import { Route, RouteSegment } from '../types';

// ── 경로 목록 조회 ──────────────────────────────
export async function fetchRoutes(userId: string): Promise<Route[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('*, route_segments(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map(row => ({
    ...row,
    segments: row.route_segments ?? [],
  }));
}

// ── 경로 저장 ──────────────────────────────────
export async function saveRoute(
  userId: string,
  name: string,
  departTime: string,
  segments: Omit<RouteSegment, 'id' | 'route_id'>[],
): Promise<Route> {
  // 1. routes 테이블 insert
  const { data: routeData, error: routeErr } = await supabase
    .from('routes')
    .insert({ user_id: userId, name, depart_time: departTime })
    .select()
    .single();

  if (routeErr) throw routeErr;

  // 2. route_segments 테이블 insert
  const segRows = segments.map((s, i) => ({
    ...s,
    route_id: routeData.id,
    order_index: i,
  }));

  const { error: segErr } = await supabase.from('route_segments').insert(segRows);
  if (segErr) throw segErr;

  return { ...routeData, segments: segRows };
}

// ── 경로 삭제 ──────────────────────────────────
export async function deleteRoute(routeId: string): Promise<void> {
  const { error } = await supabase.from('routes').delete().eq('id', routeId);
  if (error) throw error;
}
