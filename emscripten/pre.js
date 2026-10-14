Module['locateFile'] = function(path, prefix) {
  if (path.endsWith('.wasm')) {
    return new URL(path, import.meta.url).href;
  }
  return prefix + path;
};
