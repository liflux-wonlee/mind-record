/**
 * Social sign-in, iOS/Android: native Google Sign-In and Sign in with
 * Apple, both exchanging the provider's identity token with Supabase
 * (signInWithIdToken). The web build uses socialAuth.web.ts instead (the
 * native SDKs don't exist in a browser) -- same Supabase project, same
 * user ids. Moved here unchanged from src/services/auth.ts, which
 * re-exports these so callers didn't change.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { OAuthCancelledError } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { getProfile, updateProfile } from '@/services/profiles';
import { AppleSignInUnavailableError } from '@/services/socialAuthErrors';

/**
 * Native Google Sign-In (the account picker Android/iOS show for every
 * app, not a browser tab) -- replaces an earlier web-relay implementation
 * that went through Supabase's hosted `/authorize` endpoint + an in-app
 * browser (see git history / src/lib/oauth.ts). That approach showed the
 * Supabase project's own URL on the consent screen instead of "Mind
 * Record" and, on Android, was unreliable about the browser tab handing
 * control back to the app. Going native sidesteps both: there's no browser
 * step at all, Google hands back an ID token directly, and Supabase
 * verifies it the same way it already does for Apple (see
 * `signInWithApple` below) via `signInWithIdToken`.
 *
 * NOTE on app.json's `plugins` array (re-verified against the installed
 * package's actual plugin source, node_modules/@react-native-google-signin/
 * google-signin/plugin/build/withGoogleSignIn.js -- an EARLIER version of
 * this comment had this backwards): the plugin only touches ANDROID at all
 * when given NO options (a bare `"@react-native-google-signin/google-
 * signin"` string), where it wires up Firebase (AndroidConfig.GoogleServices,
 * expecting a google-services.json this project doesn't have and doesn't
 * need) -- which is exactly why it's left out of the plugins array entirely.
 * Given an `{ iosUrlScheme }` option instead, it ONLY adds that URL scheme
 * to iOS's Info.plist and never touches Android either way, so adding it
 * with that option is safe to do independently once iOS is actually set up
 * (see EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID below) -- Android keeps working via
 * plain autolinking regardless, with or without the plugin present.
 */
export async function signInWithGoogle(): Promise<void> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. See the deployment checklist for the Google Cloud Console steps.'
    );
  }
  // Only actually used on iOS (ignored on Android) -- a SEPARATE OAuth
  // client from webClientId, of type "iOS", matching the app's bundle id.
  // Until this (and app.json's matching iosUrlScheme, see the note above)
  // are both set up, Google Sign-In only works on Android.
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

  GoogleSignin.configure({ webClientId, iosClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') {
    throw new OAuthCancelledError();
  }

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
}

export async function signInWithApple(): Promise<void> {
  if (Platform.OS !== 'ios') throw new AppleSignInUnavailableError();

  // Standard OIDC replay protection: Apple embeds the SHA-256 hash we give
  // it into the identity token's own `nonce` claim, and Supabase re-hashes
  // whatever raw value we pass it here to check the two match -- so a
  // captured identity token can't be replayed through signInWithIdToken a
  // second time to mint a new session, only used once for the request it
  // was actually issued for.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;

  // Apple only ever includes the user's name in `credential.fullName` on
  // the FIRST authorization ever granted to this app -- every sign-in
  // after that returns it empty, by Apple's own design, so this is the one
  // chance to capture it. The identity token itself never carries a name
  // at all (unlike email), which is why this can't just be read server-side
  // from the token the way profiles.email effectively is.
  //
  // Deliberately kept separate from `profiles.user_honorific` (the name
  // the user sets themselves in Settings for the AI to address them by) --
  // this only ever fills a brand-new profile's still-blank `display_name`,
  // and never overwrites one that already exists (from a prior sign-in
  // elsewhere, or one the user set by hand).
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
  if (fullName && data.user) {
    try {
      const profile = await getProfile(data.user.id);
      if (profile && !profile.display_name) {
        await updateProfile(data.user.id, { display_name: fullName });
      }
    } catch {
      // Best-effort -- not worth failing an otherwise-successful sign-in over this.
    }
  }
}
