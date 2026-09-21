import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { useRecentSessions } from '@/hooks/useRecentSessions';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile } from '@/services/profiles';
import { deleteSession, listSessionsForDay, type Session } from '@/services/sessions';
import { colors, font, h2, radius } from '@/theme';

const RECENT_LIMIT = 10;

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [menuSession, setMenuSession] = useState<Session | null>(null);
  const recentSessions = useRecentSessions(RECENT_LIMIT);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      getProfile(user.id)
        .then((profile) => {
          if (cancelled) return;
          const name = profile?.display_name?.trim().split(/\s+/)[0];
          setFirstName(name || null);
        })
        .catch(() => {
          // Greeting is a nice-to-have — leave it off rather than block the screen.
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      listSessionsForDay(user.id, new Date())
        .then((sessions) => {
          if (!cancelled) setTodayCount(sessions.length);
        })
        .catch(() => {
          // Leave the count hidden rather than crash the screen.
        });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  /** Talk itself asks Conversation-or-Capture before touching the mic --
   *  see app/talk.tsx's ModePicker. */
  const startTalk = () => {
    router.push('/talk');
  };

  const confirmDeleteSession = (session: Session) => {
    setMenuSession(null);
    Alert.alert(
      'Delete this recording?',
      `${session.title ?? session.mode} will be permanently deleted, including its audio. Tasks or ideas it already created are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteSession(session.id)
              .then(() => recentSessions.refresh())
              .catch((e) => Alert.alert('Could not delete', friendlyMessage(e, 'Please try again.'))),
        },
      ]
    );
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <Screen>
      <View style={styles.topRow}>
        <Kicker style={{ color: colors.neutral600 }}>{today}</Kicker>
      </View>

      <View style={styles.micBlock}>
        {firstName ? <Kicker style={{ color: colors.neutral600 }}>Hi, {firstName}</Kicker> : null}
        <Text style={styles.title}>What&apos;s on your mind?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tap to talk"
          onPress={startTalk}
          style={({ pressed }) => [styles.mic, { backgroundColor: pressed ? colors.accent700 : colors.accent }]}
        >
          <MicIcon size={56} color={colors.bg} />
        </Pressable>
        <Text style={styles.micLabel}>Tap to talk</Text>
      </View>

      {todayCount !== null && todayCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/journal')}
          style={({ pressed }) => [styles.todayRow, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.todayText}>
            {todayCount} {todayCount === 1 ? 'record' : 'records'} today →
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.recentSection}>
        <Text style={styles.sectionHeading}>Recent conversations</Text>
        <Pressable onPress={() => router.push('/calendar')} style={{ marginTop: 4 }}>
          <Text style={styles.footerLink}>
            Older recordings are in Records, by date. See all records →
          </Text>
        </Pressable>

        <RuleThick style={{ marginTop: 12, marginBottom: 4 }} />
        {recentSessions.status === 'loading' ? (
          <View style={styles.sessionsCenter}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : recentSessions.status === 'error' ? (
          <Text style={styles.sessionsEmpty}>Couldn&apos;t load recent sessions.</Text>
        ) : recentSessions.sessions.length === 0 ? (
          <Text style={styles.sessionsEmpty}>Nothing yet — tap the mic above to start your first session.</Text>
        ) : (
          <>
            {recentSessions.sessions.map((session, i) => (
              <Row
                key={session.id}
                onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
                onLongPress={() => setMenuSession(session)}
                style={[
                  styles.continueRow,
                  { backgroundColor: i % 2 === 0 ? colors.pastelYellow : colors.pastelBlue },
                ]}
              >
                <Text style={styles.continueTitle} numberOfLines={1}>
                  {session.title ?? session.mode}
                </Text>
                <Text style={styles.continueMeta}>
                  {new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </Text>
              </Row>
            ))}
            <Text style={styles.hint}>Hold a conversation for more options</Text>
          </>
        )}
      </View>

      <BottomSheet
        visible={menuSession !== null}
        onClose={() => setMenuSession(null)}
        title={menuSession?.title ?? menuSession?.mode ?? ''}
        titleLines={1}
      >
        <View style={{ gap: 10 }}>
          <Button
            label="Open"
            align="flex-start"
            variant="secondary"
            onPress={() => {
              if (!menuSession) return;
              const id = menuSession.id;
              setMenuSession(null);
              router.push({ pathname: '/summary', params: { sessionId: id } });
            }}
          />
          <Button
            label="Delete"
            align="flex-start"
            variant="secondary"
            textStyle={{ color: colors.accent700 }}
            onPress={() => menuSession && confirmDeleteSession(menuSession)}
          />
        </View>
        <Button label="Cancel" variant="ghost" align="flex-start" onPress={() => setMenuSession(null)} style={{ marginTop: 12 }} />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  micBlock: {
    marginTop: 16,
    alignItems: 'center',
    gap: 20,
  },
  title: {
    ...h2,
    textAlign: 'center',
  },
  mic: {
    width: 148,
    height: 148,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 11 * 0.08,
    textTransform: 'uppercase',
    color: colors.neutral600,
  },
  todayRow: {
    marginTop: 18,
    paddingVertical: 4,
  },
  todayText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.accent700,
  },
  recentSection: {
    marginTop: 24,
  },
  sectionHeading: {
    fontFamily: font.semibold,
    fontSize: 19,
    color: colors.text,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
    marginTop: 2,
    textAlign: 'center',
  },
  continueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: radius.pastel,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  continueTitle: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
  },
  continueMeta: {
    flexShrink: 0,
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral600,
  },
  sessionsCenter: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  sessionsEmpty: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral600,
    paddingVertical: 12,
  },
  footerLink: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral600,
  },
});
