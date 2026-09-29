/**
 * Reminder settings: this phone's notification permission, the default
 * reminder time, day-before / day-of, quiet hours, lock-screen preview and a
 * real test push (reminders-dispatch in test mode -- the result shown is
 * what the server actually did, not an assumed success: why this phone got
 * nothing, or what Google/Apple said about it within a few seconds; see
 * src/lib/pushDiagnostics.ts for the wording).
 *
 * Everything but the permission lives on the profile, so it applies to all
 * of the account's phones; the DB recomputes unsent reminders on change.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SettingsHeader } from '@/components/SettingsHeader';
import { Button, Kicker } from '@/components/ui';
import { usePushPermission } from '@/hooks/useReminders';
import { friendlyMessage } from '@/lib/friendlyError';
import { isNetworkError } from '@/lib/functionsError';
import {
  getInstallationId,
  getPushState,
  openNotificationSettings,
  registerPushInstallation,
  type PushState,
} from '@/lib/push';
import { describeTestPush, describeTestPushFailure, tokenErrorText, type PushNote } from '@/lib/pushDiagnostics';
import { useAuth } from '@/providers/AuthProvider';
import {
  clockMinutes,
  formatClock,
  getReminderSettings,
  isInQuietHours,
  minutesToClock,
  sendTestPush,
  updateReminderSettings,
  type ReminderSettings,
} from '@/services/reminders';
import { colors, font, radius } from '@/theme';

const QUICK_TIMES = ['07:00:00', '08:00:00', '09:00:00', '10:00:00', '12:00:00'];
const DEFAULT_QUIET = { start: '22:00:00', end: '08:00:00' };

type Editable = Omit<ReminderSettings, 'timezone'>;

/** Sends this phone's current token + permission to the server (never prompts). */
async function refreshRegistration(): Promise<{ state: PushState | null; error: string | null }> {
  try {
    return { state: await registerPushInstallation(), error: null };
  } catch (e) {
    return { state: null, error: friendlyMessage(e, 'Registration failed.') };
  }
}

