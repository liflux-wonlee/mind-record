/**
 * Native OS share sheet (Mail, Messages, WhatsApp, whatever the device
 * already has installed) via React Native's own `Share` API -- not a
 * custom email-send API or per-messenger integration, per the spec's
 * explicit "use the OS share sheet, don't build your own" rule.
 */
import { Share } from 'react-native';

export type ShareOutcome = 'shared' | 'dismissed';

export async function shareText(content: string, options?: { title?: string }): Promise<ShareOutcome> {
  try {
    const result = await Share.share(
      { message: content, title: options?.title },
      { dialogTitle: options?.title }
    );
    // iOS reports a real dismissedAction when the user backs out without
    // picking a target; Android's Share.share resolves 'sharedAction' as
    // soon as the sheet is handed off regardless, so there's no reliable
    // "the user actually sent it" signal there either way -- callers must
    // not treat either outcome as proof of delivery, only "the sheet was
    // shown and closed without throwing".
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    // A thrown Share.share is the user backing out (or the OS sheet being
    // unavailable) -- never report this as if the user's content failed to
    // save or was lost, since nothing about their data changed.
    return 'dismissed';
  }
}
