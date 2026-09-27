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
 * scrolls, so a sheet taller than maxHeight keeps its last buttons reachable;
 * a form whose Save must stay visible above the keyboard passes it as
 * `footer`, which sits under the scrolling body instead of inside it.
 */
import React from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

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
  footer,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Pass 1 to ellipsize a long title on a single line. */
  titleLines?: number;
  maxHeight?: `${number}%`;
  backgroundColor?: string;
  /** Pinned below the scrolling body -- e.g. a form's Cancel/Save row. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/* Its own provider: a Modal is a separate window, and the insets it
          needs are that window's (on Android the app root's value didn't
          keep the last row clear of the navigation bar). */}
      <SafeAreaProvider>
        <SheetBody
          onClose={onClose}
          title={title}
          titleLines={titleLines}
          maxHeight={maxHeight}
          backgroundColor={backgroundColor}
          footer={footer}
        >
          {children}
        </SheetBody>
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetBody({
  onClose,
  title,
  titleLines,
  maxHeight,
  backgroundColor,
  footer,
  children,
}: {
  onClose: () => void;
  title: string;
  titleLines?: number;
  maxHeight: `${number}%`;
  backgroundColor: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // Never less than the navigation bar measured at app start, in case the
  // modal window reports no inset on some device.
  const bottomInset = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0);
  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      {/* The backdrop is a sibling behind the sheet, not its parent. It
          used to wrap the sheet, which then had to sit in a Pressable of its
          own to swallow taps -- so every drag in the sheet began as that
          Pressable's touch and had to be won back by the ScrollView. As a
          sibling, a touch on the sheet never reaches the backdrop at all. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { maxHeight, backgroundColor, paddingBottom: 24 + bottomInset }]}>
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
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
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
