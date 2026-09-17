import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AccountIcon, MicIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { useRecentSessions } from '@/hooks/useRecentSessions';
import { useAuth } from '@/providers/AuthProvider';
import { getProfile } from '@/services/profiles';
import { deleteSession, listSessionsForDay, type Session } from '@/services/sessions';
import { colors, font, h2 } from '@/theme';

const RECENT_LIMIT_KEY = 'mindrecord.home.recentLimit';
const RECENT_LIMIT_OPTIONS = [5, 10, 20] as const;

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [aiName, setAiName] = useState<string | null>(null);
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [recentLimit, setRecentLimit] = useState<number>(5);
  const [menuSession, setMenuSession] = useState<Session | null>(null);
  const recentSessions = useRecentSessions(recentLimit);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_LIMIT_KEY).then((value) => {
      const n = value ? parseInt(value, 10) : NaN;
      if ((RECENT_LIMIT_OPTIONS as readonly number[]).includes(n)) setRecentLimit(n);
    });
  }, []);

  const chooseRecentLimit = (n: number) => {
    setRecentLimit(n);
    AsyncStorage.setItem(RECENT_LIMIT_KEY, String(n)).catch(() => {
      // Not critical -- worst case the choice doesn't survive a restart.
    });
  };

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      getProfile(user.id)
        .then((profile) => {
          if (cancelled) return;
          const name = profile?.display_name?.trim().split(/\s+/)[0];
          setFirstName(name || null);
          setAiName(profile?.ai_name?.trim() || null);
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

  const startTalk = () => {
    router.push({ pathname: '/talk', params: { autoStart: '1' } });
  };

  /** Capture mode is the one-tap default above -- this is the only way to
   *  land on Talk with Conversation mode already selected, since auto-
   *  starting Capture (see app/talk.tsx) locks the mode toggle almost
   *  immediately after landing there. */
  const startConversation = () => {
    router.push({ pathname: '/talk', params: { mode: 'conv' } });
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
              .catch((e) => Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.')),
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          onPress={() => router.push('/account')}
          style={({ pressed }) => [styles.profileButton, pressed && { opacity: 0.6 }]}
        >
          <AccountIcon size={22} color={colors.text} />
        </Pressable>
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
        <Button
          variant="ghost"
          label={aiName ? `Or talk with ${aiName} instead` : 'Or start a conversation instead'}
          onPress={startConversation}
          style={{ minHeight: 36 }}
          textStyle={{ fontSize: 12 }}
        />
      </View>

      {todayCount !== null && todayCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/journal')}
          style={({ pressed }) => [styles.todayRow, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.todayText}>
            오늘 기록 {todayCount}개 →
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.sectionHead}>
        <Kicker style={{ color: colors.neutral600 }}>Recent conversations</Kicker>
        <View style={styles.limitSeg}>
          {RECENT_LIMIT_OPTIONS.map((n, i) => (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ selected: recentLimit === n }}
              onPress={() => chooseRecentLimit(n)}
              style={[
                styles.limitOpt,
                i > 0 && styles.limitDivider,
                recentLimit === n && { backgroundColor: colors.accent },
              ]}
            >
              <Text style={[styles.limitText, recentLimit === n && { color: colors.bg }]}>{n}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <RuleThick />
      {recentSessions.status === 'loading' ? (
        <View style={styles.sessionsCenter}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : recentSessions.status === 'error' ? (
        <Text style={styles.sessionsEmpty}>Couldn&apos;t load recent sessions.</Text>
      ) : recentSessions.sessions.length === 0 ? (
        <Text style={styles.sessionsEmpty}>Nothing yet — tap the mic above to start your first session.</Text>
      ) : (
        recentSessions.sessions.map((session) => (
          <Row
            key={session.id}
            onPress={() => router.push({ pathname: '/summary', params: { sessionId: session.id } })}
            onLongPress={() => setMenuSession(session)}
            style={styles.continueRow}
          >
            <Text style={styles.continueTitle} numberOfLines={1}>
              {session.title ?? session.mode}
            </Text>
            <Text style={styles.continueMeta}>
              {new Date(session.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          </Row>
        ))
      )}

      <Pressable onPress={() => router.push('/calendar')} style={{ marginTop: 4, paddingVertical: 10 }}>
        <Text style={styles.footerLink}>
          이전 기록은 기록 메뉴에서 날짜별로 확인할 수 있습니다. 전체 기록 보기 →
        </Text>
      </Pressable>

      <Modal
        visible={menuSession !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuSession(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuSession(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {menuSession?.title ?? menuSession?.mode}
            </Text>
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
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
  },
  limitSeg: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
  },
  limitOpt: {
    minHeight: 28,
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  limitDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.divider,
  },
  limitText: {
    fontFamily: font.semibold,
    fontSize: 11,
    color: colors.text,
  },
  continueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(32,30,29,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 2,
    borderTopColor: colors.divider,
    maxHeight: '80%',
  },
  sheetTitle: {
    fontFamily: font.extrabold,
    fontSize: 16,
    color: colors.text,
    marginBottom: 14,
  },
});
