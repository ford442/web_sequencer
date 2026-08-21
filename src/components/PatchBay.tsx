// PatchBay — node/cable editor for the audio graph.
//
// Drag from a node's output port to another node's input port to patch a send;
// click a cable to set its level or pull it. Edits go straight to the live
// PatchController, so a new send is audible without restarting the engine.
//
// Rendering is plain SVG (no graph library): the node count is small, the
// hardware look comes from the existing theme classes, and cables need custom
// hit targets anyway.

import React, { memo, useCallback, useMemo, useRef, useState } from 'react';

import { usePatchBay } from '../hooks/usePatchBay';
import { performanceBudget, BUDGET_OVERLOAD_THRESHOLD } from '../utils/performanceBudget';
import {
    cablePath,
    inputPort,
    layoutGraph,
    outputPort,
    NODE_HEIGHT,
    NODE_WIDTH,
    type GraphEdgeSpec,
} from '../audio/graph';

/** Level given to a newly patched cable — a send, not a hard-wired insert. */
const DEFAULT_SEND_LEVEL = 0.5;

/**
 * Convolution reverb is by far the most expensive node the patch bay can
 * multiply, so warn past the three the classic preset already ships.
 */
const CONVOLVER_WARN_COUNT = 3;

interface DragState {
    from: string;
    x: number;
    y: number;
}

interface SelectedCable {
    from: string;
    to: string;
}

function edgeIsSelected(edge: GraphEdgeSpec, selected: SelectedCable | null): boolean {
    return selected !== null && edge.from === selected.from && edge.to === selected.to;
}

