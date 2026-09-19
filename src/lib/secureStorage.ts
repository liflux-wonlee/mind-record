/**
 * A SecureStore-backed storage adapter for Supabase's `auth.storage` (see
 * src/lib/supabase.ts), replacing the plain AsyncStorage one this app used
 * before. expo-secure-store keeps values in the iOS Keychain / Android
 * Keystore-backed EncryptedSharedPreferences instead of plain-text
 * AsyncStorage files, so a signed-in session isn't immediately readable
 * from a device backup or a rooted/jailbroken filesystem dump.
 *
 * Deliberately NOT using `requireAuthentication: true` here: that would pop
 * a biometric prompt on every read/write, including the silent background
 * token auto-refresh Supabase does on its own timer -- which would both
 * break that refresh (nothing is around to answer the prompt) and force a
 * biometric check completely unrelated to this app's own Settings ->
 * biometric-lock feature (see src/lib/biometricLock.ts). Session storage
 * and the user-facing lock gate are deliberately two separate concerns:
 * this file only decides how the session is *encrypted at rest*, never
 * whether the user has to unlock the app to see their records.
 *
 * SecureStore enforces roughly a 2048-byte limit per value (an Android
 * Keystore/EncryptedSharedPreferences constraint) -- a Supabase session
 * (access token + refresh token + user/app metadata, serialized as one
 * JSON blob) is routinely larger than that, so a value is split across
 * `${key}_0`, `${key}_1`, ... entries with a small header key
 * (`${key}_chunks`) recording how many there are.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1800; // headroom under SecureStore's ~2048-byte-per-value ceiling
const CHUNKS_SUFFIX = '.chunks';

async function getChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(key + CHUNKS_SUFFIX);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readChunked(key: string): Promise<string | null> {
  const count = await getChunkCount(key);
  if (count === 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}.${i}`);
    // A chunk going missing means the value can't be reassembled correctly
    // -- treat the whole thing as absent rather than silently returning a
    // truncated/corrupt session to Supabase.
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join('');
}

async function writeChunked(key: string, value: string): Promise<void> {
  const previousCount = await getChunkCount(key);
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(`${key}.${i}`, chunks[i]);
  }
  // The chunk count is only updated once every chunk is safely written, and
  // only THEN are now-unused leftover chunks from a previously longer value
  // removed -- writing the count first would let a failure partway through
  // leave a future read picking up a chunk that was never actually saved.
  await SecureStore.setItemAsync(key + CHUNKS_SUFFIX, String(chunks.length));
  for (let i = chunks.length; i < previousCount; i++) {
    await SecureStore.deleteItemAsync(`${key}.${i}`).catch(() => {
      // Best-effort -- an orphaned old chunk just wastes a little space.
    });
  }
}

async function removeChunked(key: string): Promise<void> {
  const count = await getChunkCount(key);
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${key}.${i}`).catch(() => {});
  }
  await SecureStore.deleteItemAsync(key + CHUNKS_SUFFIX).catch(() => {});
}

/**
 * Supabase's storage adapter interface (get/set/removeItem). getItem also
 * migrates a value still sitting in the old plain AsyncStorage on its first
 * read, so upgrading the app doesn't sign anyone out -- an existing session
 * is moved into SecureStore and removed from AsyncStorage the moment it's
 * next read, not deleted outright before the move is confirmed written.
 */
export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const fromSecureStore = await readChunked(key);
    if (fromSecureStore !== null) return fromSecureStore;

    const legacy = await AsyncStorage.getItem(key);
    if (legacy === null) return null;
    try {
      await writeChunked(key, legacy);
      await AsyncStorage.removeItem(key);
    } catch {
      // Could not migrate this time (e.g. SecureStore briefly unavailable)
      // -- leave the plaintext copy in place and keep using it rather than
      // losing the session; the next getItem call tries the migration again.
    }
    return legacy;
  },
  async setItem(key: string, value: string): Promise<void> {
    await writeChunked(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await removeChunked(key);
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
