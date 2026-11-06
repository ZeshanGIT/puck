module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo adds the react-native-worklets (Reanimated 4) Babel plugin automatically when it is installed.
    presets: ["babel-preset-expo"],
  };
};
