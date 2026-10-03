/**
 * Recording segments whose upload failed (no connection, a request that never
 * finished) are kept on the phone instead of being lost: the file is copied
 * out of the recorder's cache into the app's documents folder and listed
 * here, then uploaded again before the session is processed
 * (src/services/processing.ts) and whenever the app starts
 * (app/_layout.tsx). A file is deleted only after the server has it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { uploadRecording } from '@/services/recordings';

const KEY = 'joaassistant.pendingUploads.v1';
const DIR_NAME = 'pending-audio';

type Pending = {
  userId: string;
  sessionId: string;
  /** file:// uri of our own copy. */
  uri: string;
  /** When this segment was recorded (ISO) -- keeps the segments in order. */
  recordedAt: string;
};

async function load(): Promise<Pending[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Pending[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function save(list: Pending[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

// One change to the list at a time (a flush and a new failure can overlap).
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

/** Keeps a segment that couldn't be uploaded; returns false if even that failed. */
export function keepForLater(userId: string, sessionId: string, fileUri: string, recordedAt: string): Promise<boolean> {
  return serial(async () => {
    try {
      const dir = new Directory(Paths.document, DIR_NAME);
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const copy = new File(dir, `${sessionId}-${Date.parse(recordedAt) || Date.now()}.m4a`);
      new File(fileUri).copy(copy);
      const list = await load();
      list.push({ userId, sessionId, uri: copy.uri, recordedAt });
      await save(list);
      return true;
    } catch (e) {
      console.warn('could not keep the recording for later:', e instanceof Error ? e.message : String(e));
      return false;
    }
  });
}

/**
 * Uploads what's waiting -- only this session's when given -- and returns
 * how many of them are still waiting afterwards.
 */
export function flushPendingUploads(sessionId?: string): Promise<number> {
  return serial(async () => {
    const list = await load();
    const remaining: Pending[] = [];
    let left = 0;
    for (const item of list) {
      if (sessionId && item.sessionId !== sessionId) {
        remaining.push(item);
        continue;
      }
      const file = new File(item.uri);
      if (!file.exists) continue; // nothing left to send
      try {
        await uploadRecording(item.userId, item.sessionId, item.uri, item.recordedAt);
        try {
          file.delete();
        } catch {
          // Uploaded; a leftover copy only costs space.
        }
      } catch (e) {
        // The session may be gone (deleted/cancelled): drop it rather than retry forever.
        const message = e instanceof Error ? e.message : String(e);
        if (/violates|foreign key|row-level security|not found/i.test(message)) {
          try {
            file.delete();
          } catch {
            // ignore
          }
          continue;
        }
        remaining.push(item);
        left++;
      }
    }
    await save(remaining);
    return left;
  });
}

/** How many segments of this session are still only on the phone. */
export async function pendingCount(sessionId: string): Promise<number> {
  return (await load()).filter((p) => p.sessionId === sessionId).length;
}

/** Sessions with segments still only on the phone. */
export async function pendingSessionIds(): Promise<string[]> {
  return [...new Set((await load()).map((p) => p.sessionId))];
}
