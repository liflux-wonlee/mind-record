/**
 * Device context sent with converse, process-session and search-ask
 * requests -- see supabase/functions/_shared/timezone.ts.
 */

/**
 * The device's IANA timezone (e.g. "Asia/Seoul"), so the server knows what
 * "today", "내일" or "last week" mean for this user. The server validates it
 * and saves it to profiles.timezone.
 */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The device's language (e.g. "ko-KR") -- only a hint, for a voice turn in
 * which nothing intelligible was heard yet (the AI otherwise replies in the
 * language actually spoken).
 */
export function deviceLanguage(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
}
