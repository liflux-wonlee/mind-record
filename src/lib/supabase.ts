/**
 * Supabase client — the one place this app talks to its backend.
 *
 * Session persistence uses a SecureStore-backed adapter (see
 * src/lib/secureStorage.ts) so a signed-in user stays signed in across app
 * restarts (see `src/providers/AuthProvider.tsx`, which reads the session
 * this client restores on launch) while the token itself sits in the OS
 * Keychain/Keystore instead of plain-text AsyncStorage.
 *
 * `EXPO_PUBLIC_*` vars are inlined into the JS bundle at build time, so only
 * ever put the publishable key here — never the service_role key or the
 * database password. See `.env.example`.
 */
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import { secureAuthStorage } from '@/lib/secureStorage';
import type { Database } from '@/types/database';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project values, then restart ' +
      'the dev server (env vars are read at bundle time).'
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: secureAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Off on every platform: the one place a redirect's code/tokens are read
    // is src/providers/AuthProvider.tsx (processAuthDeepLink) -- on mobile
    // from the deep link, on the web from the /auth/callback page URL.
    // Letting supabase-js also read the URL would exchange the same code
    // twice (the second attempt fails and reports a bogus error).
    detectSessionInUrl: false,
    // Web: PKCE, so the redirect back carries a one-time ?code= instead of
    // the tokens themselves in the address bar/history. Mobile keeps the
    // library's default (implicit) flow it has always used.
    flowType: Platform.OS === 'web' ? 'pkce' : 'implicit',
  },
});
