import { useEffect } from 'react';
import { requestPythonEngine } from '../pyodide/pythonEngineStore';

/** True for the waveforms the Python table engine renders. */
export function isPythonWaveform(waveform: string | undefined): boolean {
    return !!waveform && waveform.startsWith('pyodide-');
}

/**
 * Load the Python engine when a part selects a `pyodide-*` waveform or the Pyodide
 * filter source (#1676) — a user pick, a loaded project, an imported song. Nothing
 * else starts it: a project on native oscillators and filters never fetches the
 * runtime.
 */
export function useRequestPythonForWaveforms(
    waveforms: ReadonlyArray<string | undefined>,
    filterSources: ReadonlyArray<string | undefined> = [],
): void {
    const needsWaveform = waveforms.some(isPythonWaveform);
    const needsFilter = filterSources.some((s) => s === 'pyodide');
    useEffect(() => {
        if (needsWaveform) void requestPythonEngine('pyodide-waveform');
        else if (needsFilter) void requestPythonEngine('pyodide-filter');
    }, [needsWaveform, needsFilter]);
}
