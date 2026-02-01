// Polyfill performance.now() for AudioWorklet environments
// This file is injected via --pre-js into the generated Emscripten module.

if (typeof performance === 'undefined') {
    // In AudioWorklet, globalThis is the scope.
    if (typeof globalThis !== 'undefined') {
        // @ts-ignore
        globalThis.performance = globalThis.performance || {};
        // @ts-ignore
        if (typeof globalThis.performance.now !== 'function') {
            // @ts-ignore
            globalThis.performance.now = function() { return Date.now(); };
        }
    } else if (typeof self !== 'undefined') {
        self.performance = self.performance || {};
        if (typeof self.performance.now !== 'function') {
            self.performance.now = function() { return Date.now(); };
        }
    }
}
