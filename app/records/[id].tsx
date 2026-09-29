/**
 * Web: one recording, read-only -- title, date, summary, outline, quotes
 * and transcript exactly as saved (see docs/WEB_PREPARATION.md). Viewing
 * never re-runs transcription/analysis or touches usage: it's a single
 * `sessions` select under RLS, so another user's id (or a deleted one)
 * just comes back empty and shows "not found". No audio is downloaded.
 * Only reachable in the web build (the root navigator keeps it out of the
 * mobile app, whose Summary screen is the editable version of this).
 */
import { Link, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
import { getSession, type Session } from '@/services/sessions';
import { colors, font, h2, radius } from '@/theme';
import { formatRecordDate, modeLabel, statusLabel } from '@/web/recordFormat';
import { WebPage } from '@/web/WebPage';

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'missing' } | { kind: 'ok'; session: Session };

export default function RecordDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const requestRef = useRef(0);

  const fetchRecord = useCallback(async () => {
    const request = ++requestRef.current;
    if (!id) {
      setLoad({ kind: 'missing' });
      return;
    }
    setLoad({ kind: 'loading' });
    try {
      const session = await getSession(id);
      if (request !== requestRef.current) return;
      setLoad(session ? { kind: 'ok', session } : { kind: 'missing' });
    } catch (e) {
      if (request !== requestRef.current) return;
      // A malformed id is a "no such record", not a connection problem.
      if ((e as { code?: string } | null)?.code === '22P02') setLoad({ kind: 'missing' });
      else setLoad({ kind: 'error', message: friendlyMessage(e, 'Could not load this recording.') });
    }
  }, [id]);

  useEffect(() => {
    fetchRecord();
    return () => {
      requestRef.current++;
    };
  }, [fetchRecord]);

  return (
    <WebPage>
      <Link href="/records" style={styles.back}>
        ‹ All records
      </Link>

      {load.kind === 'loading' ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : load.kind === 'error' ? (
        <View style={styles.stateBox}>
          <Text style={styles.body}>{load.message}</Text>
          <Button variant="save" label="Try again" onPress={fetchRecord} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : load.kind === 'missing' ? (
        <View style={styles.stateBox}>
          <Text style={styles.body}>This recording doesn&apos;t exist or isn&apos;t available to this account.</Text>
        </View>
      ) : (
        <RecordBody session={load.session} />
      )}
    </WebPage>
  );
}

function RecordBody({ session }: { session: Session }) {
  const status = statusLabel(session.processing_status);
  const outline = session.outline ?? [];
  const quotes = session.notable_quotes ?? [];
  return (
    <View>
      <Text style={styles.meta}>
        {formatRecordDate(session.started_at)} · {modeLabel(session.mode)}
      </Text>
      <Text style={styles.title}>{session.title ?? 'Untitled recording'}</Text>
      {status ? (
        <Text style={styles.status}>
          {status}
          {session.processing_status === 'error' ? ' -- retry it from the JoaAssistant app.' : ''}
        </Text>
      ) : null}

      {session.summary ? (
        <Section title="Summary" color={colors.pastelPeach}>
          <Text style={styles.body}>{session.summary}</Text>
        </Section>
      ) : null}

      {outline.length > 0 ? (
        <Section title="Outline" color={colors.pastelBlue}>
          {outline.map((section, i) => (
            <View key={i} style={i > 0 ? { marginTop: 12 } : undefined}>
              <Text style={styles.heading}>{section.heading}</Text>
              {section.bullets.map((bullet, j) => (
                <Text key={j} style={styles.bullet}>
                  • {bullet}
                </Text>
              ))}
            </View>
          ))}
        </Section>
      ) : null}

      {quotes.length > 0 ? (
        <Section title="Quotes" color={colors.pastelLavender}>
          {quotes.map((quote, i) => (
            <Text key={i} style={[styles.body, i > 0 && { marginTop: 8 }]}>
              “{quote}”
            </Text>
          ))}
        </Section>
      ) : null}

      <Section title="Transcript" color={colors.surface}>
        <Text style={styles.body} selectable>
          {session.raw_transcript?.trim() || 'No transcript saved for this recording.'}
        </Text>
      </Section>
    </View>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <View style={[styles.section, { backgroundColor: color }]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.accent700,
    marginBottom: 16,
  },
  stateBox: {
    gap: 12,
    padding: 16,
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
  },
  meta: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.neutral700,
  },
  title: {
    ...h2,
    marginTop: 4,
  },
  status: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.accent700,
    marginTop: 6,
  },
  section: {
    marginTop: 16,
    padding: 16,
    borderRadius: radius.pastel,
  },
  sectionTitle: {
    fontFamily: font.extrabold,
    fontSize: 12,
    letterSpacing: 12 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral700,
    marginBottom: 8,
  },
  heading: {
    fontFamily: font.extrabold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  bullet: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginTop: 2,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.text,
  },
});
