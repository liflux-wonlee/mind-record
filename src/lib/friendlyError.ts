/**
 * Display-layer translation for caught errors -- NOT how errors are thrown
 * or propagated (services/hooks keep throwing whatever Supabase or our own
 * code throws). Only used at the point an error reaches user-facing text
 * (Alert.alert, an inline error banner), so raw PostgREST/Postgres error
 * text -- `details`/`hint`/`code`, see @supabase/postgrest-js's
 * PostgrestError -- never reaches the user verbatim (e.g. "duplicate key
 * value violates unique constraint..." or a raw RLS-denial message).
 *
 * Our own `new Error('curated text')` throws, and Supabase Auth's own
 * errors (AuthError -- already human-readable by design, e.g. "Invalid
 * login credentials"), pass straight through: only PostgrestError carries
 * `details`+`hint` alongside `code`, which is what distinguishes a raw
 * database error from everything else that reaches this function.
 */
function isPostgrestError(
  e: unknown
): e is { message: string; details: string; hint: string; code: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    'details' in e &&
    'hint' in e &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

const POSTGREST_CODE_MESSAGES: Record<string, string> = {
  '23505': 'That already exists.',
  '23503': 'That item no longer exists.',
  '42501': "You don't have permission to do that.",
  PGRST301: "You don't have permission to do that.",
  PGRST116: 'That could not be found.',
};

export function friendlyMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isPostgrestError(e)) {
    return POSTGREST_CODE_MESSAGES[e.code] ?? fallback;
  }
  if (e instanceof TypeError && /network|fetch/i.test(e.message)) {
    return 'Check your internet connection and try again.';
  }
  return e instanceof Error ? e.message : fallback;
}
