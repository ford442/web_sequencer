/**
 * Pointer editing for the piano roll: draw, select, drag-move, resize,
 * marquee, lane painting, right-click delete.
 *
 * A drag never touches React state: each move computes the edit from the
 * steps as they were at pointer-down and hands the preview straight to the
 * painter. Release commits once through `editor.apply`, so one gesture is one
 * undo entry, exactly like a single grid edit.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { ScaleDefinition } from '@/utils/musicTheory';
import { notesInRect, parseRollNoteId, pitchName, rollNoteId, stepsToRollNotes, type NoteRef, type Steps } from './model/rollModel';
import {
    deleteNotes,
    drawNoteAt,
    moveNotes,
    resizeNotes,
    setLaneValue,
    snapDelta,
    type EditResult,
    type LaneProperty,
} from './model/rollEdits';
import { hitTest, snapPosition, xToPosition, yToPitch } from './model/rollGeometry';
import type { RollPainter, SceneInputWithoutLayout } from './render/useRollPainter';

export type RollTool = 'draw' | 'select';

type Drag =
    | { kind: 'draw'; start: number; pitch: number; origin: Steps; result: EditResult }
    | { kind: 'move'; refs: NoteRef[]; x0: number; pitch0: number; origin: Steps; result: EditResult | null }
    | { kind: 'resize'; refs: NoteRef[]; x0: number; origin: Steps; result: EditResult | null }
    | { kind: 'marquee'; position0: number; pitch0: number; base: NoteRef[]; ids: string[] }
    | { kind: 'lane'; origin: Steps; steps: Steps; touched: Set<number> };

export interface RollPointerOptions {
    overlayRef: RefObject<HTMLElement | null>;
    painter: RollPainter;
    /** The scene input as React last set it; drags overlay their preview on it. */
    baseInputRef: RefObject<SceneInputWithoutLayout | null>;
    steps: Steps;
    selection: readonly NoteRef[];
    setSelection: (refs: NoteRef[]) => void;
    apply: (result: EditResult, message: string) => boolean;
    tool: RollTool;
    grid: number;
    maxSteps: number;
    laneProperty: LaneProperty;
    scale: ScaleDefinition | null;
    scaleLock: boolean;
    announce: (message: string) => void;
    onCursor: (position: number, pitch: number) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function usePianoRollPointer(o: RollPointerOptions) {
    const dragRef = useRef<Drag | null>(null);
    // Handlers run after commit, so the options of the last render are current.
    const optsRef = useRef(o);
    useLayoutEffect(() => {
        optsRef.current = o;
    });

    const local = (e: React.PointerEvent): { x: number; y: number } => {
        const el = optsRef.current.overlayRef.current;
        const rect = el?.getBoundingClientRect();
        return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    };

    const preview = (steps: Steps, selection: readonly NoteRef[], marquee: SceneInputWithoutLayout['marquee'] = null) => {
        const base = optsRef.current.baseInputRef.current;
        if (!base) return;
        optsRef.current.painter.setInput({
            ...base,
            notes: stepsToRollNotes(steps),
            selected: new Set(selection.map((r) => rollNoteId(r.step, r.voice))),
            marquee,
        });
    };

    const restore = () => {
        const base = optsRef.current.baseInputRef.current;
        if (base) optsRef.current.painter.setInput(base);
    };

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        const opts = optsRef.current;
        const overlay = opts.overlayRef.current;
        overlay?.focus({ preventScroll: true });
        const { x, y } = local(e);
        const layout = opts.painter.layout;
        const notes = stepsToRollNotes(opts.steps);
        const hit = hitTest(layout, notes, x, y);
        if (hit.region === 'none' || hit.region === 'keys') return;
        e.preventDefault();
        overlay?.setPointerCapture?.(e.pointerId);

        if (hit.region === 'lane') {
            const step = Math.floor(hit.position);
            const result = setLaneValue(opts.steps, [step], opts.laneProperty, hit.value);
            dragRef.current = { kind: 'lane', origin: opts.steps, steps: result.steps, touched: new Set([step]) };
            preview(result.steps, opts.selection);
            return;
        }

        const position = snapPosition(hit.position, opts.grid);
        opts.onCursor(position, hit.pitch);

        if (hit.note) {
            const ref = { step: hit.note.step, voice: hit.note.voice };
            if (e.button === 2) {
                opts.apply(deleteNotes(opts.steps, [ref]), `Deleted ${pitchName(hit.note.pitch)} at step ${hit.note.step + 1}`);
                return;
            }
            const isSelected = opts.selection.some((r) => r.step === ref.step && r.voice === ref.voice);
            let refs: NoteRef[];
            if (e.shiftKey) {
                refs = isSelected
                    ? opts.selection.filter((r) => r.step !== ref.step || r.voice !== ref.voice)
                    : [...opts.selection, ref];
            } else {
                refs = isSelected ? [...opts.selection] : [ref];
            }
            opts.setSelection(refs);
            if (hit.edge === 'end') {
                dragRef.current = { kind: 'resize', refs: isSelected ? refs : [ref], x0: x, origin: opts.steps, result: null };
            } else {
                dragRef.current = { kind: 'move', refs, x0: x, pitch0: hit.pitch, origin: opts.steps, result: null };
            }
            return;
        }

        if (e.button === 2) return;
        if (opts.tool === 'draw' && !e.shiftKey) {
            const result = drawNoteAt(opts.steps, position, hit.pitch, { maxSteps: opts.maxSteps });
            dragRef.current = { kind: 'draw', start: position, pitch: hit.pitch, origin: opts.steps, result };
            preview(result.steps, result.selection);
            return;
        }
        const base = e.shiftKey ? [...opts.selection] : [];
        dragRef.current = { kind: 'marquee', position0: hit.position, pitch0: hit.pitch, base, ids: [] };
        if (!e.shiftKey) opts.setSelection([]);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
        const opts = optsRef.current;
        const drag = dragRef.current;
        const { x, y } = local(e);
        const layout = opts.painter.layout;
        if (!drag) {
            // Hover: show what a press would do.
            const overlay = opts.overlayRef.current;
            if (!overlay) return;
            const hit = hitTest(layout, stepsToRollNotes(opts.steps), x, y);
            overlay.style.cursor = hit.region !== 'grid'
                ? (hit.region === 'lane' ? 'ns-resize' : 'default')
                : hit.note
                    ? (hit.edge === 'end' ? 'ew-resize' : 'grab')
                    : opts.tool === 'draw' ? 'crosshair' : 'default';
            return;
        }
        const position = xToPosition(layout, x);
        const pitch = yToPitch(layout, y);
        const scale = opts.scaleLock ? opts.scale : null;
        switch (drag.kind) {
            case 'draw': {
                const length = Math.max(opts.grid, snapDelta(Math.max(0, position - drag.start), opts.grid) || opts.grid);
                drag.result = drawNoteAt(drag.origin, drag.start, drag.pitch, { length: Math.max(1, length), maxSteps: opts.maxSteps });
                preview(drag.result.steps, drag.result.selection);
                return;
            }
            case 'move': {
                const dStart = (x - drag.x0) / layout.pxPerStep;
                drag.result = moveNotes(drag.origin, drag.refs, dStart, pitch - drag.pitch0, { grid: opts.grid, maxSteps: opts.maxSteps, scale });
                preview(drag.result.steps, drag.result.selection);
                return;
            }
            case 'resize': {
                const dLength = (x - drag.x0) / layout.pxPerStep;
                drag.result = resizeNotes(drag.origin, drag.refs, dLength, { grid: opts.grid, maxSteps: opts.maxSteps });
                preview(drag.result.steps, drag.result.selection);
                return;
            }
            case 'marquee': {
                const rect = { start: drag.position0, end: position, low: drag.pitch0, high: pitch };
                drag.ids = notesInRect(stepsToRollNotes(opts.steps), rect);
                const refs = [...drag.base, ...drag.ids.map((id) => parseRollNoteId(id)!)];
                preview(opts.steps, refs, rect);
                return;
            }
            case 'lane': {
                const step = Math.floor(position);
                const lane = opts.painter.layout;
                const top = lane.height - lane.laneHeight;
                const value = 1 - (y - top) / Math.max(1, lane.laneHeight);
                const next = setLaneValue(drag.steps, [step], opts.laneProperty, value);
                drag.steps = next.steps;
                drag.touched.add(step);
                preview(drag.steps, opts.selection);
                return;
            }
        }
    }, []);

    const finish = useCallback((e: React.PointerEvent, cancelled: boolean) => {
        const opts = optsRef.current;
        const drag = dragRef.current;
        dragRef.current = null;
        opts.overlayRef.current?.releasePointerCapture?.(e.pointerId);
        if (!drag) return;
        if (cancelled) {
            restore();
            return;
        }
        let committed = false;
        switch (drag.kind) {
            case 'draw': {
                const ref = drag.result.selection[0];
                committed = opts.apply(drag.result, ref ? `Added ${pitchName(drag.pitch)} at step ${ref.step + 1}` : '');
                break;
            }
            case 'move':
                if (drag.result?.changed) committed = opts.apply(drag.result, `Moved ${plural(drag.refs.length, 'note')}`);
                break;
            case 'resize':
                if (drag.result?.changed) committed = opts.apply(drag.result, `Resized ${plural(drag.refs.length, 'note')}`);
                break;
            case 'marquee': {
                const refs = [...drag.base, ...drag.ids.map((id) => parseRollNoteId(id)!)];
                opts.setSelection(refs);
                opts.announce(`Selected ${plural(refs.length, 'note')}`);
                break;
            }
            case 'lane':
                if (drag.steps !== drag.origin) {
                    committed = opts.apply(
                        { steps: drag.steps, selection: [...opts.selection], changed: true },
                        `Set ${opts.laneProperty} on ${plural(drag.touched.size, 'step')}`,
                    );
                }
                break;
        }
        // Nothing changed: the scene input still shows the preview.
        if (!committed) restore();
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent) => finish(e, false), [finish]);
    const onPointerCancel = useCallback((e: React.PointerEvent) => finish(e, true), [finish]);
    const onContextMenu = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

    return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu, isDragging: () => dragRef.current !== null };
}
