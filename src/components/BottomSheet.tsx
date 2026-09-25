/**
 * The app's one bottom-sheet modal: dimmed backdrop (tap to close), a
 * sheet pinned to the bottom edge, and a title. Every long-press menu,
 * picker and edit form uses this rather than its own Modal so the
 * edge-to-edge handling lives in one place: the dialog window is asked to
 * extend under both system bars (Android renders it that way regardless
 * on 15+), and the sheet pads its bottom by the navigation-bar inset so the
 * last row is never drawn underneath the gesture/3-button bar.
 *
 * A Modal never gets resized by the keyboard (iOS never does; Android's
 * adjustResize is defeated by statusBarTranslucent), so the sheet sits in
 * a KeyboardAvoidingView -- without it the text inputs in the rename /
 * new-topic / task-edit sheets were hidden behind the keyboard. The body
 * scrolls, so a sheet taller than maxHeight keeps its last buttons reachable.
 */
import React from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font } from '@/theme';

export function BottomSheet({
  visible,
  onClose,
  title,
  titleLines,
  maxHeight = '80%',
  /** Override the sheet's own background -- e.g. a pale grey for an item
   *  action menu, distinct from the app's default cream. */
  backgroundColor = colors.bg,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Pass 1 to ellipsize a long title on a single line. */
  titleLines?: number;
  maxHeight?: `${number}%`;
  backgroundColor?: string;
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
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { maxHeight, backgroundColor, paddingBottom: 24 + insets.bottom }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.title} numberOfLines={titleLines}>
              {title}
            </Text>
            {/* Scrolls when the content is taller than maxHeight (e.g. Edit task
                on a small screen) -- otherwise the overflow was drawn past the
                sheet's bottom padding, under the navigation bar. */}
            <ScrollView
              style={styles.body}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 18,
    color: colors.text,
    marginBottom: 14,
  },
});
