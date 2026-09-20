import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui';
import { EFFECTIVE_DATE, type LegalDoc } from '@/content/legal';
import { colors, font, h2 } from '@/theme';

/** Shared renderer for app/legal/privacy-policy.tsx and terms-of-service.tsx.
 *  `router.back()` (not a fixed destination) since this is reachable both
 *  from the signed-out Login screen and from signed-in Account/Settings. */
export function LegalDocScreen({ doc }: { doc: LegalDoc }) {
  const router = useRouter();
  return (
    <Screen showAccount={false}>
      <Button
        variant="ghost"
        label="Back"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => router.back()}
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
