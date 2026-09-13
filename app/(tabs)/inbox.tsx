import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Button, CardKicker, Kicker, RuleThick, Tag } from '@/components/ui';
import { inboxItems } from '@/data';
import { useApp } from '@/store';
import { colors, font, h2 } from '@/theme';

export default function InboxScreen() {
  const { inboxResolved, resolveInbox } = useApp();

  return (
    <Screen>
      <Kicker style={{ color: colors.neutral600 }}>Inbox</Kicker>
      <Text style={styles.title}>Today</Text>

      <RuleThick />

      {inboxItems.map((item, i) => {
        const resolution = inboxResolved[i];
        const needsReview = item.review && !resolution;
        return (
          <View key={item.title} style={[styles.item, resolution ? { opacity: 0.55 } : null]}>
            <View style={styles.itemHead}>
              <CardKicker>{resolution ? `${item.type} · ${resolution}` : item.type}</CardKicker>
              <Tag variant="neutral">{item.topic}</Tag>
            </View>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {needsReview ? (
              <>
                <Text style={styles.note}>{item.note}</Text>
                <View style={styles.actions}>
                  <Button
                    label={item.aLabel}
                    onPress={() => resolveInbox(i, item.aLabel!)}
                    style={{ minHeight: 40 }}
                  />
                  <Button
                    variant="secondary"
                    label={item.bLabel}
                    onPress={() => resolveInbox(i, item.bLabel!)}
                    style={{ minHeight: 40 }}
                  />
                </View>
              </>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.footnote}>
        AI already filed the rest. Your choices here train future classification.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    ...h2,
    marginTop: 6,
    marginBottom: 14,
  },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  itemHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    fontFamily: font.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    marginTop: 4,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 4,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  footnote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
    marginTop: 12,
  },
});
