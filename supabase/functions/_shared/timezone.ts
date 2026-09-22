// Whose "today" is it? The device sends its IANA timezone with converse,
// process-session and search-ask requests (src/lib/device.ts);
// profiles.timezone is only a fallback -- the app never set it before, so
// for most users it's still the 'UTC' column default, which is not a real
// answer. A valid device value is saved back to the profile.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

/** The canonical IANA name for a timezone, or null. Only region names ("Asia/Seoul") and "UTC" -- no raw offsets. */
export function canonicalTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    return resolved === 'UTC' || resolved.includes('/') ? resolved : null;
  } catch {
    return null;
  }
}

export type UserTimeZone = {
  timezone: string;
  /** False when it's only the profile's never-set 'UTC' default -- dates relative to "today" are then unreliable. */
  known: boolean;
};

/**
 * The device's zone if it sent a valid one, else the profile's. Saves the
 * device's zone to the profile (in the background -- returned so the caller
 * can hand it to EdgeRuntime.waitUntil) when it differs.
 */
export function resolveUserTimeZone(
  db: SupabaseClient,
  userId: string,
  deviceTz: unknown,
  profileTz: string | null | undefined
): UserTimeZone & { save: Promise<void> | null } {
  const device = canonicalTimeZone(deviceTz);
  if (device) {
    const save =
      device !== profileTz
        ? Promise.resolve(db.from('profiles').update({ timezone: device }).eq('id', userId)).then(
            ({ error }) => {
              if (error) console.warn('could not save profile timezone', error.code ?? '', error.message ?? '');
            },
            (e) => console.warn('could not save profile timezone', e instanceof Error ? e.message : '')
          )
        : null;
    return { timezone: device, known: true, save };
  }
  const profile = canonicalTimeZone(profileTz);
  return { timezone: profile ?? 'UTC', known: !!profile && profile !== 'UTC', save: null };
}

/** The calendar date (YYYY-MM-DD) and English weekday of `at` in `timezone`. */
export function localDay(at: Date, timezone: string): { date: string; weekday: string } {
  try {
    return {
      date: at.toLocaleDateString('en-CA', { timeZone: timezone }),
      weekday: at.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' }),
    };
  } catch {
    return {
      date: at.toISOString().slice(0, 10),
      weekday: at.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' }),
    };
  }
}
