/**
 * Type a note -- Home's "Type instead", for when talking out loud isn't an
 * option (a meeting, a quiet room, a noisy street). What the user types is
 * saved as a normal record (a `sessions` row, mode 'note') and handed to the
 * same process-session analysis a voice capture gets -- title, summary,
 * outline, tasks, ideas and topics -- then Summary takes over exactly as it
 * does after Talk.
 *
 * The unsaved text is kept as a draft in AsyncStorage so an app kill or a
 * crash doesn't lose it, and leaving with text still in the box (Cancel,
 * Android back, iOS swipe) asks first.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { friendlyMessage } from '@/lib/friendlyError';
import { dismissToTabs } from '@/nav';
import { useAuth } from '@/providers/AuthProvider';
import { processSession } from '@/services/processing';
import { createNoteSession } from '@/services/sessions';
import { colors, font, h2, radius } from '@/theme';

// Per user, so a shared phone never shows one account's draft to another.
const draftKey = (userId: string) => `note-draft:${userId}`;
// Coalesces keystrokes into one write -- a draft a moment behind is fine.
const DRAFT_SAVE_DELAY_MS = 400;
// Matches process-session's NOTE_MAX_CHARS -- one analysis call has to take
// the whole note, so an unbounded paste would fail (and re-bill) every retry.
const NOTE_MAX_CHARS = 20000;

export default function NoteScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // Set once the row exists: the guard below turns off, and the effect
  // after it navigates on to Summary (a replace removes this screen, which
  // the guard would otherwise stop).
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The write the timer above is waiting to run, so leaving mid-delay can
  // still flush it (emptying the box then leaving at once must clear it).
  const pendingDraftWriteRef = useRef<(() => void) | null>(null);

  const hasText = text.trim().length > 0;

  // Restore a draft left behind by an app kill -- unless the user already
  // started typing before storage answered.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    AsyncStorage.getItem(draftKey(userId))
      .then((draft) => {
        if (cancelled || !draft) return;
        setText((current) => (current ? current : draft));
      })
      .catch(() => {
        // No draft to restore is the same as an empty one.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(
    () => () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      pendingDraftWriteRef.current?.();
      pendingDraftWriteRef.current = null;
    },
    []
  );

  const onChangeText = (next: string) => {
    setText(next);
    if (!userId || savingRef.current) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const write = () => {
      pendingDraftWriteRef.current = null;
      draftTimerRef.current = null;
      const done = next.trim()
        ? AsyncStorage.setItem(draftKey(userId), next)
        : AsyncStorage.removeItem(draftKey(userId));
      done.catch(() => {
        // Best-effort: the text is still on screen.
      });
    };
    pendingDraftWriteRef.current = write;
    draftTimerRef.current = setTimeout(write, DRAFT_SAVE_DELAY_MS);
  };

  const clearDraft = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    pendingDraftWriteRef.current = null;
    if (userId) AsyncStorage.removeItem(draftKey(userId)).catch(() => {});
  };

  // Covers every way out -- Cancel, Android back, iOS swipe-back -- while
  // there is unsaved text. Nothing to lose, nothing to ask.
  usePreventRemove((hasText || saving) && !savedSessionId, ({ data }) => {
    // Mid-save: the note is about to exist; stay for Summary.
    if (savingRef.current) return;
    Alert.alert('Discard this note?', 'What you typed will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          clearDraft();
          navigation.dispatch(data.action);
        },
      },
    ]);
  });

  useEffect(() => {
    if (!savedSessionId) return;
    router.replace({ pathname: '/summary', params: { sessionId: savedSessionId } });
  }, [savedSessionId, router]);

  const cancel = () => {
    if (router.canGoBack()) router.back();
    else dismissToTabs();
  };

  const save = async () => {
    const body = text.trim();
    if (!body || !user || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let sessionId: string;
    try {
      sessionId = (await createNoteSession(user.id, body)).id;
    } catch (e) {
      // The text (and its draft) stay put so nothing typed is lost.
      savingRef.current = false;
      setSaving(false);
      Alert.alert('Could not save your note', friendlyMessage(e, 'Please try again.'));
      return;
    }
    clearDraft();
    // Not awaited, same as after a capture: Summary polls
    // processing_status itself and offers Retry if this fails.
    processSession(sessionId).catch((e) => {
      const message = friendlyMessage(e, 'Please try again.');
      Alert.alert(
        'Could not process this note',
        // An out-of-date process-session calls a note "No audio".
        /no audio/i.test(message) ? 'The server needs an update before notes can be processed. Try again later.' : message
      );
    });
    setSavedSessionId(sessionId);
  };

  return (
    <Screen scroll={false} safeBottom showAccount={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // Screen pads its top by the safe-area inset, which the keyboard
        // overlap calculation doesn't see: KAV measures itself relative to
        // its parent but the keyboard in window coordinates. Android needs
        // it too -- edge-to-edge doesn't resize the window for the keyboard.
        keyboardVerticalOffset={insets.top}
        style={styles.flex}
      >
        <Text style={styles.title}>Type a note</Text>
        <Text style={styles.subtitle}>
          Write it the way you&apos;d say it — it&apos;s summarized and sorted into tasks, ideas and topics just
          like a recording.
        </Text>

        <TextInput
          value={text}
          onChangeText={onChangeText}
          autoFocus
          multiline
          editable={!saving}
          placeholder="What's on your mind?"
          placeholderTextColor={colors.neutral600}
          textAlignVertical="top"
          scrollEnabled
          maxLength={NOTE_MAX_CHARS}
          accessibilityLabel="Note"
          style={styles.input}
        />
        {text.length > NOTE_MAX_CHARS * 0.9 ? (
          <Text style={styles.counter}>
            {text.length.toLocaleString()} / {NOTE_MAX_CHARS.toLocaleString()}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button label="Cancel" variant="ghost" onPress={cancel} disabled={saving} style={styles.cancelButton} />
          <Button
            label={saving ? 'Saving…' : 'Save'}
            variant="save"
            onPress={save}
            disabled={!hasText || saving}
            style={styles.saveButton}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  title: {
    ...h2,
    marginTop: 8,
  },
  subtitle: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral600,
    marginTop: 6,
  },
  input: {
    flex: 1,
    marginTop: 16,
    padding: 16,
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.text,
  },
  counter: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral600,
    textAlign: 'right',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  cancelButton: {
    minWidth: 96,
  },
  saveButton: {
    flex: 1,
  },
});
