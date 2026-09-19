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
import { searchEverything, type SearchHit } from '@/services/search';
import { colors, font, h2 } from '@/theme';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  session: 'Recording',
  task: 'Task',
  memory: 'Idea',
};

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setError(e instanceof Error ? e.message : 'Search failed.');
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

  const open = (hit: SearchHit) => {
    if (hit.kind === 'task') {
      router.push({ pathname: '/tasks', params: { edit: hit.id } });
    } else if (hit.session_id) {
      router.push({ pathname: '/summary', params: { sessionId: hit.session_id } });
    } else if (hit.topic_id) {
      router.push(`/topic?id=${hit.topic_id}`);
    } else {
      router.push('/topic?unclassified=1');
    }
  };

  const needle = query.trim();

  return (
    <Screen scroll={false}>
      <Kicker style={{ color: colors.neutral600 }}>Search</Kicker>
      <Text style={styles.title}>Ask my memory</Text>

      <RuleThick />

      <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
        {!needle ? (
          <Text style={styles.emptyText}>
            Search everything you&apos;ve said — recordings, their full transcripts, tasks and ideas.
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
            <Row key={`${hit.kind}-${hit.id}`} onPress={() => open(hit)} style={styles.resultRow}>
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

      {/* The input is pinned at the bottom; iOS never resizes for the keyboard on its own. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.askRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your memory"
          placeholderTextColor={colors.neutral600}
          returnKeyType="search"
          autoCorrect={false}
        />
        <Button
          accessibilityLabel="voice"
          onPress={() => router.push('/talk')}
          icon={<MicIcon size={22} color={colors.bg} />}
          style={styles.voiceButton}
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
});
