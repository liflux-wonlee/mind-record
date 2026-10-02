/**
 * Connection check: times each step of reading data from the server, so a
 * slow screen can be traced to the phone (app busy, saved sign-in), the
 * network, or the database. Shows only step names and milliseconds -- no
 * user content.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SettingsHeader } from '@/components/SettingsHeader';
import { Button } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { colors, font, radius } from '@/theme';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const STEP_TIMEOUT_MS = 60_000;

type Row = { label: string; ms: number | null; note?: string };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const start = now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer after 60 s')), STEP_TIMEOUT_MS)),
    ]);
    return { ms: Math.round(now() - start), value };
  } catch (e) {
    return { ms: Math.round(now() - start), error: e instanceof Error ? e.message : String(e) };
  }
}

export default function ConnectionCheckScreen() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running || !user) return;
    setRunning(true);
    const out: Row[] = [];
    const add = (label: string, r: { ms: number; error?: string }, note?: string) => {
      out.push({ label, ms: r.ms, note: r.error ?? note });
      setRows([...out]);
    };

    // 1. Is the app's JS thread free? (A busy thread delays everything.)
    add('App responsiveness', await timed(() => new Promise<void>((resolve) => setTimeout(resolve, 0))));

    // 2. Saved sign-in (supabase-js does this before every request).
    let token: string | null = null;
    const session = await timed(async () => {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
      const exp = data.session?.expires_at;
      return exp ? Math.round(exp - Date.now() / 1000) : null;
    });
    add('Read sign-in', session, session.value != null ? `token valid ${session.value}s more` : undefined);

    // 3. Network only: tiny server endpoint, no database.
    for (let i = 1; i <= 2; i++) {
      add(
        `Network ping ${i}`,
        await timed(async () => {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY } });
          await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
      );
    }

    // 4. Network + database, bypassing the app's client.
    for (let i = 1; i <= 2; i++) {
      add(
        `Database (direct) ${i}`,
        await timed(async () => {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&id=eq.${user.id}`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token ?? SUPABASE_KEY}` },
          });
          await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
      );
    }

    // 5. The same through the app's client (adds the sign-in step).
    add(
      'Database (app client)',
      await timed(async () => {
        const { error } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
        if (error) throw error;
      })
    );

    // 6. A few at once, like a screen does.
    add(
      '5 queries at once',
      await timed(async () => {
        const results = await Promise.all([
          supabase.from('profiles').select('id').eq('id', user.id).maybeSingle(),
          supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('topics').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
          supabase.from('task_lists').select('id').eq('user_id', user.id),
        ]);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw failed.error;
      })
    );

    setRunning(false);
  };

  return (
    <Screen>
      <SettingsHeader title="Connection check" />
      <Text style={styles.body}>
        Times each step of loading data. If a screen is slow, run this and send a screenshot.
      </Text>
      <Button
        label={running ? 'Checking…' : 'Run check'}
        variant="save"
        disabled={running}
        onPress={run}
        style={styles.button}
      />
      <View style={styles.card}>
        {rows.length === 0 && !running ? <Text style={styles.body}>No results yet.</Text> : null}
        {rows.map((r) => (
          <View key={r.label} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{r.label}</Text>
              {r.note ? <Text style={styles.note}>{r.note}</Text> : null}
            </View>
            <Text style={[styles.ms, (r.ms ?? 0) > 2000 && { color: colors.accent800 }]}>
              {r.ms == null ? '—' : `${r.ms} ms`}
            </Text>
          </View>
        ))}
        {running ? <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: font.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
    marginTop: 8,
  },
  button: {
    marginTop: 12,
    borderRadius: radius.pastel,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  card: {
    marginTop: 14,
    padding: 14,
    borderRadius: radius.pastel,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: 8,
  },
  label: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: colors.text,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.neutral700,
    marginTop: 2,
  },
  ms: {
    fontFamily: font.extrabold,
    fontSize: 14,
    color: colors.text,
  },
});
