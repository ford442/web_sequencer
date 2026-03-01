// Ensure a wasmTable exists early during Wasm instantiation so embind
// registrations that run during module startup can call wasmTable.get()
// without throwing "wasmTable.get is not a function".
(function(){
  try {
    if (typeof wasmTable === 'undefined' || !wasmTable || typeof wasmTable.get !== 'function') {
      // Try to create a real WebAssembly.Table. Use a reasonably small initial
      // size; it will be replaced by the real module export once instantiation
      // completes.
      wasmTable = new WebAssembly.Table({ initial: 64, element: 'anyfunc' });
    }
  } catch (e) {
    // Fallback: create a small JS array with get/set/grow shims so code that
    // expects a WebAssembly.Table still works.
    if (typeof wasmTable === 'undefined' || !wasmTable || typeof wasmTable.get !== 'function') {
      var _table = [];
      _table.get = function(i){ return this[i]; };
      _table.set = function(i, v){ this[i] = v; };
      _table.grow = function(n){ for(var i=0;i<n;i++) this.push(undefined); return this.length; };
      Object.defineProperty(_table, 'length', {
        get: function(){ return Array.prototype.length.call(this); }
      });
      wasmTable = _table;
    }
  }
})();
