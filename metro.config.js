const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// NOTE (C2 / Fase B): Hypercore and Hyperswarm depend on Node built-ins (net,
// fs, crypto, dgram) that do not exist in the Hermes / React Native runtime, so
// they used to be redirected to no-op stubs here. As of C2 the RN side no longer
// imports them at all — the real stack runs inside the Bare worklet
// (p2p/p2p-worklet.mjs, bundled by bare-pack) and the app talks to it over IPC
// (see src/data/datasources/worklet-host.ts). The Metro resolver override and
// the stubs/ directory are gone.

module.exports = withNativeWind(config, { input: './src/global.css' });
