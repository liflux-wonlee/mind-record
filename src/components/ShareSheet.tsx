/**
 * The one shared "copy or share this" sheet -- Records, Summary, Outline
 * sections/bullets, Tasks, Ideas, and Topics all open this with exactly the
 * text they mean to share, so the user always sees precisely what would go
 * out before confirming (never a silently-included full transcript when
 * only one bullet was meant). See src/lib/share.ts for the native share
 * sheet itself.
 */
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, Kicker } from '@/components/ui';
import { shareText } from '@/lib/share';
import { colors, font, radius } from '@/theme';

export type ShareContent = {
  /** A short label for what kind of thing this is ("Recording", "Task", "Topic", ...). */
  kicker: string;
  /** Sheet title -- the item's own title/name. */
  title: string;
  /** The exact text that will be copied/shared -- shown in full below. */
  body: string;
};

export function ShareSheet({ content, onClose }: { content: ShareContent | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!content) return;
    await Clipboard.setStringAsync(content.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const share = async () => {
    if (!content) return;
    await shareText(content.body, { title: content.title });
    onClose();
  };

  return (
    <BottomSheet visible={content !== null} onClose={onClose} title={content?.title ?? ''} titleLines={2}>
      {content ? (
        <>
          <Kicker style={{ color: colors.neutral600, marginBottom: 8 }}>{content.kicker}</Kicker>
          <ScrollView style={styles.preview} nestedScrollEnabled>
            <Text style={styles.previewText}>{content.body}</Text>
          </ScrollView>
          <Button
            label={copied ? 'Copied' : 'Copy'}
            onPress={copy}
            style={[styles.button, { backgroundColor: colors.pastelLavender }]}
            textStyle={{ color: colors.text }}
          />
          <Button
            label="Share…"
            onPress={share}
            style={[styles.button, { backgroundColor: colors.pastelGreen, marginTop: 8 }]}
            textStyle={{ color: colors.text }}
          />
          <Button
            label="Cancel"
            variant="ghost"
            align="flex-start"
            onPress={onClose}
            style={{ marginTop: 8 }}
          />
        </>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    maxHeight: 180,
    backgroundColor: colors.surface,
    borderRadius: radius.pastel,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: 12,
    marginBottom: 14,
  },
  previewText: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  button: {
    minHeight: 46,
    borderRadius: radius.pastel,
  },
});
