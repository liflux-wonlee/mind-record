/**
 * Dynamic layer over app.json (which stays the source of truth).
 *
 * Android push (FCM) needs google-services.json from the Firebase project
 * for com.liflux.mindrecord. It is a per-environment file that is NOT
 * committed (see .gitignore): put it at ./google-services.json locally, or
 * provide it to EAS as a file environment variable named
 * GOOGLE_SERVICES_JSON. Builds without it still work -- they just can't
 * receive push notifications on Android.
 */
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON;
  const local = path.join(__dirname, 'google-services.json');
  const googleServicesFile = fromEnv && fs.existsSync(fromEnv) ? fromEnv : fs.existsSync(local) ? './google-services.json' : undefined;
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
