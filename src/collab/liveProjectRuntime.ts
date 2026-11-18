/**
 * The app's project runtime (#1597 P2): the doc every bound store writes to,
 * created once per page and attached to the Yjs-free `liveProject` handle.
 * Loaded lazily (it pulls in Yjs), by `CollabBridge`, which App mounts on
 * every page load.
 */

import { createAppBindings } from './appBindings';
import { liveProject } from './liveProject';
import { ProjectRuntime } from './runtime';

let runtime: ProjectRuntime | null = null;
let detach: () => void = () => {};

/** The page's runtime, started on first call. */
export function startLiveProject(): ProjectRuntime {
    if (runtime) return runtime;
    const r = new ProjectRuntime({ bindings: createAppBindings() });
    runtime = r;
    detach = liveProject.attach({
        edit: (scope, fn, label) => r.edit(scope, fn, label),
        editAsync: (scope, fn, label) => r.editAsync(scope, fn, label),
        // `history` is replaced when the runtime adopts a session doc; read it per call.
        undo: (editor) => r.history.undo(editor),
        redo: (editor) => r.history.redo(editor),
        canUndo: (editor) => r.history.canUndo(editor),
        canRedo: (editor) => r.history.canRedo(editor),
        jumpTo: (id) => r.history.jumpTo(id),
        beginStep: (editor) => r.history.beginStep(editor),
        beginGesture: () => r.beginGesture(),
        stepLabels: (editor) => r.history.stepLabels(editor),
        getHistorySnapshot: () => r.history.getSnapshot(),
        subscribeHistory: (listener) => r.subscribeHistory(listener),
        readField: (field) => r.readField(field),
        readSong: () => r.readSong(),
    });
    return r;
}

/** Tear the runtime down (tests). */
export function stopLiveProject(): void {
    detach();
    detach = () => {};
    runtime?.destroy();
    runtime = null;
}
