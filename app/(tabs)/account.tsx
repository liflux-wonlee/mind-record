import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChevronRightIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, Kicker, Row, RuleThick } from '@/components/ui';
import { prefGroups } from '@/data';
import { useApp } from '@/store';
import { colors, font, radius } from '@/theme';

const USAGE = [
  { value: '312', label: 'Entries', background: colors.pastelYellow },
  { value: '48', label: 'Days', background: colors.pastelGreen },
  { value: '9', label: 'Topics', background: colors.pastelLavender },
];

export default function AccountScreen() {
  const router = useRouter();
  const { prefs, togglePref } = useApp();

  return (
    <Screen>
      <Kicker style={{ color: colors.neutral600 }}>Account</Kicker>

      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>WL</Text>
        </View>
        <View>
          <Text style={styles.name}>Won Lee</Text>
          <Text style={styles.email}>won@liflux.com · Pro plan</Text>
        </View>
      </View>

      <View style={styles.usage}>
        {USAGE.map((stat) => (
          <View key={stat.label} style={[styles.usageCard, { backgroundColor: stat.background }]}>
            <Text style={styles.usageValue}>{stat.value}</Text>
            <Kicker style={{ color: colors.neutral700, marginTop: 6 }}>{stat.label}</Kicker>
          </View>
        ))}
      </View>

      {prefGroups.map((group) => (
        <View key={group.name}>
          <Kicker style={{ color: colors.neutral600, marginTop: 18 }}>{group.name}</Kicker>
          <RuleThick style={{ marginTop: 6 }} />
          {group.rows.map((row) => {
            const on = row.kind === 'toggle' ? (prefs[row.key] ?? row.default) : false;
            return (
              <Row
                key={row.label}
                onPress={
                  row.kind === 'toggle' ? () => togglePref(row.key, on) : () => undefined
                }
                style={styles.prefRow}
              >
                <View style={styles.prefLabels}>
                  <Text style={styles.prefLabel}>{row.label}</Text>
                  <Text style={styles.prefSub}>{row.sub}</Text>
                </View>
                {row.kind === 'toggle' ? (
                  <View
                    style={[
                      styles.track,
                      { backgroundColor: on ? colors.accent : colors.neutral300 },
                    ]}
                  >
                    <View style={[styles.knob, { left: on ? 21 : 3 }]} />
                  </View>
                ) : (
                  <View style={styles.prefValue}>
                    <Text style={styles.prefValueText}>{row.value}</Text>
                    <ChevronRightIcon size={16} color={colors.neutral700} />
                  </View>
                )}
              </Row>
            );
          })}
        </View>
      ))}

      <Button
        variant="secondary"
        label="Sign out"
        align="flex-start"
        onPress={() => router.replace('/login')}
        style={styles.signOut}
      />
      <Button
        variant="ghost"
        label="Delete all my data"
        align="flex-start"
        style={styles.deleteData}
        textStyle={{ color: colors.accent700 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.pastelPink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: font.extrabold,
    fontSize: 20,
    color: colors.accent800,
  },
  name: {
    fontFamily: font.extrabold,
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
  },
  email: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
  },
  usage: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  usageCard: {
    flex: 1,
    borderRadius: radius.pastel,
    padding: 12,
  },
  usageValue: {
    fontFamily: font.extrabold,
    fontSize: 22,
    lineHeight: 22,
    color: colors.text,
  },
  prefRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  prefLabels: {
    flex: 1,
    minWidth: 0,
  },
  prefLabel: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  prefSub: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral700,
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: 13,
  },
  knob: {
    position: 'absolute',
    top: 3,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  prefValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  prefValueText: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.neutral700,
  },
  signOut: {
    minHeight: 48,
    marginTop: 20,
    paddingHorizontal: 16,
  },
  deleteData: {
    minHeight: 44,
    marginTop: 4,
  },
});
