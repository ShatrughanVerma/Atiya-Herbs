const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    blockList: [].concat(
      defaultConfig.resolver.blockList || [],
      // call-backend/ is the Node.js call server, not part of the app bundle
      /[\\/]call-backend[\\/].*/,
      // Native build output (the app's and each library's) changes while Gradle builds;
      // scanning it can break Metro's file map, and it never contains app JavaScript
      /[\\/]android[\\/](app[\\/])?(build|\.cxx|\.gradle)[\\/].*/,
      /[\\/]ios[\\/](build|Pods)[\\/].*/,
    ),
  },
};

module.exports = mergeConfig(defaultConfig, config);
