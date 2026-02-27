// Ensure the minified import module name 'a' is present when instantiating wasm.
// This covers cases where the linker minified imported module names to 'a'.
(function(){
  try {
    if (typeof getWasmImports === 'function') {
      var _old = getWasmImports;
      getWasmImports = function() {
        var imports = _old();
        // if minified imports expect 'a', mirror env -> a
        try {
          if (!Object.prototype.hasOwnProperty.call(imports, 'a')) {
            if (typeof imports.env !== 'undefined') {
              imports.a = imports.env;
            } else if (typeof wasmImports !== 'undefined') {
              imports.a = wasmImports;
            }
          }
        } catch (e) {
          // ignore
        }
        return imports;
      };
    }
  } catch (e) {
    // no-op
  }
})();
