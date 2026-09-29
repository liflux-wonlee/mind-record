/**
 * Deletes what earlier builds left on the phone and nothing reads anymore.
 *
 * Settings -> AI used to have a Turn detection section (Previous / New
 * detector, Share turns / Delete turns). Every build with it kept the last
 * 12 Conversation turns -- the audio plus how the pause was judged -- in the
 * app's private storage for tuning, whichever detector was on. It's gone now
 * (turns end fine with the metering detector alone), and those recordings
 * would otherwise sit there forever -- so they're deleted once, together
 * with the saved detector choice and any "Share turns" bundles still in the
 * cache. See git history for src/lib/turnDiagnostics.ts for the old layout.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

// Set once everything below is gone; a failed run tries again next launch.
const DONE_KEY = 'mindrecord.cleanup.turnDiagnostics.v1';
const DIAGNOSTICS_DIR = 'turn-diagnostics';
const DETECTOR_CHOICE_KEY = 'conversation.turnDetector';
// "Share turns" bundles (they hold every kept turn's audio), and a raw turn
// WAV the removed PCM path would have deleted had the app not died mid-turn.
const CACHE_LEFTOVERS = [/^mind-record-turns-\d+\.json$/, /^mind-record-turn-\d+\.wav$/];

let started = false;

/** Safe to call on every launch: after the first successful run it only reads a flag. */
export async function purgeLegacyTurnDiagnostics(): Promise<void> {
  if (started) return;
  started = true;
  try {
    if ((await AsyncStorage.getItem(DONE_KEY)) === '1') return;
    const dir = new Directory(Paths.document, DIAGNOSTICS_DIR);
    if (dir.exists) dir.delete();
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && CACHE_LEFTOVERS.some((pattern) => pattern.test(entry.name))) entry.delete();
    }
    await AsyncStorage.removeItem(DETECTOR_CHOICE_KEY);
    await AsyncStorage.setItem(DONE_KEY, '1');
  } catch (e) {
    console.warn('old turn diagnostics not cleaned up:', e instanceof Error ? e.message : String(e));
  }
}
