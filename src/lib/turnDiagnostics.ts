/**
 * On-device record of the last few Conversation turns -- the exact audio
 * the turn-end detector heard, plus what it decided and why -- so a real
 * drive can be replayed offline. Turn-end detection was tuned on simulated
 * car noise and then failed on the road; this is how real turns get back to
 * the bench. Kept only in the app's private storage (never uploaded by
 * itself); the user shares it from Settings -> AI when asked to.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { encodeWav } from '@/lib/wav';

/** How many recent turns are kept (older ones are deleted as new ones come in). */
const KEEP_TURNS = 12;
const dir = () => new Directory(Paths.document, 'turn-diagnostics');

/** Which turn-end detector Conversation mode uses on Android -- see useConversationSession.ts. */
export type TurnDetectorChoice = 'classic' | 'pcm';
const DETECTOR_KEY = 'conversation.turnDetector';
// The previous (MediaRecorder + level metering) detector stays the default
// until the PCM one has been tuned on real drives: on the road it did
// worse than the classic one.
export const DEFAULT_TURN_DETECTOR: TurnDetectorChoice = 'classic';

export async function getTurnDetectorChoice(): Promise<TurnDetectorChoice> {
  try {
    const value = await AsyncStorage.getItem(DETECTOR_KEY);
    return value === 'pcm' || value === 'classic' ? value : DEFAULT_TURN_DETECTOR;
  } catch {
    return DEFAULT_TURN_DETECTOR;
  }
}

export async function setTurnDetectorChoice(choice: TurnDetectorChoice): Promise<void> {
  await AsyncStorage.setItem(DETECTOR_KEY, choice);
}

/**
 * Saves one turn. `audio` is either raw PCM chunks (the PCM detector's
 * input, written as WAV) or an existing recording file (MediaRecorder's
 * m4a, copied). Never throws -- diagnostics must not break a turn.
 */
export function saveTurnDiagnostics(
  audio: { chunks: Int16Array[]; sampleRate: number } | { uri: string; extension: string } | null,
  meta: Record<string, unknown>
): void {
  try {
    const d = dir();
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    const id = `${Date.now()}`;
    let audioFile: string | null = null;
    if (audio && 'chunks' in audio) {
      if (audio.chunks.length > 0) {
        const wav = encodeWav(audio.chunks, audio.sampleRate);
        const f = new File(d, `${id}.wav`);
        f.write(wav.bytes);
        audioFile = f.name;
      }
    } else if (audio) {
      const source = new File(audio.uri);
      if (source.exists) {
        const f = new File(d, `${id}.${audio.extension}`);
        source.copySync(f);
        audioFile = f.name;
      }
    }
    new File(d, `${id}.json`).write(JSON.stringify({ id, audioFile, ...meta }));
    prune(d);
  } catch (e) {
    console.warn('turn diagnostics not saved:', e instanceof Error ? e.message : String(e));
  }
}

function prune(d: Directory): void {
  const metas = d
    .list()
    .filter((e): e is File => e instanceof File && e.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const old of metas.slice(0, Math.max(0, metas.length - KEEP_TURNS))) {
    const id = old.name.replace(/\.json$/, '');
    for (const e of d.list()) {
      if (e instanceof File && e.name.startsWith(`${id}.`)) e.delete();
    }
  }
}

export function turnDiagnosticsCount(): number {
  try {
    const d = dir();
    if (!d.exists) return 0;
    return d.list().filter((e) => e instanceof File && e.name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

/**
 * Bundles every kept turn (metadata + base64 audio) into one JSON file and
 * opens the share sheet, so it can be saved to Google Drive or sent on.
 */
export async function shareTurnDiagnostics(): Promise<void> {
  const d = dir();
  if (!d.exists) throw new Error('No conversation turns have been recorded yet.');
  const files = d.list().filter((e): e is File => e instanceof File);
  const metas = files.filter((f) => f.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
  if (metas.length === 0) throw new Error('No conversation turns have been recorded yet.');
  const turns: unknown[] = [];
  for (const m of metas) {
    const meta = JSON.parse(await m.text()) as { audioFile?: string | null };
    const audio = meta.audioFile ? files.find((f) => f.name === meta.audioFile) : undefined;
    turns.push({ ...meta, audioBase64: audio && audio.exists ? await audio.base64() : null });
  }
  const bundle = new File(Paths.cache, `mind-record-turns-${Date.now()}.json`);
  bundle.write(
    JSON.stringify({
      kind: 'mind-record-turn-diagnostics',
      version: 1,
      exportedAt: new Date().toISOString(),
      platform: `${Platform.OS} ${String(Platform.Version)}`,
      turns,
    })
  );
  await Sharing.shareAsync(bundle.uri, { mimeType: 'application/json', dialogTitle: 'Share conversation turns' });
}

export function clearTurnDiagnostics(): void {
  const d = dir();
  if (d.exists) d.delete();
}