export default function ReminderSettingsScreen() {
  const { user } = useAuth();
  const permission = usePushPermission();
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<PushNote | null>(null);
  // Quiet hours switched off and on again in one visit get their old times back.
  const lastQuiet = useRef<{ start: string; end: string } | null>(null);
  const pending = useRef<Partial<Editable>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRef = useRef<ReminderSettings | null>(null);

  useEffect(() => {
    if (!user) return;
    getReminderSettings(user.id)
      .then((s) => {
        setSettings(s);
        savedRef.current = s;
        if (s?.quiet_start && s.quiet_end) lastQuiet.current = { start: s.quiet_start, end: s.quiet_end };
      })
      .catch((e) => setLoadError(friendlyMessage(e, 'Could not load your settings.')));
  }, [user]);

  const flush = async () => {
    if (!user) return;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const saved = await updateReminderSettings(user.id, patch);
      savedRef.current = saved;
    } catch (e) {
      Alert.alert('Could not save', friendlyMessage(e, 'Please try again.'));
      // Back to what the server has.
      if (savedRef.current) setSettings(savedRef.current);
    } finally {
      setSaving(false);
    }
  };

  // Flush on leave.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flush();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Applies a change locally and saves it a moment later (steppers get tapped in bursts). */
  const change = (patch: Partial<Editable>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    // Automatic reminders inside quiet hours would all be pushed to the end
    // of them -- so the default time must be outside.
    if (isInQuietHours(next.reminder_time, next.quiet_start, next.quiet_end)) {
      Alert.alert(
        'That’s during quiet hours',
        `Quiet hours are ${formatClock(next.quiet_start)}–${formatClock(next.quiet_end)}. Reminders at ${formatClock(
          next.reminder_time
        )} would all be held until ${formatClock(next.quiet_end)}. Pick a time outside quiet hours, or change them.`
      );
      return;
    }
    setSettings(next);
    pending.current = { ...pending.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flush();
    }, 600);
  };

  const shift = (field: 'reminder_time' | 'quiet_start' | 'quiet_end', minutes: number) => {
    const current = settings?.[field];
    if (!current) return;
    change({ [field]: minutesToClock(clockMinutes(current) + minutes) } as Partial<Editable>);
  };

  const setQuietEnabled = (on: boolean) => {
    if (!settings) return;
    if (on) {
      const q = lastQuiet.current ?? DEFAULT_QUIET;
      change({ quiet_start: q.start, quiet_end: q.end });
    } else {
      if (settings.quiet_start && settings.quiet_end) {
        lastQuiet.current = { start: settings.quiet_start, end: settings.quiet_end };
      }
      change({ quiet_start: null, quiet_end: null });
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const installationId = permission.supported ? await getInstallationId().catch(() => null) : null;
      // Make sure the server has this phone's latest token and permission first.
      let reg = permission.supported ? await refreshRegistration() : null;
      let result = await sendTestPush(installationId);
      // The server doesn't know this phone, has no address for it, or switched
      // it off: register once more and retry once -- only when nothing went
      // out, so another device never gets the test twice.
      if (
        permission.supported &&
        result.installations === 0 &&
        (result.reason === 'not_registered' || result.reason === 'no_token' || result.reason === 'disabled')
      ) {
        reg = await refreshRegistration();
        result = await sendTestPush(installationId);
      }
      const state = reg?.state ?? (permission.supported ? await getPushState().catch(() => null) : null);
      setTestResult(
        describeTestPush(result, {
          installationId,
          platform: Platform.OS,
          permissionGranted: state?.permission === 'granted',
          tokenError: state?.tokenError ?? null,
          registerError: reg?.error ?? null,
        })
      );
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      setTestResult(
        describeTestPushFailure({
          message: friendlyMessage(e, 'Could not send a test notification.'),
          status: typeof status === 'number' ? status : undefined,
          network: isNetworkError(e),
        })
      );
    } finally {
      // The card shows the latest token error, if registering just hit one.
      permission.refresh();
      setTesting(false);
    }
  };

  const push = permission.push;
  const quietOn = !!settings?.quiet_start && !!settings?.quiet_end;

  return (
    <Screen showAccount={false}>
      <SettingsHeader title="Reminders" />

      {/* ── this phone ─────────────────────────────────────────────── */}
      <View style={[styles.card, { backgroundColor: colors.pastelPeach }]}>
        <Kicker style={styles.kicker}>Notifications on this phone</Kicker>
        {!permission.supported ? (
          <Text style={styles.body}>Notifications are only available in the phone app.</Text>
        ) : !push ? (
          <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} />
        ) : push.permission === 'granted' ? (
          <>
            {push.tokenError ? (
              <>
                <Text style={styles.body}>On — but reminders can’t reach this phone yet.</Text>
                <Text style={styles.warn}>{tokenErrorText(push.tokenError, Platform.OS)}</Text>
                <Text selectable style={styles.detail}>
                  Details: {push.tokenError}
                </Text>
              </>
            ) : testResult?.blocked ? (
              <Text style={styles.body}>On — but the test below shows reminders can’t reach this phone yet.</Text>
            ) : (
              // Having a token isn't proof pushes get through -- the test is.
              <Text style={styles.body}>On. Reminders are sent to this phone as notifications.</Text>
            )}
            <Button
              label="Open system settings"
              variant="ghost"
              align="flex-start"
              onPress={openNotificationSettings}
              textStyle={{ fontSize: 12 }}
            />
          </>
        ) : (
          <>
            <Text style={styles.body}>
              {push.permission === 'denied' ? 'Off.' : 'Not turned on yet.'} Reminders still show on Home and in the
              Reminders list.
            </Text>
            <Button
              label={push.canAskAgain ? 'Turn on notifications' : 'Open system settings'}
              variant="save"
              align="flex-start"
              onPress={push.canAskAgain ? permission.turnOn : openNotificationSettings}
              style={styles.pill}
            />
          </>
        )}
      </View>

      {loadError ? (
        <Text style={[styles.warn, { marginTop: 14 }]}>{loadError}</Text>
      ) : !settings ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
      ) : (
        <>
          {/* ── default time ─────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.pastelBlue }]}>
            <Kicker style={styles.kicker}>Default reminder time</Kicker>
            <View style={styles.stepper}>
              <StepButton label="−30 min" onPress={() => shift('reminder_time', -30)} />
              <Text style={styles.bigTime}>{formatClock(settings.reminder_time)}</Text>
              <StepButton label="+30 min" onPress={() => shift('reminder_time', 30)} />
            </View>
            <View style={styles.chips}>
              {QUICK_TIMES.map((t) => (
                <Chip
                  key={t}
                  label={formatClock(t)}
                  selected={clockMinutes(settings.reminder_time) === clockMinutes(t)}
                  onPress={() => change({ reminder_time: t })}
                />
              ))}
            </View>
            <Text style={styles.hint}>Used for due-date reminders and “every day until done”.</Text>

            <ToggleRow
              label="The day before"
              value={settings.remind_day_before}
              onChange={(v) => change({ remind_day_before: v })}
            />
            <ToggleRow label="On the day" value={settings.remind_day_of} onChange={(v) => change({ remind_day_of: v })} />
            {!settings.remind_day_before && !settings.remind_day_of ? (
              <Text style={styles.warn}>Tasks won’t get automatic due-date reminders.</Text>
            ) : null}
          </View>

          {/* ── quiet hours ──────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.pastelLavender }]}>
            <ToggleRow label="Quiet hours" value={quietOn} onChange={setQuietEnabled} bold />
            {quietOn ? (
              <>
                <View style={styles.quietRow}>
                  <Text style={styles.quietLabel}>From</Text>
                  <StepButton label="−30" onPress={() => shift('quiet_start', -30)} />
                  <Text style={styles.midTime}>{formatClock(settings.quiet_start)}</Text>
                  <StepButton label="+30" onPress={() => shift('quiet_start', 30)} />
                </View>
                <View style={styles.quietRow}>
                  <Text style={styles.quietLabel}>Until</Text>
                  <StepButton label="−30" onPress={() => shift('quiet_end', -30)} />
                  <Text style={styles.midTime}>{formatClock(settings.quiet_end)}</Text>
                  <StepButton label="+30" onPress={() => shift('quiet_end', 30)} />
                </View>
                {clockMinutes(settings.quiet_start ?? '') === clockMinutes(settings.quiet_end ?? '') ? (
                  <Text style={styles.warn}>Start and end are the same, so there are no quiet hours.</Text>
                ) : null}
                <Text style={styles.hint}>
                  Automatic reminders and “remind me later” wait until quiet hours end. A time you set yourself is kept
                  as you set it.
                </Text>
              </>
            ) : (
              <Text style={styles.hint}>Reminders can arrive at any time.</Text>
            )}
          </View>

          {/* ── lock screen ──────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.pastelGreen }]}>
            <ToggleRow
              label="Show details on the lock screen"
              value={settings.reminder_preview}
              onChange={(v) => change({ reminder_preview: v })}
              bold
            />
            <Text style={styles.hint}>
              {settings.reminder_preview
                ? 'Notifications show what the reminder is about.'
                : 'Notifications only say “You have a reminder” — open the app to see what.'}
            </Text>
          </View>

          {/* ── test ─────────────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: colors.pastelYellow }]}>
            <Kicker style={styles.kicker}>Test</Kicker>
            <Button
              label={testing ? 'Sending…' : 'Send test notification'}
              variant="secondary"
              align="flex-start"
              disabled={testing}
              onPress={runTest}
              style={styles.pill}
            />
            {testing ? (
              <Text style={styles.hint}>
                Sending, then waiting a few seconds for {Platform.OS === 'ios' ? 'Apple' : 'Google'} to confirm it…
              </Text>
            ) : testResult ? (
              <>
                <Text style={[styles.body, styles.testResult, !testResult.ok && { color: colors.accent800 }]}>
                  {testResult.text}
                </Text>
                {testResult.detail ? (
                  <Text selectable style={styles.detail}>
                    Details: {testResult.detail}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>

          <Text style={[styles.hint, { marginTop: 16 }]}>
            Reminders are sent by our server, so they need a network connection and can arrive a little late —
            your phone’s battery saver or Focus settings can delay or hide them too. Exact timing isn’t guaranteed.
            {saving ? ' Saving…' : ''}
          </Text>
        </>
      )}
    </Screen>
  );
}

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.step, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.stepText}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: colors.save }]}
    >
      <Text style={[styles.chipText, selected && { color: colors.saveText, fontFamily: font.semibold }]}>{label}</Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  bold,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  bold?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.toggleLabel, bold && { fontFamily: font.extrabold }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.save, false: colors.neutral300 }}
        thumbColor={value ? colors.saveText : colors.bg}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.pastel,
    padding: 16,
    marginTop: 14,
  },
  kicker: {
    color: colors.neutral700,
    marginBottom: 8,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
    marginBottom: 8,
  },
  warn: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.accent800,
    marginTop: 4,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.neutral700,
    marginTop: 6,
  },
  /** Raw error text under a plain-words explanation, for support. */
  detail: {
    fontFamily: font.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.neutral700,
    marginTop: 4,
  },
  testResult: {
    marginTop: 10,
    marginBottom: 0,
  },
  pill: {
    borderRadius: radius.pastel,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  step: {
    minWidth: 64,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: radius.pastel,
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
  },
  bigTime: {
    fontFamily: font.extrabold,
    fontSize: 24,
    color: colors.text,
  },
  midTime: {
    flex: 1,
    textAlign: 'center',
    fontFamily: font.extrabold,
    fontSize: 17,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: radius.pastel,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  chipText: {
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.text,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    gap: 12,
  },
  toggleLabel: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.text,
  },
  quietRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  quietLabel: {
    width: 44,
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.neutral800,
  },
});
