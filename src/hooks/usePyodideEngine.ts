import { pythonEngineLabel, usePythonEngine } from '../pyodide/pythonEngineStore';

/**
 * The Python table engine ("Spectral Puppet") as app state.
 *
 * Observes only: it never starts the load. Python is not on the playback path,
 * so it loads when something asks — a `pyodide-*` waveform
 * (`useRequestPythonForWaveforms`), an explicit Python render or the overlay's
 * LOAD control (`requestPythonEngine`). See src/pyodide/pythonEngineStore.ts.
 */
export const usePyodideEngine = () => {
    const state = usePythonEngine();
    return {
        pyodide: state.pyodide,
        isPyodideReady: state.status === 'ready',
        pyodideStatus: pythonEngineLabel(state),
    };
};
