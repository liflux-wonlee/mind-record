/**
 * Thrown when Sign in with Apple can't run on this platform: Apple only
 * ships a native SDK for iOS (Android goes through Supabase's hosted OAuth
 * instead), and the web build doesn't offer Apple yet. Lives in its own
 * file so socialAuth.ts (native) and socialAuth.web.ts throw the same class
 * and callers can `instanceof` it whichever file the platform loaded.
 */
export class AppleSignInUnavailableError extends Error {
  constructor(message = 'Sign in with Apple is only available on iOS.') {
    super(message);
    this.name = 'AppleSignInUnavailableError';
  }
}
