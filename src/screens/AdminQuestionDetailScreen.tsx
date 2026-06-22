import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList, UserQuestion } from '../types';
import { supabase } from '../api/supabaseClient';

type Props = NativeStackScreenProps<RootStackParamList, 'AdminQuestionDetail'>;

export default function AdminQuestionDetailScreen({ route, navigation }: Props) {
  const { questionId } = route.params;
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState<UserQuestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadQuestion();
  }, [questionId]);

  const loadQuestion = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('id', questionId)
        .single();
      if (error) throw error;
      setQuestion(data);
      setAnswer(data.answer ?? '');
    } catch (e) {
      Alert.alert('오류', '문의를 불러오지 못했습니다.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAnswer = async () => {
    if (!answer.trim()) {
      Alert.alert('알림', '답변 내용을 입력해주세요.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('questions')
        .update({
          answer: answer.trim(),
          answered_at: new Date().toISOString(),
        })
        .eq('id', questionId);
      if (error) throw error;
      Alert.alert('완료', '답변이 저장되었습니다.', [
        { text: '확인', onPress: () => { loadQuestion(); } },
      ]);
    } catch (e) {
      Alert.alert('오류', '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAnswer = async () => {
    Alert.alert('답변 삭제', '등록된 답변을 삭제하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await supabase
              .from('questions')
              .update({ answer: null, answered_at: null })
              .eq('id', questionId);
            setAnswer('');
            loadQuestion();
          } catch (e) {
            Alert.alert('오류', '삭제에 실패했습니다.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1A73E8" />
      </View>
    );
  }

  if (!question) return null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled">

        {/* 문의 정보 카드 */}
        <View style={styles.section}>
          <View style={styles.metaRow}>
            <View style={styles.userTag}>
              <Text style={styles.userTagText}>👤 {question.user_nickname}</Text>
            </View>
            <Text style={styles.dateText}>{formatDate(question.created_at)}</Text>
          </View>

          <Text style={styles.title}>{question.title}</Text>
          <Text style={styles.content}>{question.content}</Text>
        </View>

        <View style={styles.divider} />

        {/* 답변 섹션 */}
        <View style={styles.section}>
          <View style={styles.answerHeader}>
            <Text style={styles.answerLabel}>↩ 답변 작성</Text>
            {question.answer && question.answered_at && (
              <Text style={styles.answeredAt}>
                {formatDate(question.answered_at)} 답변완료
              </Text>
            )}
          </View>

          <TextInput
            style={styles.answerInput}
            placeholder="사용자에게 전달할 답변을 입력해주세요..."
            placeholderTextColor="#aaa"
            value={answer}
            onChangeText={setAnswer}
            multiline
            textAlignVertical="top"
          />

          <View style={styles.btnRow}>
            {question.answer && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={handleDeleteAnswer}
                disabled={saving}>
                <Text style={styles.deleteBtnText}>답변 삭제</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }, !question.answer && { flex: 1 }]}
              onPress={handleSaveAnswer}
              disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {question.answer ? '답변 수정' : '답변 등록'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { backgroundColor: '#fff', padding: 20, marginTop: 12, marginHorizontal: 16, borderRadius: 16 },
  divider: { height: 1, backgroundColor: 'transparent' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  userTag: {
    backgroundColor: '#EBF3FF', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  userTagText: { fontSize: 13, fontWeight: '700', color: '#1A73E8' },
  dateText: { fontSize: 12, color: '#aaa' },
  title: { fontSize: 18, fontWeight: '800', color: '#1A1A2E', marginBottom: 12 },
  content: { fontSize: 15, color: '#444', lineHeight: 24 },
  answerHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  answerLabel: { fontSize: 15, fontWeight: '700', color: '#38A169' },
  answeredAt: { fontSize: 11, color: '#aaa' },
  answerInput: {
    backgroundColor: '#F5F7FA', borderRadius: 10,
    padding: 14, fontSize: 15, color: '#222',
    minHeight: 160,
    borderWidth: 1, borderColor: '#E8EAF0',
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  deleteBtn: {
    flex: 1, height: 48, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#E53935',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { color: '#E53935', fontWeight: '600', fontSize: 15 },
  saveBtn: {
    flex: 2, height: 48, borderRadius: 12,
    backgroundColor: '#38A169',
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
