import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { CheckIcon, ShareIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { ShareSheet, type ShareContent } from '@/components/ShareSheet';
import { Button, CardKicker, Kicker, RuleThick, Tag } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
import { dismissToTabs } from '@/nav';
import { useAuth } from '@/providers/AuthProvider';
import { assignMemoryTopic, listMemoriesBySession, type Memory } from '@/services/memories';
import { processSession } from '@/services/processing';
import { getSession, type Session } from '@/services/sessions';
import { assignTaskTopic, listTasksBySession, type Task } from '@/services/tasks';
import {
  assignSessionTopic,
  confirmTopicSuggestion,
  listSessionTopics,
  listTopics,
  type Topic,
} from '@/services/topics';
import { colors, font, radius } from '@/theme';

/** Renders `**bold**` spans within an outline bullet or the transcript is never bolded, only bullets are. */
function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <Text key={i} style={styles.bold}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      part
    )
  );
}

// Transcription of a long capture plus the GPT pass can take a couple of
// minutes; past this the Edge Function has almost certainly been killed.
const PROCESSING_TIMEOUT_MS = 4 * 60 * 1000;

type EntryKind = 'task' | 'memory';
type Entry = {
  id: string;
  kind: EntryKind;
  kicker: string;
  title: string;
  topicId: string | null;
  topicSuggestion: string | null;
};

function topicDisplayName(topic: Topic, all: Topic[]): string {
  if (!topic.parent_topic_id) return topic.name;
  const parent = all.find((t) => t.id === topic.parent_topic_id);
  return parent ? `${parent.name} · ${topic.name}` : topic.name;
}

function TabOption({
  label,
  selected,
  onPress,
  color,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tabOpt, { backgroundColor: color }, selected ? styles.tabOptSelected : { opacity: 0.55 }]}
    >
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// Rotates through the pastel set so no two neighbouring topic buttons in
// the picker share a color.
const PICKER_COLORS = [
  colors.pastelGreen,
  colors.pastelBlue,
  colors.pastelPeach,
  colors.pastelLavender,
  colors.pastelYellow,
  colors.pastelPink,
];

type StepState = 'done' | 'active' | 'pending';

/**
 * Step-by-step processing status, honestly derived from the real
 * `sessions.processing_status` the poll above already tracks -- no fake
 * percentages, since process-session doesn't report granular progress
 * within a step. "Uploading" is always shown as already complete: by the
 * time this screen can poll a session at all, the recording's audio has
 * already been uploaded (useCaptureSession/useConversationSession await
 * that before ever navigating here).
 */
