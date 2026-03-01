// Post-JS shim to avoid calling into WASM when forming unbound type names.
// Some builds cause __getTypeName to return invalid pointers which causes an
// immediate abort while trying to create an error message. Replace
// `getTypeName` with a safe JS-only implementation and wrap
// `throwUnboundTypeError` as a fallback.
(function() {
  try {
    // Replace getTypeName with a safe function that never calls into WASM.
    // This avoids triggering unsafe strdup/strlen operations inside the
    // module when there are unbound types.
    getTypeName = function(type) {
      return (typeof type === 'number') ? ('type#' + type) : String(type);
    };

    // Also wrap throwUnboundTypeError to ensure a readable error if something
    // else goes wrong.
    var orig = throwUnboundTypeError;
    throwUnboundTypeError = function(message, types) {
      try {
        return orig(message, types);
      } catch (e) {
        var typeStrings = types.map(function(t) { return (typeof t === 'number') ? ('type#' + t) : String(t); });
        throw new Error(message + ': ' + typeStrings.join(', '));
      }
    };
  } catch (e) {
    // If variables aren't defined yet, do nothing; post-js runs after module
    // code, so these should normally exist.
  }
})();
