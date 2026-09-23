// Default Expo Metro config, plus one Windows-only change.
//
// Local Android release builds on Windows (npx expo run:android --variant
// release) kept dying partway through bundling -- at a different
// percentage each time -- with node.exe exiting 0xC0000005 (access
// violation) and no JS error at all, on Node 24 LTS. That pattern points
// at Metro's parallel transform workers crashing, not at the app code (the
// same code bundles fine elsewhere), so on Windows bundle with a single
// worker: slower, but it finishes. Other platforms keep the default.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.platform === 'win32') {
  config.maxWorkers = 1;
}

module.exports = config;