function ProcessingSteps({ status }: { status: Session['processing_status'] | undefined }) {
  const transcribingDone = status === 'analyzing';
  const steps: { label: string; state: StepState }[] = [
    { label: 'Uploading', state: 'done' },
    { label: 'Transcribing your recording', state: transcribingDone ? 'done' : 'active' },
    { label: 'Finding tasks, ideas & topics', state: transcribingDone ? 'active' : 'pending' },
  ];
  return (
    <View style={[styles.summaryCard, styles.processing]}>
      {steps.map((step) => (
        <View key={step.label} style={styles.stepRow}>
          {step.state === 'done' ? (
            <View style={[styles.stepIcon, styles.stepIconDone]}>
              <CheckIcon size={13} color={colors.bg} />
            </View>
          ) : step.state === 'active' ? (
            <ActivityIndicator size="small" color={colors.accent700} style={styles.stepIcon} />
          ) : (
            <View style={[styles.stepIcon, styles.stepIconPending]} />
          )}
          <Text style={[styles.stepLabel, step.state === 'pending' && styles.stepLabelPending]}>{step.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The transcribe-then-analyze pipeline (supabase/functions/process-session)
 * runs in the background after a recording ends — this screen polls
 * `sessions.processing_status` rather than pretending the result is
 * instant, and renders the real extracted tasks/ideas once it's done.
 *
 * Each task/idea carries its own AI-assigned topic (or, when the AI wasn't
 * confident, a `topic_suggestion` the user confirms or overrides here —
 * "물어보는 식으로 처리" from the topic-hierarchy request, done as a
 * deterministic confirm step rather than a live voice conversation).
 */
export default function SummaryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();

  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sessionTopics, setSessionTopics] = useState<Topic[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // What the topic picker sheet is filing: a task/idea, or the whole recording.
  const [picking, setPicking] = useState<Entry | { kind: 'session'; id: string } | null>(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [shareContent, setShareContent] = useState<ShareContent | null>(null);

  const recordingHeader = (s: Session): string => {
    const title = s.title || 'Untitled recording';
    const date = new Date(s.started_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return `${title}\n${date}`;
  };

  // Bold markers are a display-only affordance (renderInlineBold above) --
  // shared/copied text is plain, not markdown.
  const stripBold = (text: string) => text.replace(/\*\*/g, '');

  // Shares whichever tab is currently showing -- the recording's title/date
  // plus either its summary+outline or its full transcript, matching the
  // spec's "recording share = title/date/chosen summary-or-transcript"
  // (the tab toggle already above this screen IS that choice).
  const shareCurrentView = () => {
    if (!session) return;
    const header = recordingHeader(session);
    if (tab === 'transcript') {
      if (!session.raw_transcript) return;
      setShareContent({
        kicker: 'Recording · Transcript',
        title: session.title || 'Recording',
        body: `${header}\n\n${session.raw_transcript}`,
      });
      return;
    }
    const outlineText = (session.outline ?? [])
      .map((s) => `${s.heading}\n${s.bullets.map((b) => `• ${stripBold(b)}`).join('\n')}`)
      .join('\n\n');
    const quotesText = (session.notable_quotes ?? []).length
      ? `Notable quotes\n${session.notable_quotes.map((q) => `"${q}"`).join('\n')}`
      : '';
    const body = [header, session.summary, outlineText, quotesText].filter(Boolean).join('\n\n');
    setShareContent({ kicker: 'Recording · Summary', title: session.title || 'Recording', body });
  };

  const shareOutlineSection = (section: { heading: string; bullets: string[] }) => {
    setShareContent({
      kicker: 'Outline',
      title: section.heading,
      body: `${section.heading}\n\n${section.bullets.map((b) => `• ${stripBold(b)}`).join('\n')}`,
    });
  };

  const shareEntry = (entry: Entry) => {
    setShareContent({ kicker: entry.kicker, title: entry.kicker, body: entry.title });
  };

  const loadResults = useCallback(async () => {
    if (!sessionId || !user) return;
    const [t, m, tp, st] = await Promise.all([
      listTasksBySession(sessionId),
      listMemoriesBySession(sessionId),
      listTopics(user.id),
      listSessionTopics(sessionId),
    ]);
    setTasks(t);
    setMemories(m);
    setTopics(tp);
    setSessionTopics(st);
  }, [sessionId, user]);

  // Bumped by "Retry" to restart the poll (and re-kick processing).
  const [pollRun, setPollRun] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveFailures = 0;
    const startedAt = Date.now();
    setLoadError(null);

    const poll = async () => {
      try {
        const s = await getSession(sessionId);
        if (cancelled) return;
        if (!s) throw new Error('This recording no longer exists.');
        setSession(s);
        consecutiveFailures = 0;

        if (s.processing_status === 'done') {
          await loadResults();
          return;
        }
        if (s.processing_status === 'error') return;
        // Nothing legitimately takes this long -- the Edge Function was
        // most likely killed mid-way (it can't mark the row 'error' then),
        // so stop spinning and offer a retry instead of polling forever.
        if (Date.now() - startedAt > PROCESSING_TIMEOUT_MS) {
          throw new Error('Processing is taking too long. Tap Retry to try again.');
        }
        timer = setTimeout(poll, 1500);
      } catch (e) {
        if (cancelled) return;
        // One flaky request shouldn't end the poll for good.
        consecutiveFailures += 1;
        if (consecutiveFailures < 3 && Date.now() - startedAt <= PROCESSING_TIMEOUT_MS) {
          timer = setTimeout(poll, 2500);
          return;
        }
        setLoadError(friendlyMessage(e, 'Could not load this session.'));
      }
    };
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, pollRun]);

  const retryProcessing = () => {
    if (!sessionId) return;
    processSession(sessionId).catch(() => {
      // The poll below surfaces whatever state the row ends up in.
    });
    setPollRun((n) => n + 1);
  };

  const entries: Entry[] = [
    ...tasks.map((t) => ({
      id: t.id,
      kind: 'task' as const,
      kicker: 'Task',
      title: t.title,
      topicId: t.topic_id,
      topicSuggestion: t.topic_suggestion,
    })),
    ...memories.map((m) => ({
      id: m.id,
      kind: 'memory' as const,
      kicker: 'Idea',
      title: m.content,
      topicId: m.topic_id,
      topicSuggestion: m.topic_suggestion,
    })),
  ];
  const processing =
    !!sessionId && session?.processing_status !== 'done' && session?.processing_status !== 'error';
  const done = !!sessionId && !loadError && session?.processing_status === 'done';

  const assignEntryTopic = async (entry: Entry, topicId: string) => {
    setBusyEntryId(entry.id);
    try {
      if (entry.kind === 'task') {
        await assignTaskTopic(entry.id, topicId);
      } else {
        await assignMemoryTopic(entry.id, topicId);
      }
      await loadResults();
      setPicking(null);
    } catch {
      // Leave the suggestion in place -- the user can just try again.
    } finally {
      setBusyEntryId(null);
    }
  };

  const useSuggestion = async (entry: Entry) => {
    if (!user || !entry.topicSuggestion) return;
    setBusyEntryId(entry.id);
    try {
      const topic = await confirmTopicSuggestion(user.id, topics, entry.topicSuggestion);
      await assignEntryTopic(entry, topic.id);
    } catch {
      setBusyEntryId(null);
    }
  };

  const fileSessionUnder = async (topicId: string) => {
    if (!sessionId) return;
    setBusyEntryId(sessionId);
    try {
      await assignSessionTopic(sessionId, topicId);
      const [s, st] = await Promise.all([getSession(sessionId), listSessionTopics(sessionId)]);
      setSession(s);
      setSessionTopics(st);
      setPicking(null);
    } catch (e) {
      Alert.alert('Could not file this recording', friendlyMessage(e, 'Please try again.'));
    } finally {
      setBusyEntryId(null);
    }
  };

  const useSessionSuggestion = async () => {
    if (!user || !session?.topic_suggestion) return;
    setBusyEntryId(sessionId ?? null);
    try {
      const topic = await confirmTopicSuggestion(user.id, topics, session.topic_suggestion);
      await fileSessionUnder(topic.id);
    } catch (e) {
      Alert.alert('Could not file this recording', friendlyMessage(e, 'Please try again.'));
      setBusyEntryId(null);
    }
  };

  const onPickTopic = (topicId: string) => {
    if (!picking) return;
    if (picking.kind === 'session') fileSessionUnder(topicId);
    else assignEntryTopic(picking, topicId);
  };

  return (
    <Screen safeBottom showAccount={false}>
      {done ? (
        <View style={styles.tabRow}>
          <View style={styles.tabGroup}>
            <TabOption
              label="Summary"
              color={colors.pastelPeach}
              selected={tab === 'summary'}
              onPress={() => setTab('summary')}
            />
            <TabOption
              label="Transcript"
              color={colors.pastelBlue}
              selected={tab === 'transcript'}
              onPress={() => setTab('transcript')}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share this recording"
            onPress={shareCurrentView}
            style={styles.shareTabButton}
            hitSlop={8}
          >
            <ShareIcon size={18} color={colors.neutral700} />
          </Pressable>
        </View>
      ) : null}

      {!sessionId ? (
        <View style={styles.summaryCard}>
          <Kicker style={{ color: colors.neutral700 }}>Saved</Kicker>
          <Text style={styles.summaryText}>Recording saved.</Text>
        </View>
      ) : loadError ? (
        <View style={[styles.summaryCard, { backgroundColor: colors.pastelPink }]}>
          <Kicker style={{ color: colors.accent700 }}>Couldn&apos;t load</Kicker>
          <Text style={styles.summaryText}>{loadError}</Text>
          <Button
            label="Retry"
            onPress={retryProcessing}
            style={[styles.retryButton, { backgroundColor: colors.pastelYellow }]}
            textStyle={styles.pastelText}
          />
        </View>
      ) : processing ? (
        <ProcessingSteps status={session?.processing_status} />
      ) : session?.processing_status === 'error' ? (
        <View style={[styles.summaryCard, { backgroundColor: colors.pastelPink }]}>
          <Kicker style={{ color: colors.accent700 }}>Couldn&apos;t process this recording</Kicker>
          <Text style={styles.summaryText}>{session.processing_error ?? 'Something went wrong.'}</Text>
          <Button
            label="Retry"
            onPress={retryProcessing}
            style={[styles.retryButton, { backgroundColor: colors.pastelYellow }]}
            textStyle={styles.pastelText}
          />
        </View>
      ) : tab === 'summary' ? (
        <View style={styles.summaryCard}>
          <Kicker style={{ color: colors.neutral700 }}>Summary</Kicker>
          <Text style={styles.summaryText}>
            {session?.summary || `${tasks.length} tasks, ${memories.length} ideas.`}
          </Text>

          {/* Where this recording is filed. Every recording should end up
              under a topic -- this is the only place a plain journal entry
              (no tasks/ideas) can be filed or re-filed. */}
          <View style={styles.topicRow}>
            {sessionTopics.length > 0 ? (
              <>
                <View style={styles.topicTags}>
                  {sessionTopics.map((t) => (
                    <Tag key={t.id} variant="neutral">
                      {topicDisplayName(t, topics)}
                    </Tag>
                  ))}
                </View>
                <Button
                  variant="ghost"
                  label="Change"
                  disabled={busyEntryId === sessionId}
                  onPress={() => sessionId && setPicking({ kind: 'session', id: sessionId })}
                  style={{ minHeight: 32, paddingHorizontal: 6 }}
                  textStyle={{ fontSize: 12 }}
                />
              </>
            ) : session?.topic_suggestion ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestText}>AI thinks this belongs under &quot;{session.topic_suggestion}&quot;</Text>
                <View style={styles.suggestActions}>
                  <Button
                    label={busyEntryId === sessionId ? 'Saving…' : `Use "${session.topic_suggestion}"`}
                    disabled={busyEntryId === sessionId}
                    onPress={useSessionSuggestion}
                    style={[styles.suggestButton, { backgroundColor: colors.pastelGreen }]}
                    textStyle={styles.pastelSmallText}
                  />
                  <Button
                    label="Pick topic"
                    disabled={busyEntryId === sessionId}
                    onPress={() => sessionId && setPicking({ kind: 'session', id: sessionId })}
                    style={[styles.suggestButton, { backgroundColor: colors.pastelLavender }]}
                    textStyle={styles.pastelSmallText}
                  />
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.suggestText}>Not filed under a topic yet.</Text>
                <Button
                  label="Pick topic"
                  disabled={busyEntryId === sessionId}
                  onPress={() => sessionId && setPicking({ kind: 'session', id: sessionId })}
                  style={[styles.suggestButton, { backgroundColor: colors.pastelLavender }]}
                  textStyle={styles.pastelSmallText}
                />
              </>
            )}
          </View>
        </View>
      ) : null}

      {done ? <RuleThick /> : null}

      {!done ? null : tab === 'summary' ? (
        <>
          {(session?.outline ?? []).map((section, i) => (
            <Pressable
              key={i}
              style={styles.outlineSection}
              onLongPress={() => shareOutlineSection(section)}
              accessibilityRole="button"
              accessibilityLabel={`Share section: ${section.heading}`}
            >
              <Text style={styles.outlineHeading}>{section.heading}</Text>
              {section.bullets.map((bullet, j) => (
                <Text key={j} style={styles.outlineBullet}>
                  {'•  '}
                  {renderInlineBold(bullet)}
                </Text>
              ))}
            </Pressable>
          ))}

          {session?.notable_quotes && session.notable_quotes.length > 0 ? (
            <>
              <Kicker style={{ color: colors.neutral600, marginTop: 8, marginBottom: 4 }}>Notable quotes</Kicker>
              {session.notable_quotes.map((quote, i) => (
                <Pressable
                  key={i}
                  style={styles.quote}
                  onLongPress={() => setShareContent({ kicker: 'Quote', title: 'Notable quote', body: quote })}
                  accessibilityRole="button"
                  accessibilityLabel={`Share quote: ${quote}`}
                >
                  <Text style={styles.quoteText}>&ldquo;{quote}&rdquo;</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          {entries.length > 0 ? (
            <>
              <Kicker style={{ color: colors.neutral600, marginTop: 8, marginBottom: 4 }}>
                Tasks &amp; ideas
              </Kicker>
              {entries.map((e) => {
                const topic = e.topicId ? topics.find((t) => t.id === e.topicId) : undefined;
                return (
                  <Pressable
                    key={`${e.kind}-${e.id}`}
                    style={styles.entry}
                    onLongPress={() => shareEntry(e)}
                    accessibilityRole="button"
                    accessibilityLabel={`Share ${e.kicker.toLowerCase()}: ${e.title}`}
                  >
                    <View style={styles.entryHead}>
                      <CardKicker>{e.kicker}</CardKicker>
                      {topic ? <Tag variant="neutral">{topicDisplayName(topic, topics)}</Tag> : null}
                    </View>
                    <Text style={styles.entryTitle}>{e.title}</Text>
                    {!topic && e.topicSuggestion ? (
                      <View style={styles.suggestRow}>
                        <Text style={styles.suggestText}>
                          AI thinks this belongs under &quot;{e.topicSuggestion}&quot;
                        </Text>
                        <View style={styles.suggestActions}>
                          <Button
                            label={busyEntryId === e.id ? 'Saving…' : `Use "${e.topicSuggestion}"`}
                            disabled={busyEntryId === e.id}
                            onPress={() => useSuggestion(e)}
                            style={[styles.suggestButton, { backgroundColor: colors.pastelGreen }]}
                            textStyle={styles.pastelSmallText}
                          />
                          <Button
                            label="Pick topic"
                            disabled={busyEntryId === e.id}
                            onPress={() => setPicking(e)}
                            style={[styles.suggestButton, { backgroundColor: colors.pastelLavender }]}
                            textStyle={styles.pastelSmallText}
                          />
                        </View>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </>
          ) : (session?.outline ?? []).length === 0 ? (
            <Text style={styles.footnote}>
              Nothing to file as a task or idea — tap Transcript to see the full recording.
            </Text>
          ) : null}
        </>
      ) : session?.raw_transcript ? (
        <Text style={styles.transcriptText}>{session.raw_transcript}</Text>
      ) : (
        <Text style={styles.footnote}>No speech was detected in this recording.</Text>
      )}

      <View style={styles.actions}>
        <Button
          label="Done"
          onPress={dismissToTabs}
          style={[styles.actionButton, { backgroundColor: colors.pastelGreen }]}
          textStyle={styles.pastelText}
        />
        <Button
          label="Keep talking"
          onPress={() => router.replace('/talk')}
          style={[styles.actionButton, { backgroundColor: colors.pastelLavender }]}
          textStyle={styles.pastelText}
        />
      </View>

      <BottomSheet visible={picking !== null} onClose={() => setPicking(null)} title="Pick a topic">
            {topics.length === 0 ? (
              <Text style={styles.footnote}>No topics yet.</Text>
            ) : (
              topics.map((t, i) => (
                <Button
                  key={t.id}
                  label={topicDisplayName(t, topics)}
                  align="flex-start"
                  onPress={() => onPickTopic(t.id)}
                  style={{
                    marginBottom: 8,
                    borderRadius: radius.pastel,
                    backgroundColor: PICKER_COLORS[i % PICKER_COLORS.length],
                  }}
                  textStyle={styles.pastelText}
                />
              ))
            )}
            <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setPicking(null)} />
      </BottomSheet>

      <ShareSheet content={shareContent} onClose={() => setShareContent(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: radius.pastel,
    padding: 16,
    backgroundColor: colors.pastelYellow,
    marginTop: 16,
    marginBottom: 14,
  },
  summaryText: {
    fontFamily: font.semibold,
    fontSize: 19,
    lineHeight: 26,
    color: colors.text,
    marginTop: 6,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(32,30,29,0.12)',
  },
  topicTags: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    minHeight: 40,
    borderRadius: radius.pastel,
  },
  processing: {
    backgroundColor: colors.pastelBlue,
    alignItems: 'flex-start',
    gap: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconDone: {
    backgroundColor: colors.accent700,
  },
  stepIconPending: {
    borderWidth: 2,
    borderColor: colors.neutral400,
  },
  stepLabel: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  stepLabelPending: {
    color: colors.neutral500,
  },
  entry: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  entryHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  entryTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  suggestRow: {
    marginTop: 8,
    backgroundColor: colors.pastelPeach,
    borderRadius: radius.pastel,
    padding: 10,
  },
  suggestText: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral800,
  },
  suggestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  suggestButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: radius.pastel,
  },
  pastelText: {
    color: colors.text,
  },
  pastelSmallText: {
    color: colors.text,
    fontSize: 12,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
  },
  outlineSection: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  outlineHeading: {
    fontFamily: font.extrabold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 6,
  },
  outlineBullet: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginBottom: 4,
  },
  bold: {
    fontFamily: font.semibold,
    color: colors.text,
  },
  quote: {
    paddingVertical: 8,
    paddingLeft: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  quoteText: {
    fontFamily: font.regular,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral800,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tabGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  shareTabButton: {
    minHeight: 40,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
  },
  tabOpt: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.pastel,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tabOptSelected: {
    borderColor: colors.accent800,
  },
  tabText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  tabTextSelected: {
    fontFamily: font.extrabold,
  },
  transcriptText: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral700,
    paddingVertical: 12,
  },
  // marginTop: 'auto' inside Screen's flexGrow:1 scroll content pins this
  // row to the bottom of the viewport when the content is short, and lets
  // it trail the content normally once there's enough to scroll.
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
    paddingTop: 24,
  },
  actionButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.pastel,
  },
});
