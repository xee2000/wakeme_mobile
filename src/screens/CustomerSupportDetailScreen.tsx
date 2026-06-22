import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, UserQuestion } from '../types';
import { supabase } from '../api/supabaseClient';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerSupportDetail'>;

export default function CustomerSupportDetailScreen({ route, navigation }: Props) {
  const { questionId } = route.params;
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState<UserQuestion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from('questions')
          .select('*')
          .eq('id', questionId)
          .single();
        if (error) throw error;
        setQuestion(data);
      } catch {
        Alert.alert('오류', '문의를 불러오지 못했습니다.');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [questionId]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#1A73E8" /></View>;
  }
  if (!question) return null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>

      {/* 상태 배지 */}
      <View style={styles.statusRow}>
        <View style={[styles.badge, question.answer ? styles.badgeDone : styles.badgeWaiting]}>
          <View style={[styles.badgeDot, { backgroundColor: question.answer ? '#38A169' : '#F59E0B' }]} />
          <Text style={[styles.badgeText, { color: question.answer ? '#276749' : '#92400E' }]}>
            {question.answer ? '답변완료' : '답변대기 중'}
          </Text>
        </View>
        <Text style={styles.dateText}>{formatDate(question.created_at)}</Text>
      </View>

      {/* 문의 내용 카드 */}
      <View style={styles.card}>
        <View style={styles.cardLabelRow}>
          <Text style={styles.cardLabel}>문의</Text>
        </View>
        <Text style={styles.title}>{question.title}</Text>
        <Text style={styles.content}>{question.content}</Text>
      </View>

      {/* 답변 카드 */}
      {question.answer ? (
        <View style={styles.answerCard}>
          <View style={styles.answerLabelRow}>
            <Text style={styles.answerLabel}>📣 답변</Text>
            {question.answered_at && (
              <Text style={styles.answeredAt}>{formatDate(question.answered_at)}</Text>
            )}
          </View>
          <Text style={styles.answerContent}>{question.answer}</Text>
        </View>
      ) : (
        <View style={styles.waitingCard}>
          <Text style={styles.waitingIcon}>⏳</Text>
          <Text style={styles.waitingTitle}>답변을 준비 중입니다</Text>
          <Text style={styles.waitingSub}>빠른 시일 내에 답변드리겠습니다</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  badgeWaiting: { backgroundColor: '#FEF3C7' },
  badgeDone: { backgroundColor: '#D1FAE5' },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 13, fontWeight: '700' },
  dateText: { fontSize: 12, color: '#aaa' },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18,
    marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  cardLabelRow: { marginBottom: 10 },
  cardLabel: {
    fontSize: 11, fontWeight: '800', color: '#1A73E8',
    backgroundColor: '#EBF3FF', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  title: { fontSize: 17, fontWeight: '800', color: '#1A1A2E', marginBottom: 10 },
  content: { fontSize: 15, color: '#444', lineHeight: 24 },
  answerCard: {
    backgroundColor: '#F0FFF4', borderRadius: 14, padding: 18,
    borderLeftWidth: 4, borderLeftColor: '#38A169',
    shadowColor: '#38A169', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  answerLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  answerLabel: { fontSize: 14, fontWeight: '800', color: '#276749' },
  answeredAt: { fontSize: 11, color: '#aaa' },
  answerContent: { fontSize: 15, color: '#2D4A35', lineHeight: 24 },
  waitingCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 28,
    alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: '#F0F0F0',
    borderStyle: 'dashed',
  },
  waitingIcon: { fontSize: 36, marginBottom: 4 },
  waitingTitle: { fontSize: 15, fontWeight: '700', color: '#555' },
  waitingSub: { fontSize: 13, color: '#aaa' },
});
