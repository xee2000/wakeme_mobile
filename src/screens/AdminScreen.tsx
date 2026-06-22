import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, UserQuestion } from '../types';
import { supabase } from '../api/supabaseClient';

type Props = NativeStackScreenProps<RootStackParamList, 'Admin'>;

export default function AdminScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [questions, setQuestions] = useState<UserQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unanswered' | 'answered'>('all');

  const loadQuestions = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    else setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setQuestions(data ?? []);
    } catch (e) {
      console.warn('[ADMIN] 문의 로드 실패:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadQuestions(); }, []);

  const filtered = questions.filter(q => {
    if (filter === 'unanswered') return !q.answer;
    if (filter === 'answered') return !!q.answer;
    return true;
  });

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A73E8" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* 통계 */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>{questions.length}</Text>
          <Text style={styles.statLabel}>전체</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: '#E53935' }]}>
            {questions.filter(q => !q.answer).length}
          </Text>
          <Text style={styles.statLabel}>미답변</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statNum, { color: '#38A169' }]}>
            {questions.filter(q => !!q.answer).length}
          </Text>
          <Text style={styles.statLabel}>답변완료</Text>
        </View>
      </View>

      {/* 필터 탭 */}
      <View style={styles.filterRow}>
        {(['all', 'unanswered', 'answered'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? '전체' : f === 'unanswered' ? '미답변' : '답변완료'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 목록 */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadQuestions(true)} />
        }
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>문의가 없습니다</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, item.answer && styles.cardAnswered]}
            onPress={() => navigation.navigate('AdminQuestionDetail', { questionId: item.id })}>
            {/* 상단: 닉네임 + 날짜 + 배지 */}
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.nickname}>{item.user_nickname}</Text>
                <View style={[styles.badge, item.answer ? styles.badgeAnswered : styles.badgeWaiting]}>
                  <Text style={styles.badgeText}>{item.answer ? '답변완료' : '대기중'}</Text>
                </View>
              </View>
              <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
            </View>

            {/* 제목 */}
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>

            {/* 내용 미리보기 */}
            <Text style={styles.cardContent} numberOfLines={2}>{item.content}</Text>

            {/* 답변 미리보기 */}
            {item.answer && (
              <View style={styles.answerPreview}>
                <Text style={styles.answerLabel}>↩ 답변</Text>
                <Text style={styles.answerText} numberOfLines={1}>{item.answer}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  statBox: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: '800', color: '#1A73E8' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 2 },
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterTab: {
    flex: 1, height: 34, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F5F7FA',
  },
  filterTabActive: { backgroundColor: '#1A73E8' },
  filterText: { fontSize: 13, fontWeight: '600', color: '#888' },
  filterTextActive: { color: '#fff' },
  card: {
    backgroundColor: '#fff', borderRadius: 12,
    padding: 16,
    borderLeftWidth: 3, borderLeftColor: '#E0E0E0',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  cardAnswered: { borderLeftColor: '#38A169' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  nickname: { fontSize: 13, fontWeight: '700', color: '#333' },
  dateText: { fontSize: 11, color: '#aaa' },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeWaiting: { backgroundColor: '#FFF3CD' },
  badgeAnswered: { backgroundColor: '#D4EDDA' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#555' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 4 },
  cardContent: { fontSize: 13, color: '#666', lineHeight: 19 },
  answerPreview: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
    gap: 6,
  },
  answerLabel: { fontSize: 12, fontWeight: '700', color: '#38A169', minWidth: 36 },
  answerText: { flex: 1, fontSize: 12, color: '#555' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, color: '#aaa' },
});
