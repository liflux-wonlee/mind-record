/**
 * Marks "the app is about to show a native OS dialog that isn't the user
 * actually leaving the app" -- Face ID/Touch ID's own sheet, a permission
 * prompt (microphone, notifications), and Android's account picker can all
 * flick AppState through 'background' (or 'inactive') for a moment while
 * they're on screen. The lock gate (src/lib/biometricLock.ts's useLockGate)
 * treats a background transition as "require unlocking again", so without
 * this it could re-lock itself the instant it shows its own unlock prompt,
 * or lock again right after a mic-permission dialog during an already-
 * unlocked session -- a loop, or an unwanted extra lock.
 *
 * Call sites wrap exactly the native call that pops the dialog, so the
 * exception is scoped to that specific request rather than to the whole
 * app-background window (a real backgrounding -- switching apps, the
 * lock screen, a phone call -- must still lock normally).
 */
let openCount = 0;

export function isSystemDialogOpen(): boolean {
  return openCount > 0;
}

export async function withSystemDialog<T>(fn: () => Promise<T>): Promise<T> {
  openCount++;
  try {
    return await fn();
  } finally {
    // The AppState 'active' transition after the dialog closes can arrive a
    // beat after this promise resolves, not strictly before it -- staying
    // "open" a little longer covers that race instead of closing the guard
    // right as the event it's meant to suppress is still in flight.
    setTimeout(() => {
      openCount--;
    }, 500);
  }
}
