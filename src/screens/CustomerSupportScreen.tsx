import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, UserQuestion } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { supabase } from '../api/supabaseClient';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerSupport'>;

export default function CustomerSupportScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);

  const [questions, setQuestions] = useState<UserQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 질문 작성 모달
  const [formVisible, setFormVisible] = useState(false);
  const [qTitle, setQTitle] = useState('');
  const [qContent, setQContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadQuestions = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setQuestions(data ?? []);
    } catch (e) {
      console.warn('[CS] 문의 로드 실패:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadQuestions(); }, []);

  const handleSubmit = async () => {
    if (!qTitle.trim()) { Alert.alert('알림', '제목을 입력해주세요.'); return; }
    if (!qContent.trim()) { Alert.alert('알림', '내용을 입력해주세요.'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('questions').insert({
        user_id: user!.id,
        user_nickname: user!.nickname,
        title: qTitle.trim(),
        content: qContent.trim(),
      });
      if (error) throw error;
      setQTitle('');
      setQContent('');
      setFormVisible(false);
      await loadQuestions();
      Alert.alert('접수 완료', '문의가 접수되었습니다.\n답변이 등록되면 이 화면에서 확인하실 수 있습니다.');
    } catch (e) {
      Alert.alert('오류', '전송에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* 안내 배너 */}
      <View style={styles.banner}>
        <Text style={styles.bannerIcon}>📋</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>무엇을 도와드릴까요?</Text>
          <Text style={styles.bannerSub}>불편한 점이나 개선사항을 남겨주세요</Text>
        </View>
      </View>

      {/* 문의 목록 */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1A73E8" />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadQuestions(true)} />
          }>
          {questions.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>문의 내역이 없습니다</Text>
              <Text style={styles.emptySub}>아래 버튼을 눌러 첫 문의를 남겨보세요</Text>
            </View>
          ) : (
            questions.map(q => (
              <TouchableOpacity
                key={q.id}
                style={styles.card}
                onPress={() => navigation.navigate('CustomerSupportDetail', { questionId: q.id })}>
                {/* 상단: 날짜 + 상태 배지 */}
                <View style={styles.cardTop}>
                  <Text style={styles.cardDate}>{formatDate(q.created_at)}</Text>
                  <View style={[styles.badge, q.answer ? styles.badgeDone : styles.badgeWaiting]}>
                    <View style={[styles.badgeDot, { backgroundColor: q.answer ? '#38A169' : '#F59E0B' }]} />
                    <Text style={[styles.badgeText, { color: q.answer ? '#276749' : '#92400E' }]}>
                      {q.answer ? '답변완료' : '답변대기'}
                    </Text>
                  </View>
                </View>

                {/* 제목 */}
                <Text style={styles.cardTitle} numberOfLines={1}>{q.title}</Text>

                {/* 내용 미리보기 */}
                <Text style={styles.cardPreview} numberOfLines={2}>{q.content}</Text>

                {/* 답변 미리보기 */}
                {q.answer && (
                  <View style={styles.answerBubble}>
                    <Text style={styles.answerBubbleLabel}>답변</Text>
                    <Text style={styles.answerBubbleText} numberOfLines={2}>{q.answer}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      {/* 하단 질문하기 버튼 */}
      <View style={[styles.footer, { paddingBottom: insets.bottom > 0 ? 0 : 16 }]}>
        <TouchableOpacity style={styles.newBtn} onPress={() => setFormVisible(true)}>
          <Text style={styles.newBtnText}>+ 새 문의하기</Text>
        </TouchableOpacity>
      </View>

      {/* 질문 작성 모달 */}
      <Modal
        visible={formVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFormVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity
            style={formStyles.overlay}
            activeOpacity={1}
            onPress={() => setFormVisible(false)}>
            <TouchableOpacity activeOpacity={1} style={formStyles.sheet}>
              <View style={formStyles.handle} />
              <Text style={formStyles.title}>문의하기</Text>
              <Text style={formStyles.sub}>불편한 점이나 개선사항을 알려주세요</Text>

              <Text style={formStyles.label}>제목</Text>
              <TextInput
                style={formStyles.input}
                placeholder="문의 제목을 입력해주세요"
                placeholderTextColor="#aaa"
                value={qTitle}
                onChangeText={setQTitle}
                maxLength={60}
              />

              <Text style={formStyles.label}>내용</Text>
              <TextInput
                style={[formStyles.input, formStyles.textarea]}
                placeholder="문의 내용을 자세히 적어주세요"
                placeholderTextColor="#aaa"
                value={qContent}
                onChangeText={setQContent}
                multiline
                maxLength={500}
                textAlignVertical="top"
              />
              <Text style={formStyles.charCount}>{qContent.length}/500</Text>

              <View style={formStyles.btnRow}>
                <TouchableOpacity
                  style={formStyles.cancelBtn}
                  onPress={() => setFormVisible(false)}>
                  <Text style={formStyles.cancelText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[formStyles.submitBtn, submitting && { opacity: 0.6 }]}
                  onPress={handleSubmit}
                  disabled={submitting}>
                  {submitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={formStyles.submitText}>전송</Text>}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', padding: 18,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  bannerIcon: { fontSize: 32 },
  bannerTitle: { fontSize: 16, fontWeight: '700', color: '#1A1A2E', marginBottom: 2 },
  bannerSub: { fontSize: 13, color: '#888' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#555' },
  emptySub: { fontSize: 13, color: '#aaa' },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardDate: { fontSize: 12, color: '#aaa' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4,
  },
  badgeWaiting: { backgroundColor: '#FEF3C7' },
  badgeDone: { backgroundColor: '#D1FAE5' },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 6 },
  cardPreview: { fontSize: 13, color: '#666', lineHeight: 20 },
  answerBubble: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  answerBubbleLabel: {
    fontSize: 11, fontWeight: '800', color: '#fff',
    backgroundColor: '#38A169', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2, minWidth: 36, textAlign: 'center',
  },
  answerBubbleText: { flex: 1, fontSize: 13, color: '#444', lineHeight: 18 },
  footer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  newBtn: {
    height: 52, backgroundColor: '#1A73E8',
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

const formStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 20,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 },
  sub: { fontSize: 13, color: '#888', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 6 },
  input: {
    backgroundColor: '#F5F7FA', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#222',
    borderWidth: 1, borderColor: '#E8EAF0',
    marginBottom: 16,
  },
  textarea: { height: 120, textAlignVertical: 'top' },
  charCount: { fontSize: 11, color: '#aaa', textAlign: 'right', marginTop: -12, marginBottom: 20 },
  btnRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, height: 48, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E0E0E0',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { color: '#888', fontSize: 15, fontWeight: '600' },
  submitBtn: {
    flex: 2, height: 48, borderRadius: 12,
    backgroundColor: '#1A73E8',
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
