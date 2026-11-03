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
    type LowpassFilterMode,
    type LowpassModeStatus,
    type PatchController,
    type PcfNodeEdit,
    type PcfNodeState,
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
    /** A/B a low-pass node between RBJ and openrb (live when it is running). */
    setLowpassMode: (id: string, mode: LowpassFilterMode) => boolean;
    /** Requested vs. audible mode of a low-pass node; `null` for other nodes. */
    lowpassStatus: (id: string) => LowpassModeStatus | null;
    /** Edit a PCF node (master or placed): knobs, pattern, lanes, mode. */
    setPcf: (id: string, edit: PcfNodeEdit) => boolean;
    /** A PCF node's settings and what it plays; `null` for other nodes. */
    pcfState: (id: string) => PcfNodeState | null;
    clearRejection: () => void;
}

export function usePatchBay(): UsePatchBayResult {
    const [controller, setController] = useState<PatchController | null>(null);
    const [config, setConfig] = useState<AudioGraphConfig | null>(null);
    const [needsRebuild, setNeedsRebuild] = useState(false);
    const [lastRejection, setLastRejection] = useState<GraphValidationIssue | null>(null);

    useEffect(() => subscribeActivePatchController(setController), []);

    useEffect(() => {
        if (!controller) return;
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
            config: controller ? config : null,
            ready: controller !== null,
            needsRebuild: controller ? needsRebuild : false,
            lastRejection,
            connect: (from, to, gain) => run((patch) => patch.connect(from, to, gain)),
            disconnect: (from, to) => run((patch) => patch.disconnect(from, to)),
            setSendLevel: (from, to, gain) => run((patch) => patch.setSendLevel(from, to, gain)),
            addNode: (node) => run((patch) => patch.addNode(node)),
            removeNode: (id) => run((patch) => patch.removeNode(id)),
            moveNode: (id, position) => controller?.moveNode(id, position),
            setLowpassMode: (id, mode) => run((patch) => patch.setLowpassMode(id, mode)),
            lowpassStatus: (id) => controller?.lowpassStatus(id) ?? null,
            setPcf: (id, edit) => run((patch) => patch.setPcf(id, edit)),
            pcfState: (id) => controller?.pcfState(id) ?? null,
            clearRejection: () => setLastRejection(null),
        }),
        [config, controller, needsRebuild, lastRejection, run],
    );
}
