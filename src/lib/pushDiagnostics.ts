/**
 * Plain words for why a reminder push can't reach a phone, for Settings ->
 * Reminders: the push-token error this phone got when it registered (the
 * permission card) and what "Send test notification" found out
 * (reminders-dispatch test mode -- see sendTestPush). Every note keeps the
 * raw code/text in `detail`, shown in small type for support.
 *
 * Pure (type imports only), so the wording can be checked with Node.
 */
import type { TestPushDelivery, TestPushReason, TestPushResult } from '@/services/reminders';

export type PushNote = {
  text: string;
  /** The raw error text or code, for support. */
  detail?: string;
  /** It went out, as far as the server can tell. */
  ok?: boolean;
  /** This phone can't get pushes until something is fixed (not just a blip) -- the permission card says so too. */
  blocked?: boolean;
};

/** Who hands out push addresses and delivers pushes on this platform. */
function pushProvider(platform: string): string {
  return platform === 'ios' ? 'Apple' : 'Google';
}

const FIREBASE_MISSING = 'This build doesn’t have Firebase set up yet — it needs the google-services.json file and a rebuild.';
const PROJECT_ID_MISSING = 'This build is missing its Expo project ID (extra.eas.projectId) — it needs a rebuild.';
const NETWORKISH = /SERVICE_NOT_AVAILABLE|network|timed out|timeout|offline|internet|connection|UnknownHost|failed to fetch/i;

/**
 * Why this phone couldn't get a push address (an Expo push token), from
 * getExpoPushTokenAsync's error text. On Android that's nearly always a
 * build made without Firebase (google-services.json) -- also the fallback.
 */
export function tokenErrorCause(raw: string | null | undefined, platform: string): string {
  const text = raw ?? '';
  if (/projectId|project id/i.test(text)) return PROJECT_ID_MISSING;
  if (/expo token|exp\.host|expected an OK response/i.test(text)) {
    return 'Expo’s push service didn’t answer — reopen the app to try again.';
  }
  if (platform === 'ios') {
    if (/aps-environment|entitlement/i.test(text)) {
      return 'This build isn’t set up for Apple push notifications (the push entitlement is missing) — it needs push credentials and a rebuild.';
    }
    if (/simulator/i.test(text)) return 'A simulator can’t get one — use a real iPhone.';
    if (NETWORKISH.test(text)) return 'It couldn’t reach Apple’s servers — check your connection, then reopen the app.';
    return 'Reopen the app to try again; if it keeps happening, the build’s Apple push setup (APNs) needs checking.';
  }
  if (!text || /firebase|google-services|fcm-credentials/i.test(text)) return FIREBASE_MISSING;
  if (/MISSING_INSTANCEID_SERVICE|play services|PHONE_REGISTRATION_ERROR/i.test(text)) {
    return 'Google Play services is missing or out of date on this phone — update it, then reopen the app.';
  }
  if (NETWORKISH.test(text)) return 'It couldn’t reach Google’s servers — check your connection, then reopen the app.';
  return 'Most often this means the build doesn’t have Firebase set up yet — it needs the google-services.json file and a rebuild.';
}

/** The permission card's line when notifications are allowed but there's no push address. */
export function tokenErrorText(raw: string | null | undefined, platform: string): string {
  return `This phone couldn’t get a push address from ${pushProvider(platform)}. ${tokenErrorCause(raw, platform)} Reminders still show in the app.`;
}

/**
 * An Expo ticket/receipt error code in plain words, to follow a colon
 * (https://docs.expo.dev/push-notifications/sending-notifications/#individual-errors).
 */
export function pushServiceErrorText(error: string | null | undefined, platform: string): string {
  const e = error ?? '';
  if (/InvalidCredentials/i.test(e)) {
    // Not uploaded, revoked, or (FCM) a service account without messaging rights.
    return platform === 'ios'
      ? 'the Apple push key (APNs) on Expo is missing or invalid (EAS credentials → iOS → Push Notifications key)'
      : 'the FCM key on Expo is missing or invalid (EAS credentials → Android → FCM V1 service account key)';
  }
  if (/MismatchSenderId/i.test(e)) {
    return 'the google-services.json in this build doesn’t match the FCM key uploaded to Expo — both must come from the same Firebase project';
  }
  if (/DeviceNotRegistered/i.test(e)) return 'this phone’s push address is no longer valid';
  if (/MessageTooBig/i.test(e)) return 'the notification was too large';
  if (/MessageRateExceeded|TOO_MANY/i.test(e)) return 'too many notifications went to this phone at once — wait a minute';
  if (/UNAUTHORIZED|HTTP 40[13]|access token/i.test(e)) {
    return 'the server’s Expo access token is missing or wrong (EXPO_ACCESS_TOKEN)';
  }
  if (/timeout|network error|no response|unreadable response|ticket count mismatch/i.test(e)) {
    return 'Expo’s push service didn’t answer properly';
  }
  if (/HTTP 5\d\d/.test(e)) return 'Expo’s push service had a problem';
  return e ? `the push service said “${e}”` : 'no reason was given';
}

