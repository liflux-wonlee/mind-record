import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { colors, font, h2 } from '@/theme';

/** Back-to-Account + big title, shared by every Settings sub-page (AI,
 *  Privacy, Google Tasks). */
export function SettingsHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View>
      <Button
        variant="ghost"
        label="Account"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        // back(), not push: pushing /account from these root-stack pages
        // stacked a second copy of the tabs (and iOS swipe then led back here).
        onPress={() => (router.canGoBack() ? router.back() : router.navigate('/account'))}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <Text style={styles.title}>{title}</Text>
    </View>
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
    marginBottom: 16,
  },
});
