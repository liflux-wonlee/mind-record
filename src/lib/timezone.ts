/**
 * The device's IANA timezone (e.g. "Asia/Seoul"), sent with converse,
 * process-session and search-ask requests so the server knows what "today",
 * "내일" or "last week" mean for this user -- see
 * supabase/functions/_shared/timezone.ts. The server validates it and saves
 * it to profiles.timezone.
 */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