const SENT_TEXT =
  'Sent — it should appear in a few seconds. If it doesn’t, check the app’s notification settings and battery saver.';
const REFRESH_ADDRESS =
  'Reopen the app to refresh it, then try again — if it keeps happening, reinstalling the app gets it a new one.';

function reached(r: TestPushDelivery): boolean {
  return r.status === 'accepted' || r.status === 'delivered';
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** What happened to one device's test push. */
function deliveryNote(r: TestPushDelivery, platform: string): PushNote {
  const who = pushProvider(platform);
  if (r.receipt === 'delivered' || r.status === 'delivered') return { ok: true, text: SENT_TEXT };
  if (r.receipt === 'failed' || (r.status === 'failed' && /DeviceNotRegistered/i.test(r.error ?? ''))) {
    const code = r.receiptError ?? r.error;
    if (/DeviceNotRegistered/i.test(code ?? '')) {
      return {
        text: `${who} rejected this phone’s push address — it’s no longer valid. ${REFRESH_ADDRESS}`,
        detail: code,
        blocked: true,
      };
    }
    return {
      text: `Expo Push took it, but ${who}’s push service refused it: ${pushServiceErrorText(code, platform)}. Reminders can’t reach this phone until that’s fixed.`,
      detail: code,
      blocked: true,
    };
  }
  if (r.status === 'accepted') {
    return r.receipt === 'pending'
      ? {
          ok: true,
          text: `Sent. ${who} hasn’t confirmed it yet, but it should appear in a few seconds. If it doesn’t, check the app’s notification settings and battery saver.`,
        }
      : { ok: true, text: SENT_TEXT };
  }
  if (r.status === 'uncertain') {
    return { text: 'Expo’s push service didn’t answer in time, so it may or may not arrive.', detail: r.error };
  }
  if (r.status === 'error') {
    return {
      text: `Expo Push couldn’t take it just now: ${pushServiceErrorText(r.error, platform)}. The server will retry for a few minutes.`,
      detail: r.error,
    };
  }
  // 'failed' at send time: Expo refused it for good (a retry wouldn't help).
  return { text: `Couldn’t send it: ${pushServiceErrorText(r.error, platform)}.`, detail: r.error, blocked: r.status === 'failed' };
}

export type TestPushContext = {
  /** This phone's installation id (null on the web). */
  installationId: string | null;
  platform: string;
  /** The OS permission on this phone right now. */
  permissionGranted: boolean;
  /** Why this phone's last registration got no push token, if it didn't. */
  tokenError: string | null;
  /** Why re-registering this phone just before the test failed, if it did. */
  registerError: string | null;
};

/**
 * Why this phone got nothing, in plain words. Registering stores the phone's
 * current token and switches it back on, so right after the pre-test
 * registration the server can only say 'no_token' when this phone just
 * failed to get a token, and never 'disabled': either one otherwise means
 * the server still has old state because updating it didn't get through.
 */
function noDeviceNote(reason: TestPushReason, lastError: string | undefined, ctx: TestPushContext): PushNote {
  const who = pushProvider(ctx.platform);
  switch (reason) {
    case 'no_token':
      // Without an installation id (the web) the reason is about the account's
      // latest phone, whose token error isn't known here: keep the usual cause.
      if (ctx.tokenError || !ctx.installationId) {
        return {
          text: `Notifications are on, but this phone couldn’t get a push address from ${who}, so there’s nowhere to send it. ${tokenErrorCause(
            ctx.tokenError,
            ctx.platform
          )} Reminders still show in the app.`,
          detail: ctx.tokenError ?? undefined,
          blocked: !!ctx.tokenError,
        };
      }
      return {
        text: ctx.registerError
          ? 'The server doesn’t have this phone’s current push address — updating it didn’t work. Check your connection, then try again.'
          : 'The server doesn’t have this phone’s current push address yet. Reopen the app, then try again.',
        detail: ctx.registerError ?? undefined,
      };
    case 'permission_off':
      if (ctx.permissionGranted) {
        // The server still has the old permission: re-registering didn't get through.
        return {
          text: 'Notifications are on here, but the server still has them off for this phone — updating it didn’t work. Check your connection, then try again.',
          detail: ctx.registerError ?? undefined,
        };
      }
      return {
        text: 'Notifications are off for this phone, so nothing was sent to it. Turn them on with the button above (or in the system settings), then try again.',
      };
    case 'disabled': {
      const why = !lastError
        ? ''
        : /DeviceNotRegistered/i.test(lastError)
          ? ' — it’s no longer valid'
          : ` (${pushServiceErrorText(lastError, ctx.platform)})`;
      if (ctx.registerError) {
        // Registering would have switched it back on with the current address.
        return {
          text: `${who} rejected this phone’s old push address${why}, and updating it didn’t work. Check your connection, then try again.`,
          detail: ctx.registerError,
        };
      }
      return { text: `${who} rejected this phone’s push address${why}. ${REFRESH_ADDRESS}`, detail: lastError, blocked: true };
    }
    case 'not_registered':
    default:
      return {
        text: ctx.registerError
          ? 'This phone isn’t registered for notifications yet — registering it didn’t work. Check your connection, then try again.'
          : 'This phone isn’t registered for notifications yet. Reopen the app, then try again.',
        detail: ctx.registerError ?? undefined,
      };
  }
}

/** The line shown after "Send test notification" -- about THIS phone first, then any others. */
export function describeTestPush(result: TestPushResult, ctx: TestPushContext): PushNote {
  const results = result.results;
  const mine = ctx.installationId ? results.find((r) => r.installationId === ctx.installationId) : undefined;
  // Sent, but not to this phone. An older server ignores the id and gives no
  // reason, yet still names each result's device -- so this phone got nothing.
  const missedMine = !!ctx.installationId && !mine && results.length > 0;

  if (result.installations === 0 || (!mine && (result.reason || missedMine))) {
    // An older server gives no reason: judge from this phone's own state.
    const reason: TestPushReason =
      result.reason ?? (ctx.tokenError ? 'no_token' : ctx.permissionGranted ? 'not_registered' : 'permission_off');
    const note = noDeviceNote(reason, result.lastError, ctx);
    // Maybe a stale registration of this very phone (a reinstall), so no "your other phone".
    const elsewhere = results.filter(reached).length;
    if (elsewhere > 0) {
      note.text += ` It went to ${plural(elsewhere, 'another device', `${elsewhere} other devices`)} registered to your account instead.`;
    }
    return note;
  }
  if (results.length === 0) return { text: 'A test was just sent — wait a few seconds, then try again.' };

  // Here `mine` is only missing when the app couldn't say which phone it is (the web).
  const primary = mine ?? (results.length === 1 ? results[0] : undefined);
  if (!primary) {
    // Several devices and no telling which is this one.
    const n = results.filter(reached).length;
    const problem = results.find((r) => !reached(r));
    if (n === 0 && problem) return deliveryNote(problem, ctx.platform);
    const code = problem ? (problem.receiptError ?? problem.error) : undefined;
    return {
      ok: n > 0,
      text:
        `Sent to ${n} of ${results.length} devices — it should appear in a few seconds.` +
        (problem ? ` One couldn’t be reached: ${pushServiceErrorText(code, ctx.platform)}.` : ''),
      detail: code,
    };
  }

  const note = deliveryNote(primary, ctx.platform);
  const others = results.filter((r) => r !== primary);
  const othersReached = others.filter(reached).length;
  const othersMissed = others.length - othersReached;
  if (othersReached > 0) {
    note.text += ` Also sent to ${plural(othersReached, 'another device', `${othersReached} other devices`)} registered to your account.`;
  }
  if (othersMissed > 0) {
    note.text += ` ${plural(othersMissed, 'One other device', `${othersMissed} other devices`)} couldn’t be reached.`;
  }
  return note;
}

/** When the test couldn't be run at all: offline, the function missing or failing, signed out. */
export function describeTestPushFailure(e: { message: string; status?: number; network: boolean }): PushNote {
  if (e.network) {
    return {
      text: 'Couldn’t reach the server — this phone seems to be offline. Check your connection and try again.',
      detail: e.message,
    };
  }
  if (e.status === 404) {
    return {
      text: 'The server’s notification function isn’t reachable — reminders-dispatch isn’t deployed. Deploy it, then try again.',
      detail: e.message,
    };
  }
  if (e.status === 401) return { text: 'Your sign-in has expired. Sign out and back in, then try again.', detail: e.message };
  if (e.status && e.status >= 500) {
    return {
      text: 'The server’s notification function failed. Try again in a moment — if it keeps happening, check the reminders-dispatch logs.',
      detail: e.message,
    };
  }
  return { text: e.message || 'Could not send a test notification.' };
}
