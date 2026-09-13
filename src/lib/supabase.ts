/**
 * Supabase client — the one place this app talks to its backend.
 *
 * Session persistence uses AsyncStorage so a signed-in user stays signed in
 * across app restarts (see `src/providers/AuthProvider.tsx`, which reads the
 * session this client restores on launch).
 *
 * `EXPO_PUBLIC_*` vars are inlined into the JS bundle at build time, so only
 * ever put the publishable key here — never the service_role key or the
 * database password. See `.env.example`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

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
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // This app has no web build that needs to read tokens out of the URL bar;
    // OAuth returns via a deep link instead (see src/lib/oauth.ts).
    detectSessionInUrl: false,
  },
});
