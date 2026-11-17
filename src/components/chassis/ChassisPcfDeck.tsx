import React, { memo } from 'react';
import { isPcfNode } from '../../audio/graph';
import { usePatchBay } from '../../hooks/usePatchBay';
import { PatchBay } from '../PatchBay';
import { PatchBayPcfPanel } from '../PatchBayPcfPanel';
import { PanelTitleBar } from '../ui/PanelChrome';
import { RackPanelChrome } from '../ui/RackPanelChrome';

export interface ChassisPcfPlateProps {
    /**
     * PCF node the plate drives. `null` (or a node that is gone from the patch)
     * falls back to the master PCF.
     */
    nodeId: string | null;
    /** A PCF key on the plate was pressed. */
    onSelectNode: (id: string) => void;
}

/**
 * The PCF filter plate (#1586): the primary panel of the chassis's PCF mode.
 * It hosts PatchBayPcfPanel — the same live controls the patch bay shows under
 * its graph — on a white rack plate, for the master PCF or a PCF placed in the
 * patch. The chassis stage provides the knob material, so the panel renders
 * its chassis skin (knobs, chassis keys, LED pattern well). Edits go straight
 * to the running PatchController, as in the patch bay.
 */
export const ChassisPcfPlate = memo(({ nodeId, onSelectNode }: ChassisPcfPlateProps) => {
    const { ready, config, pcfState, setPcf, lastRejection, clearRejection } = usePatchBay();
    const pcfNodes = config?.nodes.filter(isPcfNode) ?? [];
    const masterId = pcfNodes.find((node) => node.factory === 'masterPcf')?.id ?? null;
    const requested = nodeId !== null && pcfNodes.some((node) => node.id === nodeId) ? nodeId : null;
    const activeId = requested ?? masterId ?? pcfNodes[0]?.id ?? null;
    const state = ready && activeId ? pcfState(activeId) : null;
    const activeNode = pcfNodes.find((node) => node.id === activeId);
    const label = activeNode?.label ?? activeId ?? '';
    const masterPattern = state && !state.master && masterId ? (pcfState(masterId)?.pattern ?? null) : null;

    return (
        <div
            className="relative w-full h-full hyphon-chrome-panel hyphon-rack-surface overflow-hidden"
            data-testid="chassis-pcf-plate"
            data-pcf-node={activeId ?? undefined}
        >
            <RackPanelChrome />
            <PanelTitleBar title="PCF // Filter" />
            {/* Inset clear of the corner screws; scrolls when the plate is short. */}
            <div className="absolute inset-x-6 top-9 bottom-6 flex flex-col gap-2 overflow-y-auto">
                {pcfNodes.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="PCF node">
                        {pcfNodes.map((node) => (
                            <button
                                key={node.id}
                                type="button"
                                className="hyphon-chassis__mode-btn hyphon-pcf-plate__key"
                                aria-pressed={node.id === activeId}
                                onClick={() => onSelectNode(node.id)}
                            >
                                {node.factory === 'masterPcf' ? 'Master' : (node.label ?? node.id)}
                            </button>
                        ))}
                    </div>
                )}
                {lastRejection && (
                    <div className="hyphon-pcf-plate__alert">
                        <span role="alert">{lastRejection.message}</span>
                        <button type="button" className="hyphon-pcf-plate__note" onClick={clearRejection}>
                            Dismiss
                        </button>
                    </div>
                )}
                {state && activeId ? (
                    <PatchBayPcfPanel
                        state={state}
                        label={label}
                        masterPattern={masterPattern}
                        onEdit={(edit) => setPcf(activeId, edit)}
                    />
                ) : (
                    <p className="hyphon-pcf-plate__note" data-testid="chassis-pcf-waiting">
                        {ready ? 'No PCF in this patch' : 'PCF — waiting for audio engine'}
                    </p>
                )}
            </div>
        </div>
    );
});

ChassisPcfPlate.displayName = 'ChassisPcfPlate';

export interface ChassisPatchDeckProps {
    /** A PCF node was selected on the graph: the plate follows it. */
    onSelectPcfNode: (id: string) => void;
}

/**
 * The patch bay as the PCF mode's `side` secondary (#1586). On the chassis the
 * routing editor lives here instead of in a collapsible panel under the
 * instrument. PCF controls stay on the filter plate beside it, so the graph
 * hands PCF selections over rather than repeating the controls.
 */
export const ChassisPatchDeck = memo(({ onSelectPcfNode }: ChassisPatchDeckProps) => (
    <div
        className="hyphon-chassis__routing chassis-well"
        data-testid="chassis-patch-deck"
    >
        <PatchBay showPcfControls={false} onSelectPcfNode={onSelectPcfNode} />
    </div>
));

ChassisPatchDeck.displayName = 'ChassisPatchDeck';
