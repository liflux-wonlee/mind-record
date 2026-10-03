/**
 * Android networking fix (fetch / Supabase): React Native's shared OkHttp
 * client -- which Expo's fetch also uses -- has no timeouts and never pings
 * its HTTP/2 connections. When a connection silently dies (a Wi-Fi <-> mobile
 * switch, the phone sleeping, a NAT timeout), every request to that server
 * keeps being sent down the dead connection and waits forever, so the whole
 * app hangs on loading/saving until it's restarted.
 *
 * This installs a client factory that pings HTTP/2 connections every 10 s
 * (a dead one is dropped and requests move to a fresh connection), times out
 * connecting after 15 s, and allows more requests to the same server at
 * once. The cookie jar stays React Native's (Expo's fetch module needs it).
 */
const { withMainApplication } = require('expo/config-plugins');

const IMPORTS = [
  'import com.facebook.react.modules.network.OkHttpClientFactory',
  'import com.facebook.react.modules.network.OkHttpClientProvider',
  'import java.util.concurrent.TimeUnit',
  'import okhttp3.Dispatcher',
  'import okhttp3.OkHttpClient',
];

const MARKER = '// joaassistant: network client';

const SETUP = `
    ${MARKER}
    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient =
        OkHttpClientProvider.createClientBuilder()
          .pingInterval(10, TimeUnit.SECONDS)
          .connectTimeout(15, TimeUnit.SECONDS)
          .readTimeout(180, TimeUnit.SECONDS)
          .writeTimeout(120, TimeUnit.SECONDS)
          .retryOnConnectionFailure(true)
          .dispatcher(Dispatcher().apply { maxRequestsPerHost = 16 })
          .build()
    })
`;

module.exports = function withNetworkClient(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withNetworkClient: expected a Kotlin MainApplication');
    }
    if (!src.includes(MARKER)) {
      for (const line of IMPORTS) {
        if (!src.includes(line)) src = src.replace(/^(package .*\n)/m, `$1${line}\n`);
      }
      const anchor = /super\.onCreate\(\)\n/;
      if (!anchor.test(src)) throw new Error('withNetworkClient: super.onCreate() not found in MainApplication');
      src = src.replace(anchor, (m) => m + SETUP);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
