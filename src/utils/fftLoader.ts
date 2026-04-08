// @mode: bridge
// FFT WASM Module Loader
// 
// This file handles loading and initialization of the FFT WASM module.
// The heavy DSP logic is in assembly/fft.ts. This file provides:
// - WASM loading and initialization
// - Module caching for multiple FFT instances
// - Error handling and fallback paths

// Import the WASM module with Vite's ?init query
import initFFT from '../wasm/fft.wasm?init';

let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;
let isLoading = false;
let loadPromise: Promise<WebAssembly.Instance> | null = null;

/**
 * Load and initialize the FFT WASM module
 * @returns Promise that resolves to the WASM instance
 */
export async function loadFFTModule(): Promise<WebAssembly.Instance> {
    // Return cached instance if available
    if (wasmInstance) {
        return wasmInstance;
    }

    // Return existing promise if loading is in progress
    if (loadPromise) {
        return loadPromise;
    }

    isLoading = true;
    loadPromise = initFFT({
        env: {
            abort: () => {}
        }
    }).then((instance: WebAssembly.Instance) => {
        wasmInstance = instance;
        wasmMemory = instance.exports.memory as WebAssembly.Memory;
        isLoading = false;
        return instance;
    }).catch((error: Error) => {
        isLoading = false;
        loadPromise = null;
        console.error('FFT WASM module initialization failed:', error);
        throw error;
    });

    return loadPromise;
}

/**
 * Check if the FFT WASM module is loaded and ready
 * @returns true if module is loaded
 */
export function isFFTModuleLoaded(): boolean {
    return wasmInstance !== null && wasmMemory !== null;
}

/**
 * Get the WASM memory buffer
 * @returns WebAssembly.Memory or null if not loaded
 */
export function getFFTMemory(): WebAssembly.Memory | null {
    return wasmMemory;
}

/**
 * Get the WASM instance exports
 * @returns WebAssembly.Instance exports or null if not loaded
 */
export function getFFTExports(): any {
    return wasmInstance?.exports || null;
}

/**
 * Reset the WASM module (useful for testing)
 */
export function resetFFTModule(): void {
    wasmInstance = null;
    wasmMemory = null;
    loadPromise = null;
    isLoading = false;
}

/**
 * Wait for the FFT module to be loaded
 * @param timeoutMs Maximum time to wait in milliseconds
 * @returns Promise that resolves when module is loaded
 */
export async function waitForFFTModule(timeoutMs: number = 5000): Promise<boolean> {
    if (isFFTModuleLoaded()) {
        return true;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        if (isFFTModuleLoaded()) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return false;
}
