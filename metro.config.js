const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Hypercore and Hyperswarm depend on Node built-ins (net, fs, crypto, dgram)
// that do not exist in the Hermes / React Native runtime. On native platforms
// we redirect these packages to no-op stubs so the app bundles and runs.
//
// What still works without these packages:
//   - SHIMI tree (MMKV-backed confidence weights)
//   - SKOS ontology navigation
//   - Trust registry (MMKV-backed)
//   - Pattern evaluator (pure functions)
//   - All local RAG via QVAC SDK
//
// What requires a native Expo module to enable on device:
//   - P2P peer discovery and feed replication (Hyperswarm)
//   - Persistent distributed knowledge feed (Hypercore)
const NODE_ONLY_PACKAGES = {
  hypercore: path.resolve(__dirname, 'stubs/hypercore.js'),
  hyperswarm: path.resolve(__dirname, 'stubs/hyperswarm.js'),
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && NODE_ONLY_PACKAGES[moduleName]) {
    return {
      filePath: NODE_ONLY_PACKAGES[moduleName],
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './src/global.css' });
