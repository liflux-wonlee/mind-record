/**
 * First-run intro: what the app does, the two ways to talk to it, and the
 * microphone permission -- asked here with context rather than as a bare
 * system prompt the first time the mic button is tapped. Shown once per
 * install (src/lib/onboarding.ts); Account has a "Show the intro again".
 */
import { requestRecordingPermissionsAsync } from 'expo-audio';
import React, { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, Kicker } from '@/components/ui';
import { markOnboardingDone } from '@/lib/onboarding';
import { colors, font, radius } from '@/theme';

const PAGES = [
  {
    kicker: 'Mind Record',
    title: 'Just talk. It gets organized.',
    body: 'Say whatever is on your mind — in any language. Mind Record writes it down, sums it up, and pulls out the tasks and ideas so you don’t have to.',
    color: colors.pastelYellow,
  },
  {
    kicker: 'Two ways to talk',
    title: 'Capture, or have a conversation.',
    body: 'Capture is one long recording — pause and resume as you like, tap Done when you’re finished.\n\nConversation is back and forth: pause, and the AI answers. It keeps listening on its own until you say “save and end”.',
    color: colors.pastelBlue,
  },
  {
    kicker: 'One thing to allow',
    title: 'The microphone.',
    body:
      'That’s the whole app. Recordings are turned into text and then deleted — only the text is kept.' +
      (Platform.OS === 'android'
        ? '\n\nOn Android you’ll also be asked to allow a small “Recording” notification, so it can keep listening with the screen off.'
        : ''),
    color: colors.pastelGreen,
  },
];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const last = page === PAGES.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const next = () => scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await requestRecordingPermissionsAsync();
    } catch {
      // The Talk screen asks again when it matters.
    }
    // Flipping the flag removes this screen from the navigator and
    // app/_layout.tsx's guards redirect into the tabs -- no navigation
    // call needed (and none would resolve: the tabs don't exist yet at
    // this point).
    await markOnboardingDone();
  };

  return (
    <Screen scroll={false} padded={false} safeBottom showAccount={false}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={styles.pager}
      >
        {PAGES.map((p) => (
          <View key={p.kicker} style={[styles.page, { width }]}>
            <View style={[styles.card, { backgroundColor: p.color }]}>
              <Kicker style={{ color: colors.neutral700 }}>{p.kicker}</Kicker>
              <Text style={styles.title}>{p.title}</Text>
              <Text style={styles.body}>{p.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {PAGES.map((p, i) => (
            <View key={p.kicker} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>
        {last ? (
          <Button
            label={finishing ? 'Just a moment…' : 'Allow microphone & start'}
            disabled={finishing}
            onPress={finish}
            style={[styles.cta, { backgroundColor: colors.pastelGreen }]}
            textStyle={styles.ctaText}
          />
        ) : (
          <View style={styles.row}>
            <Button
              variant="ghost"
              label="Skip"
              onPress={finish}
              style={{ minHeight: 52, paddingHorizontal: 12 }}
            />
            <Button
              label="Next"
              onPress={next}
              style={[styles.cta, { flex: 1, backgroundColor: colors.pastelBlue }]}
              textStyle={styles.ctaText}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: radius.pastel,
    padding: 24,
    gap: 12,
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.neutral800,
  },
  footer: {
    paddingHorizontal: 20,
    gap: 16,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  dotActive: {
    backgroundColor: colors.accent800,
    width: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  cta: {
    minHeight: 52,
    borderRadius: radius.pastel,
    justifyContent: 'center',
  },
  ctaText: {
    color: colors.text,
    fontSize: 16,
  },
});
