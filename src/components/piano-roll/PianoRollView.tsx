/**
 * Piano roll for one melodic track (#1345 Phase 1). Props-driven: the panel
 * container (PianoRollPanel) feeds it the track's committed steps and the
 * commit/paste handlers; this component owns only view state (selection,
 * cursor, grid, zoom, tool).
 *
 * Layout: a native scroller sized to the content, with the canvas pair kept
 * in view by `position: sticky` — the canvases draw the visible window at
 * the scroll offset, so trackpads, wheels and scrollbars all behave
 * natively. A focusable `role="application"` overlay takes pointer and
 * keyboard input; screen readers hear every cursor move and edit through the
 * shared announcer.
 */
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '@/types';
import type { ScaleDefinition } from '@/utils/musicTheory';
import { a11yAnnouncerStore } from '@/stores/a11yAnnouncerStore';
import { PIANO_ROLL_TRACKS, type PianoRollTarget } from '@/stores/pianoRollStore';
import { MAX_PITCH, pitchRange, stepsToRollNotes, type Steps } from './model/rollModel';
import type { LaneProperty } from './model/rollEdits';
import { contentSize, DEFAULT_LAYOUT, gridRect, scrollYForPitch } from './model/rollGeometry';
import { passesThrough, resolveRollKey, ROLL_KEYBOARD_HELP } from './model/rollKeyboard';
import { hexToRgb } from './render/rollScene';
import { useRollPainter, type SceneInputWithoutLayout } from './render/useRollPainter';
import { useRollEditor } from './useRollEditor';
import { usePianoRollPointer, type RollTool } from './usePianoRollPointer';

export interface GhostSource {
    key: string;
    steps: Steps;
}

export interface PianoRollViewProps {
    target: PianoRollTarget;
    trackLabel: string;
    /** Labels for the track switcher (`partA` → "Lead", …). */
    trackLabels: Record<PianoRollTarget['track'], string>;
    color: string;
    steps: Steps;
    /** Other melodic tracks, drawn dimmed when "Ghosts" is on. */
    ghostSources: readonly GhostSource[];
    columns: number;
    loopLength: number;
    stepsPerBeat: number;
    stepsPerBar: number;
    scale: ScaleDefinition | null;
    clipboard: (Note | null)[] | null;
    onCommit: (steps: Steps) => void;
    onCopy: (clip: (Note | null)[]) => void;
    onPaste: (clip: (Note | null)[], targetStep: number) => void;
    onSelectTarget: (target: PianoRollTarget) => void;
    onClose: () => void;
}

const GRID_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 1, label: '1/16' },
    { value: 0.5, label: '1/32' },
    { value: 0.25, label: '1/64' },
];

const LANE_OPTIONS: ReadonlyArray<{ value: LaneProperty; label: string }> = [
    { value: 'velocity', label: 'Velocity' },
    { value: 'probability', label: 'Probability' },
    { value: 'timbre', label: 'Timbre' },
];

const MIN_ZOOM = 10;
const MAX_ZOOM = 80;
const KEY_LABEL_PITCHES = Array.from({ length: 11 }, (_, i) => i * 12);

const announce = (message: string) => a11yAnnouncerStore.announce(message);

function centerPitch(steps: Steps): number {
    const range = pitchRange(stepsToRollNotes(steps));
    return range ? Math.round((range.low + range.high) / 2) : 60;
}

const toolButton = (active: boolean) =>
    `px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
        active ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-[#11151b] border-gray-700 text-gray-300 hover:text-white'
    }`;

