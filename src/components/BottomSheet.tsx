/**
 * The app's one bottom-sheet modal: dimmed backdrop (tap to close), a
 * sheet pinned to the bottom edge, and a title. Every long-press menu,
 * picker and edit form uses this rather than its own Modal so the
 * edge-to-edge handling lives in one place: the dialog window is asked to
 * extend under both system bars (Android renders it that way regardless
 * on 15+), and the sheet pads its bottom by the navigation-bar inset so the
 * last row is never drawn underneath the gesture/3-button bar.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font } from '@/theme';

export function BottomSheet({
  visible,
  onClose,
  title,
  titleLines,
  maxHeight = '80%',
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Pass 1 to ellipsize a long title on a single line. */
  titleLines?: number;
  maxHeight?: `${number}%`;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { maxHeight, paddingBottom: 24 + insets.bottom }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.title} numberOfLines={titleLines}>
            {title}
          </Text>
          <View>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(32,30,29,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    padding: 20,
    borderTopWidth: 2,
    borderTopColor: colors.divider,
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 18,
    color: colors.text,
    marginBottom: 14,
  },
});
