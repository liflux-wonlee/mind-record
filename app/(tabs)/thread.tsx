import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChevronLeftIcon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Button, CardKicker, RuleThick } from '@/components/ui';
import { colors, font, h2 } from '@/theme';

const STEPS = [
  { date: 'Jun 4', title: 'Initial idea', note: '서비스 계약을 subscription으로 만들자.' },
  { date: 'Jun 18', title: 'Pricing discussion', note: '조직 수 기준 vs 사용자 수 기준' },
  { date: 'Jul 12', title: 'Customer onboarding idea', note: '기존 데이터 이전 마법사와 연결' },
  { date: 'Aug 5', title: 'Billing model revised', note: '월 단위 청구, 연 결제 할인' },
  {
    date: 'Sep 11',
    title: 'Final direction',
    note: '서비스 계약 월 구독 모델로 확장',
    source: 'Source: Sep 11 conversation →',
    current: true,
  },
];

export default function ThreadScreen() {
  const router = useRouter();

  return (
    <Screen>
      <Button
        variant="ghost"
        label="JoaSuite"
        icon={<ChevronLeftIcon size={18} color={colors.accent} />}
        onPress={() => router.push('/topic')}
        style={styles.back}
        textStyle={{ fontSize: 12 }}
      />
      <CardKicker>Idea thread · Considering</CardKicker>
      <Text style={styles.title}>Subscription Service Idea</Text>

      <RuleThick />
      {STEPS.map((step) => (
        <View key={step.date} style={styles.step}>
          <Text style={[styles.date, step.current && { color: colors.accent }]}>{step.date}</Text>
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepNote}>{step.note}</Text>
            {step.source ? <Text style={styles.source}>{step.source}</Text> : null}
          </View>
        </View>
      ))}

      <View style={styles.actions}>
        <Button label="Plan it" style={{ minHeight: 44 }} />
        <Button variant="secondary" label="Ask how it changed" style={{ minHeight: 44 }} />
      </View>
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
    marginTop: 4,
    marginBottom: 14,
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  date: {
    width: 64,
    fontFamily: font.extrabold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral700,
  },
  stepBody: {
    flex: 1,
  },
  stepTitle: {
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  stepNote: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral700,
  },
  source: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    color: colors.accent,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
});