export const PianoRollView = memo((props: PianoRollViewProps) => {
    const { target, steps, columns, scale } = props;
    const helpId = useId();
    const scrollerRef = useRef<HTMLDivElement>(null);
    const stickyRef = useRef<HTMLDivElement>(null);
    const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
    const canvas2dRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const labelsRef = useRef<HTMLDivElement>(null);
    const baseInputRef = useRef<SceneInputWithoutLayout | null>(null);

    const [tool, setTool] = useState<RollTool>('draw');
    const [grid, setGrid] = useState(1);
    const [laneProperty, setLaneProperty] = useState<LaneProperty>('velocity');
    const [scaleLock, setScaleLock] = useState(false);
    const [showGhosts, setShowGhosts] = useState(false);
    const [pxPerStep, setPxPerStep] = useState(DEFAULT_LAYOUT.pxPerStep);
    const [focused, setFocused] = useState(false);

    const { painter, backend } = useRollPainter(gpuCanvasRef, canvas2dRef);
    const maxSteps = Math.max(1, columns);
    // Where the roll opens: the middle of the track's notes (or middle C).
    // Keyed on the track, so later edits never move the view.
    const targetKey = `${target.track}:${target.bank}`;
    const [opening, setOpening] = useState(() => ({ key: targetKey, pitch: centerPitch(steps) }));
    if (opening.key !== targetKey) setOpening({ key: targetKey, pitch: centerPitch(steps) });
    const initialPitch = opening.pitch;

    const editor = useRollEditor({
        resetKey: targetKey,
        steps,
        maxSteps,
        grid,
        scale,
        scaleLock: scaleLock && !!scale,
        clipboard: props.clipboard,
        initialPitch,
        onCommit: props.onCommit,
        onCopy: props.onCopy,
        onPaste: props.onPaste,
        onClose: props.onClose,
        announce,
    });

    const ghosts = useMemo(
        () => (showGhosts ? props.ghostSources.flatMap((g) => stepsToRollNotes(g.steps)) : undefined),
        [showGhosts, props.ghostSources],
    );
    const color = useMemo(() => hexToRgb(props.color), [props.color]);

    // Scene input as React state sees it (drags overlay their preview on it).
    useEffect(() => {
        const input: SceneInputWithoutLayout = {
            notes: editor.notes,
            selected: editor.selectedIds,
            ghosts,
            color,
            columns,
            loopLength: Math.min(props.loopLength, columns),
            stepsPerBeat: props.stepsPerBeat,
            stepsPerBar: props.stepsPerBar,
            scale,
            laneProperty,
            cursor: focused ? { position: editor.cursor.position, pitch: editor.cursor.pitch, width: grid } : null,
            marquee: null,
        };
        baseInputRef.current = input;
        painter.setInput(input);
    }, [painter, editor.notes, editor.selectedIds, editor.cursor, ghosts, color, columns, props.loopLength, props.stepsPerBeat, props.stepsPerBar, scale, laneProperty, focused, grid]);

    useEffect(() => {
        painter.playheadTrack = target.track;
        painter.invalidate();
    }, [painter, target.track]);

    useEffect(() => {
        painter.setLayout({ pxPerStep });
    }, [painter, pxPerStep]);

    // Viewport size → sticky wrapper + painter layout.
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        const sticky = stickyRef.current;
        if (!scroller || !sticky) return;
        const sync = () => {
            const width = scroller.clientWidth;
            const height = scroller.clientHeight;
            sticky.style.width = `${width}px`;
            sticky.style.height = `${height}px`;
            painter.setLayout({ width, height });
        };
        sync();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(sync);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, [painter]);

    const syncScroll = useCallback(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        painter.setLayout({ scrollX: scroller.scrollLeft, scrollY: scroller.scrollTop });
        if (labelsRef.current) labelsRef.current.style.transform = `translateY(${-scroller.scrollTop}px)`;
    }, [painter]);

    // Open on the notes (or middle C).
    useLayoutEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        scroller.scrollTop = scrollYForPitch({ ...painter.layout, height: scroller.clientHeight }, initialPitch);
        scroller.scrollLeft = 0;
        syncScroll();
    }, [painter, initialPitch, syncScroll]);

    // Keep the keyboard cursor in view.
    useEffect(() => {
        const scroller = scrollerRef.current;
        if (!scroller || !focused) return;
        const l = painter.layout;
        const g = gridRect(l);
        const x = editor.cursor.position * l.pxPerStep;
        const y = (MAX_PITCH - editor.cursor.pitch) * l.rowHeight;
        if (x < scroller.scrollLeft) scroller.scrollLeft = x;
        else if (x + l.pxPerStep > scroller.scrollLeft + g.w) scroller.scrollLeft = x + l.pxPerStep - g.w;
        if (y < scroller.scrollTop) scroller.scrollTop = y;
        else if (y + l.rowHeight > scroller.scrollTop + g.h) scroller.scrollTop = y + l.rowHeight - g.h;
    }, [painter, editor.cursor, focused]);

    const pointer = usePianoRollPointer({
        overlayRef,
        painter,
        baseInputRef,
        steps,
        selection: editor.selection,
        setSelection: editor.setSelection,
        apply: editor.apply,
        tool,
        grid,
        maxSteps,
        laneProperty,
        scale,
        scaleLock: scaleLock && !!scale,
        announce,
        onCursor: (position, pitch) => editor.setCursor({ position, pitch }),
    });

    const onKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (passesThrough(e)) return;
        // Everything else stays in the roll: no tape stop on Escape, no grid
        // clear on Delete, no PC-keyboard notes while editing.
        e.stopPropagation();
        const command = resolveRollKey(e, grid);
        if (!command) return;
        e.preventDefault();
        editor.run(command);
    }, [editor, grid]);

    const size = contentSize({ ...painter.layout, pxPerStep }, columns);
    const hasSelection = editor.selection.length > 0;
    const runAction = (type: 'quantize' | 'duplicate' | 'delete' | 'lockToScale') => () => editor.run({ type });
    const noteCount = editor.notes.length;

    return (
        <section
            aria-label={`Piano roll, ${props.trackLabel}`}
            data-testid="piano-roll"
            data-backend={backend}
            className="hyphon-chrome-panel fixed inset-x-0 bottom-10 z-40 flex flex-col h-[min(62vh,580px)] bg-[#0a0c0f] border-t border-cyan-900/40 shadow-[0_-8px_32px_rgba(0,0,0,0.6)]"
            onKeyDown={(e) => {
                // Escape anywhere in the panel closes it, never tape-stops.
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (e.target === overlayRef.current) return;
                    e.preventDefault();
                    props.onClose();
                }
            }}
        >
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-cyan-900/30 bg-[#0d1014] shrink-0">
                <h2 className="font-orbitron font-bold text-cyan-400 tracking-[0.18em] text-sm mr-1">PIANO ROLL</h2>
                <div role="group" aria-label="Track" className="flex gap-1">
                    {PIANO_ROLL_TRACKS.map((track) => (
                        <button
                            key={track}
                            type="button"
                            aria-pressed={target.track === track}
                            className={toolButton(target.track === track)}
                            onClick={() => props.onSelectTarget({ track, bank: track === 'sampler' ? target.bank : 0 })}
                        >
                            {props.trackLabels[track]}
                        </button>
                    ))}
                </div>
                {target.track === 'sampler' && (
                    <label className="flex items-center gap-1 text-[10px] font-mono text-gray-400">
                        Bank
                        <select
                            value={target.bank}
                            onChange={(e) => props.onSelectTarget({ track: 'sampler', bank: Number(e.target.value) })}
                            className="bg-[#11151b] border border-gray-700 rounded text-gray-200 text-[10px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        >
                            {Array.from({ length: 8 }, (_, i) => (
                                <option key={i} value={i}>{`SMP ${i + 1}`}</option>
                            ))}
                        </select>
                    </label>
                )}
                <div role="group" aria-label="Tool" className="flex gap-1 ml-2">
                    <button type="button" aria-pressed={tool === 'draw'} className={toolButton(tool === 'draw')} onClick={() => setTool('draw')}>Draw</button>
                    <button type="button" aria-pressed={tool === 'select'} className={toolButton(tool === 'select')} onClick={() => setTool('select')}>Select</button>
                </div>
                <label className="flex items-center gap-1 text-[10px] font-mono text-gray-400">
                    Grid
                    <select
                        value={grid}
                        onChange={(e) => setGrid(Number(e.target.value))}
                        className="bg-[#11151b] border border-gray-700 rounded text-gray-200 text-[10px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                        {GRID_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                </label>
                <label className="flex items-center gap-1 text-[10px] font-mono text-gray-400">
                    Lane
                    <select
                        value={laneProperty}
                        onChange={(e) => setLaneProperty(e.target.value as LaneProperty)}
                        className="bg-[#11151b] border border-gray-700 rounded text-gray-200 text-[10px] px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                        {LANE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                    </select>
                </label>
                <button
                    type="button"
                    aria-pressed={scaleLock && !!scale}
                    disabled={!scale}
                    title={scale ? `Snap pitches to ${scale.root} ${scale.scale}` : 'Pick a scale in the transport bar to enable'}
                    className={`${toolButton(scaleLock && !!scale)} disabled:opacity-40`}
                    onClick={() => setScaleLock((v) => !v)}
                >
                    Scale lock
                </button>
                <button type="button" aria-pressed={showGhosts} className={toolButton(showGhosts)} onClick={() => setShowGhosts((v) => !v)}>
                    Ghosts
                </button>
                <div role="group" aria-label="Edit selection" className="flex gap-1 ml-2">
                    <button type="button" disabled={!hasSelection} className={`${toolButton(false)} disabled:opacity-40`} onClick={runAction('quantize')}>Quantize</button>
                    <button type="button" disabled={!hasSelection} className={`${toolButton(false)} disabled:opacity-40`} onClick={runAction('duplicate')}>Duplicate</button>
                    <button type="button" disabled={!hasSelection || !scale} className={`${toolButton(false)} disabled:opacity-40`} onClick={runAction('lockToScale')}>To scale</button>
                    <button type="button" disabled={!hasSelection} className={`${toolButton(false)} disabled:opacity-40`} onClick={runAction('delete')}>Delete</button>
                </div>
                <div role="group" aria-label="Zoom" className="flex gap-1 ml-2">
                    <button type="button" aria-label="Zoom out" className={toolButton(false)} disabled={pxPerStep <= MIN_ZOOM} onClick={() => setPxPerStep((z) => Math.max(MIN_ZOOM, Math.round(z / 1.25)))}>−</button>
                    <button type="button" aria-label="Zoom in" className={toolButton(false)} disabled={pxPerStep >= MAX_ZOOM} onClick={() => setPxPerStep((z) => Math.min(MAX_ZOOM, Math.round(z * 1.25)))}>+</button>
                </div>
                <span className="ml-auto text-[10px] font-mono text-gray-500" data-testid="piano-roll-status">
                    {`${noteCount} ${noteCount === 1 ? 'note' : 'notes'} · ${editor.selection.length} selected · ${backend === 'pending' ? '…' : backend}`}
                </span>
                <button type="button" aria-label="Close piano roll" className={toolButton(false)} onClick={props.onClose}>✕</button>
            </div>

            <div ref={scrollerRef} className="relative flex-1 min-h-0 overflow-auto" onScroll={syncScroll}>
                <div style={{ width: size.width, height: size.height }}>
                    <div ref={stickyRef} className="sticky top-0 left-0 overflow-hidden">
                        <canvas ref={gpuCanvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" style={{ display: backend === 'canvas2d' ? 'none' : 'block' }} />
                        <canvas ref={canvas2dRef} aria-hidden="true" className="absolute inset-0 w-full h-full" style={{ display: backend === 'canvas2d' ? 'block' : 'none' }} />
                        <div aria-hidden="true" className="absolute left-0 top-0 overflow-hidden pointer-events-none" style={{ width: DEFAULT_LAYOUT.keysWidth, height: `calc(100% - ${DEFAULT_LAYOUT.laneHeight}px)` }}>
                            <div ref={labelsRef}>
                                {KEY_LABEL_PITCHES.map((pitch) => (
                                    <span
                                        key={pitch}
                                        className="absolute right-1 text-[9px] font-mono text-gray-700 leading-none"
                                        style={{ top: (MAX_PITCH - pitch) * DEFAULT_LAYOUT.rowHeight + 2 }}
                                    >
                                        {`C${pitch / 12 - 1}`}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div
                            ref={overlayRef}
                            role="application"
                            aria-roledescription="piano roll"
                            aria-label={`${props.trackLabel} notes, ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`}
                            aria-describedby={helpId}
                            tabIndex={0}
                            data-testid="piano-roll-grid"
                            className="absolute inset-0 touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400"
                            onKeyDown={onKeyDown}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            onPointerDown={pointer.onPointerDown}
                            onPointerMove={pointer.onPointerMove}
                            onPointerUp={pointer.onPointerUp}
                            onPointerCancel={pointer.onPointerCancel}
                            onContextMenu={pointer.onContextMenu}
                        />
                    </div>
                </div>
            </div>
            <p id={helpId} className="sr-only">{`${ROLL_KEYBOARD_HELP} Press question mark to hear this again.`}</p>
        </section>
    );
});
