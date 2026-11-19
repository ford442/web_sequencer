import { useEffect } from 'react';
import { requestPythonEngine } from '../pyodide/pythonEngineStore';

/** True for the waveforms the Python table engine renders. */
export function isPythonWaveform(waveform: string | undefined): boolean {
    return !!waveform && waveform.startsWith('pyodide-');
}

/**
 * Load the Python engine when a part selects a `pyodide-*` waveform (a user
 * pick, a loaded project, an imported song). Nothing else starts it: a project
 * on native oscillators never fetches the runtime.
 */
export function useRequestPythonForWaveforms(waveforms: ReadonlyArray<string | undefined>): void {
    const needsPython = waveforms.some(isPythonWaveform);
    useEffect(() => {
        if (needsPython) void requestPythonEngine('pyodide-waveform');
    }, [needsPython]);
}
