// usePatchBay — React binding for the active PatchController.
//
// The controller owns the config; this hook mirrors it into state and exposes
// the edit operations with their rejection reasons, so the editor can show why
// a cable was refused instead of silently dropping it.

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    subscribeActivePatchController,
    type AudioGraphConfig,
    type GraphNodeSpec,
    type GraphValidationIssue,
    type PatchController,
} from '../audio/graph';

export interface UsePatchBayResult {
    config: AudioGraphConfig | null;
    /** True once the engine has published a controller. */
    ready: boolean;
    /** True when edits are staged that need an engine restart to be heard. */
    needsRebuild: boolean;
    /** Most recent refusal, cleared on the next successful edit. */
    lastRejection: GraphValidationIssue | null;
    connect: (from: string, to: string, gain?: number) => boolean;
    disconnect: (from: string, to: string) => boolean;
    setSendLevel: (from: string, to: string, gain: number) => boolean;
    addNode: (node: GraphNodeSpec) => boolean;
    removeNode: (id: string) => boolean;
    moveNode: (id: string, position: { x: number; y: number }) => void;
    clearRejection: () => void;
}

export function usePatchBay(): UsePatchBayResult {
    const [controller, setController] = useState<PatchController | null>(null);
    const [config, setConfig] = useState<AudioGraphConfig | null>(null);
    const [needsRebuild, setNeedsRebuild] = useState(false);
    const [lastRejection, setLastRejection] = useState<GraphValidationIssue | null>(null);

    useEffect(() => subscribeActivePatchController(setController), []);

    useEffect(() => {
        if (!controller) {
            setConfig(null);
            setNeedsRebuild(false);
            return;
        }
        return controller.subscribe((next) => {
            // The controller hands back the same object identity only when
            // nothing changed, so a shallow copy keeps React re-rendering.
            setConfig({ ...next });
            setNeedsRebuild(controller.needsRebuild());
        });
    }, [controller]);

    const run = useCallback(
        (operation: (patch: PatchController) => { ok: boolean; rejected?: GraphValidationIssue }) => {
            if (!controller) return false;
            const outcome = operation(controller);
            setLastRejection(outcome.ok ? null : (outcome.rejected ?? null));
            setNeedsRebuild(controller.needsRebuild());
            return outcome.ok;
        },
        [controller],
    );

    return useMemo<UsePatchBayResult>(
        () => ({
            config,
            ready: controller !== null,
            needsRebuild,
            lastRejection,
            connect: (from, to, gain) => run((patch) => patch.connect(from, to, gain)),
            disconnect: (from, to) => run((patch) => patch.disconnect(from, to)),
            setSendLevel: (from, to, gain) => run((patch) => patch.setSendLevel(from, to, gain)),
            addNode: (node) => run((patch) => patch.addNode(node)),
            removeNode: (id) => run((patch) => patch.removeNode(id)),
            moveNode: (id, position) => controller?.moveNode(id, position),
            clearRejection: () => setLastRejection(null),
        }),
        [config, controller, needsRebuild, lastRejection, run],
    );
}