export const PatchBay: React.FC<{ className?: string }> = memo(({ className = '' }) => {
    const {
        config,
        ready,
        needsRebuild,
        lastRejection,
        connect,
        disconnect,
        setSendLevel,
        moveNode,
        clearRejection,
    } = usePatchBay();

    const svgRef = useRef<SVGSVGElement>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const [selected, setSelected] = useState<SelectedCable | null>(null);
    const [movingNode, setMovingNode] = useState<string | null>(null);

    const layout = useMemo(() => (config ? layoutGraph(config) : null), [config]);

    // Sampled when the patch changes rather than polled: this is a hint about
    // the edit the user just made, not a live meter (that is the HUD's job).
    const budgetWarning = useMemo(() => {
        if (!config) return null;
        const convolvers = config.nodes.filter((node) => node.factory === 'convolver').length;
        const budgetPercent = performanceBudget.getState().masterBudgetPercent;
        if (budgetPercent >= BUDGET_OVERLOAD_THRESHOLD) {
            return `Audio thread at ${Math.round(budgetPercent)}% — new nodes may glitch playback`;
        }
        if (convolvers > CONVOLVER_WARN_COUNT) {
            return `${convolvers} convolution reverbs in this patch — expect high CPU`;
        }
        return null;
    }, [config]);

    const toSvgPoint = useCallback((event: React.MouseEvent): { x: number; y: number } => {
        const svg = svgRef.current;
        if (!svg) return { x: 0, y: 0 };
        const rect = svg.getBoundingClientRect();
        const scaleX = svg.viewBox.baseVal.width / rect.width || 1;
        const scaleY = svg.viewBox.baseVal.height / rect.height || 1;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        };
    }, []);

    const onCanvasMouseMove = useCallback(
        (event: React.MouseEvent) => {
            if (drag) {
                const point = toSvgPoint(event);
                setDrag({ ...drag, x: point.x, y: point.y });
                return;
            }
            if (movingNode) {
                const point = toSvgPoint(event);
                moveNode(movingNode, {
                    x: Math.max(0, point.x - NODE_WIDTH / 2),
                    y: Math.max(0, point.y - NODE_HEIGHT / 2),
                });
            }
        },
        [drag, movingNode, moveNode, toSvgPoint],
    );

    const endDrag = useCallback(() => {
        setDrag(null);
        setMovingNode(null);
    }, []);

    const onDropOnInput = useCallback(
        (targetId: string) => {
            if (!drag) return;
            const from = drag.from;
            setDrag(null);
            if (from === targetId) return;
            connect(from, targetId, DEFAULT_SEND_LEVEL);
        },
        [drag, connect],
    );

    if (!ready || !config || !layout) {
        return (
            <section
                className={`hyphon-chrome-panel p-3 ${className}`}
                aria-label="Patch bay"
            >
                <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                    Patch bay — waiting for audio engine
                </p>
            </section>
        );
    }

    const selectedEdge = selected
        ? config.edges.find((edge) => edge.from === selected.from && edge.to === selected.to)
        : undefined;

    return (
        <section className={`hyphon-chrome-panel flex flex-col gap-2 p-3 ${className}`} aria-label="Patch bay">
            <header className="flex items-center justify-between gap-3">
                <h2 className="font-orbitron text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                    Patch Bay
                </h2>
                <span className="font-mono text-[9px] uppercase tracking-widest text-gray-500">
                    {config.name}
                </span>
            </header>

            {lastRejection && (
                <div
                    role="alert"
                    className="flex items-center justify-between gap-2 rounded border border-red-500/40 bg-red-950/40 px-2 py-1"
                >
                    <span className="font-mono text-[10px] text-red-300">{lastRejection.message}</span>
                    <button
                        type="button"
                        onClick={clearRejection}
                        className="font-mono text-[9px] uppercase text-red-400 hover:text-red-200"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {budgetWarning && (
                <p className="font-mono text-[9px] uppercase tracking-wide text-amber-400">
                    {budgetWarning}
                </p>
            )}

            {needsRebuild && (
                <p className="font-mono text-[9px] uppercase tracking-wide text-amber-400">
                    Some changes apply on the next engine restart
                </p>
            )}

            <div className="hyphon-inset-well overflow-auto">
                <svg
                    ref={svgRef}
                    role="application"
                    aria-label="Audio routing graph"
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    width={layout.width}
                    height={layout.height}
                    className="min-w-full"
                    onMouseMove={onCanvasMouseMove}
                    onMouseUp={endDrag}
                    onMouseLeave={endDrag}
                >
                    {/* Cables first so nodes sit on top of them. */}
                    {config.edges.map((edge) => {
                        const fromLayout = layout.nodes.get(edge.from);
                        const toLayout = layout.nodes.get(edge.to);
                        if (!fromLayout || !toLayout) return null;
                        const path = cablePath(outputPort(fromLayout), inputPort(toLayout));
                        const active = edgeIsSelected(edge, selected);
                        const level = edge.gain ?? 1;
                        return (
                            <g key={`${edge.from}->${edge.to}`}>
                                {/* Fat invisible stroke = forgiving hit target. */}
                                <path
                                    d={path}
                                    stroke="transparent"
                                    strokeWidth={12}
                                    fill="none"
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => setSelected({ from: edge.from, to: edge.to })}
                                />
                                <path
                                    d={path}
                                    stroke={
                                        active ? '#22d3ee' : edge.feedback ? '#f472b6' : '#3f4a56'
                                    }
                                    strokeWidth={active ? 2.5 : 1 + level * 1.5}
                                    fill="none"
                                    pointerEvents="none"
                                />
                            </g>
                        );
                    })}

                    {/* In-flight cable while dragging. */}
                    {drag &&
                        (() => {
                            const fromLayout = layout.nodes.get(drag.from);
                            if (!fromLayout) return null;
                            return (
                                <path
                                    d={cablePath(outputPort(fromLayout), { x: drag.x, y: drag.y })}
                                    stroke="#22d3ee"
                                    strokeWidth={2}
                                    strokeDasharray="4 3"
                                    fill="none"
                                    pointerEvents="none"
                                />
                            );
                        })()}

                    {config.nodes.concat(
                        config.nodes.some((node) => node.id === 'destination')
                            ? []
                            : [{ id: 'destination', factory: 'destination', label: 'Output', fixed: true }],
                    ).map((node) => {
                        const place = layout.nodes.get(node.id);
                        if (!place) return null;
                        const label = node.label ?? node.id;
                        return (
                            <g key={node.id}>
                                <rect
                                    x={place.x}
                                    y={place.y}
                                    width={NODE_WIDTH}
                                    height={NODE_HEIGHT}
                                    rx={6}
                                    fill="#0d1014"
                                    stroke={node.fixed ? '#22d3ee33' : '#a855f766'}
                                    strokeWidth={1}
                                    style={{ cursor: 'grab' }}
                                    onMouseDown={() => setMovingNode(node.id)}
                                />
                                <text
                                    x={place.x + NODE_WIDTH / 2}
                                    y={place.y + NODE_HEIGHT / 2 + 3}
                                    textAnchor="middle"
                                    className="font-mono"
                                    fontSize={9}
                                    fill="#cbd5e1"
                                    pointerEvents="none"
                                >
                                    {label}
                                </text>

                                {/* Input port */}
                                <circle
                                    cx={place.x}
                                    cy={place.y + NODE_HEIGHT / 2}
                                    r={5}
                                    fill={drag ? '#22d3ee' : '#1a2026'}
                                    stroke="#22d3ee66"
                                    style={{ cursor: 'crosshair' }}
                                    aria-label={`${label} input`}
                                    onMouseUp={() => onDropOnInput(node.id)}
                                >
                                    <title>{`${label} input`}</title>
                                </circle>

                                {/* Output port */}
                                <circle
                                    cx={place.x + NODE_WIDTH}
                                    cy={place.y + NODE_HEIGHT / 2}
                                    r={5}
                                    fill="#1a2026"
                                    stroke="#a855f7aa"
                                    style={{ cursor: 'crosshair' }}
                                    aria-label={`${label} output`}
                                    onMouseDown={(event) => {
                                        const point = toSvgPoint(event);
                                        setDrag({ from: node.id, x: point.x, y: point.y });
                                    }}
                                >
                                    <title>{`${label} output`}</title>
                                </circle>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {selectedEdge ? (
                <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-gray-300">
                        {selectedEdge.from} → {selectedEdge.to}
                    </span>
                    <label className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase text-gray-400">
                        Level
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={selectedEdge.gain ?? 1}
                            onChange={(event) =>
                                setSendLevel(selectedEdge.from, selectedEdge.to, Number(event.target.value))
                            }
                            aria-label={`Send level ${selectedEdge.from} to ${selectedEdge.to}`}
                            className="w-28"
                        />
                        <span className="w-8 text-right text-gray-200">
                            {(selectedEdge.gain ?? 1).toFixed(2)}
                        </span>
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            disconnect(selectedEdge.from, selectedEdge.to);
                            setSelected(null);
                        }}
                        className="rounded border border-red-500/40 px-1.5 py-0.5 font-mono text-[9px] uppercase text-red-300 hover:bg-red-900/40"
                    >
                        Unpatch
                    </button>
                </div>
            ) : (
                <p className="font-mono text-[9px] uppercase tracking-wide text-gray-500">
                    Drag an output port onto an input port to patch a send
                </p>
            )}
        </section>
    );
});

PatchBay.displayName = 'PatchBay';
