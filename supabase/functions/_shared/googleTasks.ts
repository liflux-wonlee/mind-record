// Shared by every google-tasks-* Edge Function: the token-refresh helper
// and the small set of Google endpoints they all call. Not shared with
// login's Google Sign-In (src/services/auth.ts's signInWithGoogle) at all
// -- that's a completely separate OAuth client/token, on purpose (the spec
// is explicit that a Google Tasks connection must never reuse the login
// ID token, and must survive independently of which provider the user
// actually signed into Mind Record with).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export const GOOGLE_TASKS_CLIENT_ID = Deno.env.get('GOOGLE_TASKS_CLIENT_ID');
export const GOOGLE_TASKS_CLIENT_SECRET = Deno.env.get('GOOGLE_TASKS_CLIENT_SECRET');

export type GoogleTasksConnection = {
  user_id: string;
  google_sub: string;
  google_email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  default_list_id: string | null;
  default_list_title: string | null;
};

/**
 * Returns a live access token for this user's Google Tasks connection,
 * refreshing it first if it's missing or within a minute of expiring.
 * Throws NotConnectedError if there's no connection row at all.
 */
export async function getValidAccessToken(
  db: SupabaseClient,
  userId: string
): Promise<{ accessToken: string; connection: GoogleTasksConnection }> {
  const { data: connection, error } = await db
    .from('google_tasks_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!connection) throw new NotConnectedError();

  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt - Date.now() > 60_000) {
    return { accessToken: connection.access_token, connection };
  }

  if (!GOOGLE_TASKS_CLIENT_ID || !GOOGLE_TASKS_CLIENT_SECRET) {
    throw new Error('Google Tasks is not configured on this project.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_TASKS_CLIENT_ID,
      client_secret: GOOGLE_TASKS_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // A revoked/expired refresh token (permission revoked in the user's
    // Google account, or the grant expired) surfaces here as invalid_grant
    // -- treat it as "disconnected", not a generic server error, so the
    // app can prompt to reconnect instead of just showing "try again".
    if (res.status === 400 && /invalid_grant/i.test(body)) throw new NotConnectedError();
    // The raw Google response body is logged, not shown -- it's Google's
    // own OAuth error JSON, not something a user should ever see.
    console.error('Google Tasks token refresh failed:', res.status, body);
    throw new Error('Could not refresh the Google Tasks connection. Please try again.');
  }
  const data = await res.json();
  const accessToken = data.access_token as string;
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const newExpiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

  const { error: updateError } = await db
    .from('google_tasks_connections')
    .update({ access_token: accessToken, access_token_expires_at: newExpiresAt })
    .eq('user_id', userId);
  if (updateError) throw updateError;

  return { accessToken, connection: { ...connection, access_token: accessToken, access_token_expires_at: newExpiresAt } };
}

export class NotConnectedError extends Error {
  constructor() {
    super('Google Tasks is not connected.');
    this.name = 'NotConnectedError';
  }
}

export async function googleTasksFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://tasks.googleapis.com/tasks/v1/${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
}
