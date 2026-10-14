/**
 * Pyodide bootstrap for the "Spectral Puppet" Python engine.
 *
 * This used to be emscripten/pyodide_bootstrap.js, glued onto the pthread
 * hyphon_native.js as `--post-js` and kicked off by a C++ main() calling
 * emscripten_run_script(). The voice module and the Python runtime shared a
 * binary for no technical reason: the main thread instantiated the threaded
 * voice wasm (and its pthread pool) only to reach this code. It is now a plain
 * ES module that usePyodideEngine imports lazily, so the Python source and this
 * loader live in their own chunk and hyphon_native is --no-entry on both
 * threading profiles (docs/wasm/BUILD_NOTES.md#pyodide-split).
 *
 * The contract with the rest of the app is unchanged: `globalThis.hyphonPyodide`
 * / `hyphonPyodideReady` plus the `hyphon-pyodide-ready` / `hyphon-pyodide-error`
 * window events.
 */
import PYTHON_SOURCE from './hyphon_engine.py?raw';

interface LoadedPyodide {
    loadPackage(names: string[]): Promise<unknown>;
    runPythonAsync(code: string): Promise<unknown>;
}

type LoadPyodide = (options: { indexURL: string }) => Promise<LoadedPyodide>;

const g = globalThis as typeof globalThis & {
    loadPyodide?: LoadPyodide;
    hyphonPyodideLoading?: boolean;
    HYPHON_PYODIDE_BASE_URL?: string;
};

/**
 * Where the vendored runtime lives. Same origin and base-path aware; nothing is
 * fetched from a CDN (ADR 0001: same-origin script-src, offline deploys).
 * public/pyodide/ is populated by `pnpm run vendor:pyodide` and is gitignored.
 * `HYPHON_PYODIDE_BASE_URL` stays as an override for embedders.
 */
export function pyodideBaseUrl(): string {
    return g.HYPHON_PYODIDE_BASE_URL ?? `${import.meta.env.BASE_URL}pyodide/`;
}

function loadPyodideScript(base: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${base}pyodide.js`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(
            `Pyodide runtime not found at ${base}pyodide.js. ` +
            'Run `pnpm run vendor:pyodide` to vendor it (it is not fetched from a CDN).',
        ));
        document.head.appendChild(script);
    });
}

/** Load Pyodide + numpy/scipy and the engine source once per page. */
export async function initPyodideSystem(): Promise<void> {
    if (g.hyphonPyodideLoading || g.hyphonPyodideReady) return;
    g.hyphonPyodideLoading = true;

    try {
        const base = pyodideBaseUrl();
        if (!g.loadPyodide) await loadPyodideScript(base);

        // indexURL must point at the vendored copy too, or Pyodide derives its own
        // asset base from the script URL and can still escape same-origin.
        const pyodide = await g.loadPyodide!({ indexURL: base });
        await pyodide.loadPackage(['numpy', 'scipy']);
        await pyodide.runPythonAsync(PYTHON_SOURCE);

        g.hyphonPyodide = pyodide;
        g.hyphonPyodideReady = true;
        window.dispatchEvent(new CustomEvent('hyphon-pyodide-ready'));
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[pyodide] bootstrap failed:', e);
        g.hyphonPyodideReady = false;
        g.hyphonPyodideLoading = false;
        window.dispatchEvent(new CustomEvent('hyphon-pyodide-error', {
            detail: { reason: 'Pyodide bootstrap failed', error: message },
        }));
    }
}
