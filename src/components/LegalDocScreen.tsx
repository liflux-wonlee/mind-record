import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { EFFECTIVE_DATE, type LegalDoc } from '@/content/legal';
import { colors, font, h2 } from '@/theme';

/**
 * Shared renderer for app/legal/privacy-policy.tsx and terms-of-service.tsx.
 * Reachable from the signed-out Login screen and from signed-in Account/
 * Settings, so a plain `router.back()` isn't safe: tapping the link from
 * Login right as sign-in actually completes flips `Stack.Protected`'s
 * `!signedIn` guard off mid-navigation, which drops `login` from the
 * navigator and can leave this screen with no real history to pop to --
 * `router.back()` then does nothing (and Android's hardware back doesn't
 * either, since it goes through the same navigation state). `canGoBack()`
 * plus a `replace('/')` fallback (same pattern as app/journal.tsx's
 * back button) always lands somewhere sane: `/` re-resolves through the
 * guards to whichever of Login/Home is actually correct right now.
 */
function goBackSafely(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function LegalDocScreen({ doc }: { doc: LegalDoc }) {
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackSafely(router);
        return true;
      });
      return () => sub.remove();
    }, [router])
  );

  return (
    <Screen showAccount={false}>
      <Button
        variant="ghost"
        label="Back"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => goBackSafely(router)}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <Text style={styles.title}>{doc.title}</Text>
      <Text style={styles.effectiveDate}>Effective {EFFECTIVE_DATE}</Text>
      {doc.sections.map((section) => (
        <View key={section.heading} style={styles.section}>
          <Text style={styles.heading}>{section.heading}</Text>
          {section.paragraphs.map((paragraph, i) => (
            <Text key={i} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingLeft: 0,
    marginLeft: -4,
  },
  title: {
    ...h2,
    marginTop: 2,
  },
  effectiveDate: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral600,
    marginTop: 4,
    marginBottom: 18,
  },
  section: {
    marginBottom: 20,
  },
  heading: {
    fontFamily: font.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 6,
  },
  paragraph: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 8,
  },
});
