/**
 * The "Listen" briefing's controls and text, shared by Home's reminders
 * card and the Reminders screen. The text is always shown -- while the
 * voice plays (so it can be followed/skimmed) and on its own when there's
 * no audio. "Reply by voice" opens the regular voice conversation; the
 * microphone is never turned on from here.
 */
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PauseIcon, PlayIcon, StopIcon } from '@/components/Icon';
import { Button } from '@/components/ui';
import type { useBriefing } from '@/hooks/useBriefing';
import { colors, font, radius } from '@/theme';

type BriefingControls = ReturnType<typeof useBriefing>;

export function BriefingPanel({ briefing }: { briefing: BriefingControls }) {
  const router = useRouter();
  const { state, briefing: data, error } = briefing;
  if (state === 'idle') return null;

  const playing = state === 'playing' || state === 'paused';
  const noAudio = data !== null && !data.audioBase64;

  return (
    <View style={styles.panel}>
      {state === 'loading' ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accent700} />
          <Text style={styles.status}>Getting today’s reminders ready…</Text>
          <View style={{ flex: 1 }} />
          <Button label="Cancel" variant="ghost" onPress={briefing.reset} />
        </View>
      ) : state === 'error' ? (
        <>
          <Text style={styles.status}>{error ?? 'Could not prepare the briefing.'}</Text>
          <Text style={styles.hint}>The list is still here to read.</Text>
          <View style={styles.row}>
            <Button label="Try again" variant="secondary" onPress={briefing.start} style={styles.pill} />
            <Button label="Close" variant="ghost" onPress={briefing.reset} />
          </View>
        </>
      ) : (
        <>
          {playing ? (
            <View style={styles.row}>
              <Text style={[styles.status, { flex: 1 }]}>{state === 'paused' ? 'Paused' : 'Playing…'}</Text>
              {state === 'playing' ? (
                <Button
                  accessibilityLabel="Pause"
                  icon={<PauseIcon size={18} color={colors.text} />}
                  label="Pause"
                  variant="secondary"
                  onPress={briefing.pause}
                  style={styles.pill}
                />
              ) : (
                <Button
                  accessibilityLabel="Resume"
                  icon={<PlayIcon size={18} color={colors.text} />}
                  label="Resume"
                  variant="secondary"
                  onPress={briefing.resume}
                  style={styles.pill}
                />
              )}
              <Button
                accessibilityLabel="Stop"
                icon={<StopIcon size={16} color={colors.text} />}
                label="Stop"
                variant="secondary"
                onPress={briefing.stop}
                style={styles.pill}
              />
            </View>
          ) : noAudio ? (
            <Text style={styles.hint}>Voice isn’t available right now — here it is as text.</Text>
          ) : null}

          {data ? (
            data.items.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                {data.items.map((item) => (
                  <Text key={`${item.targetType}:${item.targetId}`} style={styles.line}>
                    {item.index}. {item.line || item.title}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={styles.line}>{data.script}</Text>
            )
          ) : null}

          {!playing ? (
            <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}>
              <Button
                label="Reply by voice"
                variant="save"
                onPress={() => {
                  briefing.stop();
                  router.push({ pathname: '/talk', params: { mode: 'conv' } });
                }}
                style={styles.pill}
              />
              {data?.audioBase64 ? (
                <Button label="Play again" variant="secondary" onPress={briefing.start} style={styles.pill} />
              ) : null}
              <Button label="Close" variant="ghost" onPress={briefing.reset} />
            </View>
          ) : null}
          {!playing ? (
            <Text style={styles.hint}>
              Say things like “the second one is done” or “remind me about the first one tomorrow”.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.pastel,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  status: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral700,
    marginTop: 6,
  },
  line: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.text,
    marginTop: 4,
  },
  pill: {
    borderRadius: radius.pastel,
    paddingHorizontal: 12,
  },
});
