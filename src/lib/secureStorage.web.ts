/**
 * Web counterpart of src/lib/secureStorage.ts (Metro picks this file for
 * the web bundle; iOS/Android keep the SecureStore-backed original, so
 * mobile sessions and their at-rest encryption are untouched).
 *
 * Browsers have no Keychain/Keystore, so the web session lives in
 * localStorage -- the same place supabase-js keeps it by default on the
 * web. That's the standard trade-off for a browser SPA: the session is
 * readable by any script running on this origin, so the web build must
 * never load third-party scripts it doesn't trust, and signing out removes
 * it (see src/services/auth.ts). Nothing here is shared with the mobile
 * app's storage -- each device keeps its own session for the same account.
 */

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Storage disabled (some private modes) -- no persisted session, but
    // the in-memory one supabase-js keeps still works for this tab.
    return null;
  }
}

export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    return storage()?.getItem(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    storage()?.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    storage()?.removeItem(key);
  },
};
