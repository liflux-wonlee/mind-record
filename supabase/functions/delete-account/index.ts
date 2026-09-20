// Permanently deletes the calling user's account and everything under it --
// Account's "Delete account" button (src/services/account.ts). Required by
// app store review guidelines for any app that supports creating an
// account: an in-app path to delete it, not just a "contact support" form.
//
// Deliberately only ever operates on the CALLING user (identified by their
// own JWT) -- there is no userId parameter, so this can never be used to
// delete someone else's account.
//
// Order matters: Storage is cleared FIRST, while the account (and this
// call's JWT) still exists, so a failure there can be retried with the
// same still-valid session. Every app table (sessions/messages/tasks/
// memories/topics/session_topics/attachments/profiles) has an `on delete
// cascade` foreign key back to auth.users, so deleting the auth user itself
// -- the LAST step, and the only irreversible one -- removes all of it in
// one atomic Postgres operation instead of this function enumerating and
// deleting every table by hand (which risks silently missing one as the
// schema grows).
//
// NOT implemented yet: revoking the user's Apple "Sign in with Apple"
// grant server-side (Apple requires this when an app is deleted, per
// https://developer.apple.com/documentation/sign_in_with_apple/revoking_tokens).
// Supabase Auth doesn't retain Apple's refresh token anywhere this function
// can read it by default -- doing this properly means capturing and
// storing that token (encrypted, server-side only) at sign-in time
// specifically for this purpose, which hasn't been built. Deletion still
// proceeds without it; this is a known gap, not a silent skip pretending
// to be complete (see the account-deletion report).
//
// Invoked via
//   supabase.functions.invoke('delete-account')
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are the same
// Edge Function secrets every other function here relies on.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    await deleteAllUserStorage(db, user.id);

    const { error: deleteUserError } = await db.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;

    return json({ status: 'deleted' });
  } catch (e) {
    // No PII in the log line itself -- just the user id (already the
    // subject of every other admin-level log line Supabase itself emits)
    // and the raw error for whoever reads the function logs.
    console.error('delete-account failed for user', user.id, e);
    return json({ error: errorMessage(e) }, 500);
  }
});

/**
 * Storage has no "delete by prefix" call -- list every entry under the
 * user's own folder, one level deep (recordings are organized as
 * {user_id}/{session_id}/... or {user_id}/search-queries/..., never nested
 * further than that), then remove every file found.
 */
async function deleteAllUserStorage(db: SupabaseClient, userId: string): Promise<void> {
  const { data: topLevel, error: listError } = await db.storage.from('recordings').list(userId);
  if (listError) throw listError;

  const paths: string[] = [];
  for (const entry of topLevel ?? []) {
    // A subfolder listing entry has no `id`; an actual file does.
    if (entry.id === null) {
      const { data: inner, error: innerError } = await db.storage.from('recordings').list(`${userId}/${entry.name}`);
      if (innerError) throw innerError;
      for (const file of inner ?? []) {
        if (file.id !== null) paths.push(`${userId}/${entry.name}/${file.name}`);
      }
    } else {
      paths.push(`${userId}/${entry.name}`);
    }
  }
  if (paths.length === 0) return;

  const { error: removeError } = await db.storage.from('recordings').remove(paths);
  if (removeError) throw removeError;
}

function errorMessage(e: unknown): string {
  const raw =
    e instanceof Error
      ? e.message
      : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
        ? (e as { message: string }).message
        : '';
  if (/fetch failed|network|ECONNRESET|timed? ?out/i.test(raw)) return 'Connection problem. Please try again.';
  return raw
    ? `${raw} Your account has not been fully deleted -- please try again.`
    : 'Something went wrong. Your account has not been fully deleted -- please try again.';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
