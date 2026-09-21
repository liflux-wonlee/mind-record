import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, Row, RuleThick } from '@/components/ui';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import { friendlyMessage } from '@/lib/friendlyError';
import { searchEverything, type SearchHit } from '@/services/search';
import {
  askSearchQuestion,
  type SearchAnswerResult,
  type SearchCitation,
  type SearchTurn,
} from '@/services/searchAnswer';
import { colors, font, h2, radius } from '@/theme';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  session: 'Recording',
  task: 'Task',
  memory: 'Idea',
};

const INTERRUPTION_TEXT: Record<string, string> = {
  background: 'Stopped when the app left the foreground.',
  'recorder-error': 'The recording stopped unexpectedly.',
};

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A short back-and-forth of grounded Q&A turns, kept only for this visit
  // to the screen -- follow-ups like "그중 이번 주에 할 것은?" read the last
  // few of these; it's never written anywhere as a record of its own.
  const [history, setHistory] = useState<SearchTurn[]>([]);
  const [answer, setAnswer] = useState<SearchAnswerResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const recordTurn = (result: SearchAnswerResult) => {
    setAnswer(result);
    setAskError(null);
    setHistory((h) => [...h, { question: result.question, answer: result.answer }].slice(-5));
  };

  const voice = useVoiceSearch(recordTurn, history);

  // Debounced server search: every keystroke would otherwise be a round
  // trip, and results for an older query could land after a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      setError(null);
      return;
    }
    let stale = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchEverything(q)
        .then((results) => {
          if (stale) return;
          setHits(results);
          setError(null);
        })
        .catch((e) => {
          if (stale) return;
          setError(friendlyMessage(e, 'Search failed.'));
        })
        .finally(() => {
          if (!stale) setSearching(false);
        });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const open = (kind: string, id: string, sessionId: string | null, topicId: string | null) => {
    if (kind === 'task') {
      router.push({ pathname: '/tasks', params: { edit: id } });
    } else if (sessionId) {
      router.push({ pathname: '/summary', params: { sessionId } });
    } else if (topicId) {
      router.push(`/topic?id=${topicId}`);
    } else {
      router.push('/topic?unclassified=1');
    }
  };

  const askTyped = async () => {
    const q = query.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const result = await askSearchQuestion({ question: q, history });
      recordTurn(result);
    } catch (e) {
      setAskError(friendlyMessage(e, 'Could not answer that.'));
    } finally {
      setAsking(false);
    }
  };

  const onChangeQuery = (text: string) => {
    setQuery(text);
    setAnswer(null);
    setAskError(null);
  };

  const needle = query.trim();
  const citationKind = (kind: SearchCitation['kind']) => KIND_LABEL[kind];

  return (
    <Screen scroll={false}>
      {/* Fixed-height spacer, not removed outright -- keeps the big title
          in the same position it sat at below the small "Search" kicker
          this used to show. */}
      <View style={{ height: 15 }} />
      <Text style={styles.title}>Ask my memory</Text>

      <RuleThick />

      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {answer ? (
          <View style={styles.answerCard}>
            <View style={styles.answerHead}>
              <Kicker style={{ color: colors.accent700 }}>Answer</Kicker>
              {voice.state === 'speaking' ? (
                <Button
                  variant="ghost"
                  label="Stop"
                  onPress={voice.stopSpeaking}
                  style={{ minHeight: 28, paddingHorizontal: 8 }}
                  textStyle={{ fontSize: 12 }}
                />
              ) : null}
            </View>
            <Text style={styles.answerQuestion} numberOfLines={2}>
              &quot;{answer.question}&quot;
            </Text>
            <Text style={styles.answerText}>{answer.answer}</Text>
            {answer.citations.length > 0 ? (
              <View style={{ marginTop: 10 }}>
                <Kicker style={{ color: colors.neutral600, marginBottom: 4 }}>From</Kicker>
                {answer.citations.map((c) => (
                  <Row
                    key={`${c.kind}-${c.id}`}
                    onPress={() => open(c.kind, c.id, c.session_id, c.topic_id)}
                    style={styles.citationRow}
                  >
                    <CardKicker>{citationKind(c.kind)}</CardKicker>
                    <Text style={styles.citationText} numberOfLines={1}>
                      {c.title}
                    </Text>
                  </Row>
                ))}
              </View>
            ) : null}
            <Button
              variant="ghost"
              label="New search"
              onPress={() => {
                setAnswer(null);
                setQuery('');
              }}
              align="flex-start"
              style={{ marginTop: 12 }}
              textStyle={{ fontSize: 12 }}
            />
          </View>
        ) : askError ? (
          <Text style={styles.emptyText}>{askError}</Text>
        ) : !needle ? (
          <Text style={styles.emptyText}>
            Search everything you&apos;ve said — recordings, their full transcripts, tasks and ideas. Or type a
            question and tap search (or use the mic) to get an answer grounded in your own records.
          </Text>
        ) : error ? (
          <Text style={styles.emptyText}>{error}</Text>
        ) : searching && hits.length === 0 ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : hits.length === 0 ? (
          <Text style={styles.emptyText}>No matches for &quot;{needle}&quot;.</Text>
        ) : (
          hits.map((hit) => (
            <Row key={`${hit.kind}-${hit.id}`} onPress={() => open(hit.kind, hit.id, hit.session_id, hit.topic_id)} style={styles.resultRow}>
              <View style={styles.resultHead}>
                <CardKicker>{KIND_LABEL[hit.kind]}</CardKicker>
                <Text style={styles.resultDate}>
                  {new Date(hit.happened_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </View>
              <Text style={styles.resultText} numberOfLines={2}>
                {hit.title}
              </Text>
              {hit.snippet && hit.snippet !== hit.title ? (
                <Text style={styles.snippet} numberOfLines={3}>
                  {hit.snippet}
                </Text>
              ) : null}
            </Row>
          ))
        )}
      </ScrollView>

      {voice.interruption ? (
        <Text style={styles.interruptionText}>{INTERRUPTION_TEXT[voice.interruption] ?? 'Stopped.'}</Text>
      ) : voice.state === 'recording' ? (
        <Text style={styles.interruptionText}>Listening… tap the mic again when you&apos;re done.</Text>
      ) : voice.state === 'thinking' ? (
        <Text style={styles.interruptionText}>Thinking…</Text>
      ) : null}

      {/* The input is pinned at the bottom; iOS never resizes for the keyboard on its own. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.askRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onChangeQuery}
          onSubmitEditing={askTyped}
          placeholder="Search or ask a question"
          placeholderTextColor={colors.neutral600}
          returnKeyType="search"
          autoCorrect={false}
          editable={voice.state === 'idle'}
        />
        <Button
          accessibilityLabel={
            voice.state === 'recording' ? 'Stop and ask' : voice.state === 'speaking' ? 'Stop playback' : 'Ask by voice'
          }
          onPress={() => {
            if (voice.state === 'idle') voice.startRecording();
            else if (voice.state === 'recording') voice.stopRecordingAndAsk();
            else if (voice.state === 'speaking') voice.stopSpeaking();
          }}
          disabled={voice.state === 'thinking' || asking}
          icon={
            voice.state === 'thinking' ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <MicIcon size={22} color={colors.bg} />
            )
          }
          style={[styles.voiceButton, voice.state === 'recording' && styles.voiceButtonActive]}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...h2,
    marginTop: 6,
    marginBottom: 14,
  },
  results: {
    flex: 1,
  },
  centerBlock: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral600,
    paddingVertical: 14,
  },
  answerCard: {
    borderRadius: radius.pastel,
    padding: 16,
    backgroundColor: colors.pastelLavender,
    marginTop: 12,
    marginBottom: 4,
  },
  answerHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  answerQuestion: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral700,
    marginTop: 4,
  },
  answerText: {
    fontFamily: font.semibold,
    fontSize: 16,
    lineHeight: 23,
    color: colors.text,
    marginTop: 6,
  },
  citationRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(32,30,29,0.12)',
  },
  citationText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
    marginTop: 2,
  },
  resultRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  resultHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultDate: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  resultText: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginTop: 3,
  },
  snippet: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral700,
    marginTop: 2,
  },
  interruptionText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral600,
    marginTop: 8,
  },
  askRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  voiceButton: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 0,
    justifyContent: 'center',
  },
  voiceButtonActive: {
    backgroundColor: colors.accent700,
  },
});
