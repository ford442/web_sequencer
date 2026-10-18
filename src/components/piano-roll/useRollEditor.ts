/**
 * Selection, keyboard cursor and command execution for the piano roll.
 *
 * Every edit is a pure `rollEdits` function over the committed steps; the
 * result goes to `onCommit` (→ `handleReplaceTrackSteps`, one undo entry)
 * and its selection replaces the roll's. Pointer drags (usePianoRollPointer)
 * finish through the same `apply`.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Note } from '@/types';
import type { ScaleDefinition } from '@/utils/musicTheory';
import {
    MAX_PITCH,
    MIN_PITCH,
    describeRollNote,
    noteAt,
    noteStart,
    pitchName,
    rollNoteId,
    stepPitches,
    stepsToRollNotes,
    type NoteRef,
    type RollNote,
    type Steps,
} from './model/rollModel';
import {
    copySelection,
    deleteNotes,
    drawNoteAt,
    duplicateNotes,
    lockNotesToScale,
    moveNotes,
    quantizeNotes,
    resizeNotes,
    setLaneValue,
    toggleSlide,
    transposePitch,
    type EditResult,
} from './model/rollEdits';
import { snapPosition } from './model/rollGeometry';
import { ROLL_KEYBOARD_HELP, type RollCommand } from './model/rollKeyboard';

export interface RollCursor {
    position: number;
    pitch: number;
}

export interface RollEditorOptions {
    /** Changing it (another track / bank) starts over: no selection, cursor at `initialPitch`. */
    resetKey: string;
    steps: Steps;
    /** Editable columns (the longest loop in the song). */
    maxSteps: number;
    grid: number;
    scale: ScaleDefinition | null;
    scaleLock: boolean;
    clipboard: (Note | null)[] | null;
    initialPitch: number;
    onCommit: (steps: Steps) => void;
    onCopy: (clip: (Note | null)[]) => void;
    onPaste: (clip: (Note | null)[], targetStep: number) => void;
    onClose: () => void;
    announce: (message: string) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function useRollEditor(o: RollEditorOptions) {
    const notes = useMemo(() => stepsToRollNotes(o.steps), [o.steps]);
    const [selection, setSelection] = useState<NoteRef[]>([]);
    const [cursor, setCursor] = useState<RollCursor>({ position: 0, pitch: o.initialPitch });
    // Another track starts with a clean slate (adjusted during render, not in
    // an effect, so the old selection never paints on the new track).
    const [resetKey, setResetKey] = useState(o.resetKey);
    if (resetKey !== o.resetKey) {
        setResetKey(o.resetKey);
        setSelection([]);
        setCursor({ position: 0, pitch: o.initialPitch });
    }

    // Selections can go stale after an undo or a grid edit; drop missing refs.
    const liveIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
    const selectedIds = useMemo(() => {
        const ids = new Set<string>();
        for (const ref of selection) {
            const id = rollNoteId(ref.step, ref.voice);
            if (liveIds.has(id)) ids.add(id);
        }
        return ids;
    }, [selection, liveIds]);
    const selectedRefs = useMemo(
        () => selection.filter((r) => selectedIds.has(rollNoteId(r.step, r.voice))),
        [selection, selectedIds],
    );

    const lockScale = o.scaleLock ? o.scale : null;
    const { onCommit, announce } = o;

    const apply = useCallback((result: EditResult, message: string) => {
        if (result.changed) onCommit(result.steps);
        setSelection(result.selection);
        if (result.changed && message) announce(message);
        return result.changed;
    }, [onCommit, announce]);

    const noteAtCursor = useCallback((c: RollCursor): RollNote | null => noteAt(notes, c.position + 1e-6, c.pitch), [notes]);

    const describeCell = useCallback((c: RollCursor): string => {
        const hit = noteAtCursor(c);
        if (hit) return describeRollNote(hit);
        const step = Math.floor(c.position);
        const sub = Math.round((c.position - step) * 100) / 100;
        return `${pitchName(c.pitch)}, step ${step + 1}${sub ? ` plus ${sub}` : ''}, empty`;
    }, [noteAtCursor]);

    const moveCursor = useCallback((next: RollCursor) => {
        const clamped = {
            position: Math.min(Math.max(0, o.maxSteps - o.grid), Math.max(0, snapPosition(next.position, o.grid))),
            pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, next.pitch)),
        };
        setCursor(clamped);
        announce(describeCell(clamped));
    }, [o.maxSteps, o.grid, announce, describeCell]);

    /** Selection, or the note under the cursor when nothing is selected. */
    const targetRefs = useCallback((): NoteRef[] => {
        if (selectedRefs.length > 0) return selectedRefs;
        const hit = noteAtCursor(cursor);
        return hit ? [{ step: hit.step, voice: hit.voice }] : [];
    }, [selectedRefs, noteAtCursor, cursor]);

    const run = useCallback((command: RollCommand): boolean => {
        const { steps, maxSteps, grid } = o;
        switch (command.type) {
            case 'cursor': {
                const pitch = command.dPitch === 0
                    ? cursor.pitch
                    : Math.abs(command.dPitch) === 1
                        ? transposePitch(cursor.pitch, command.dPitch, lockScale)
                        : cursor.pitch + command.dPitch;
                moveCursor({ position: cursor.position + command.dPosition, pitch });
                return true;
            }
            case 'cursorEdge':
                moveCursor({ position: command.edge === 'start' ? 0 : maxSteps - grid, pitch: cursor.pitch });
                return true;
            case 'jumpNote': {
                const roots = notes.filter((n) => n.voice === 0);
                const target = command.direction > 0
                    ? roots.find((n) => n.start > cursor.position + 1e-6)
                    : [...roots].reverse().find((n) => n.start < cursor.position - 1e-6);
                if (!target) {
                    announce(command.direction > 0 ? 'No later note' : 'No earlier note');
                    return true;
                }
                const next = { position: snapPosition(target.start, grid), pitch: target.pitch };
                setCursor(next);
                announce(describeRollNote(target));
                return true;
            }
            case 'toggleAtCursor': {
                const hit = noteAtCursor(cursor);
                if (hit) {
                    apply(deleteNotes(steps, [{ step: hit.step, voice: hit.voice }]), `Removed ${pitchName(hit.pitch)} at step ${hit.step + 1}`);
                } else {
                    const result = drawNoteAt(steps, cursor.position, cursor.pitch, { maxSteps });
                    const placed = result.selection[0];
                    apply(result, placed ? `Added ${pitchName(cursor.pitch)} at step ${placed.step + 1}` : '');
                }
                return true;
            }
            case 'selectAtCursor': {
                const hit = noteAtCursor(cursor);
                if (!hit) return true;
                const ref = { step: hit.step, voice: hit.voice };
                const already = selectedIds.has(hit.id);
                setSelection((prev) => {
                    const kept = command.additive ? prev : [];
                    return already
                        ? kept.filter((r) => r.step !== ref.step || r.voice !== ref.voice)
                        : [...kept, ref];
                });
                announce(`${already ? 'Deselected' : 'Selected'} ${describeRollNote(hit)}`);
                return true;
            }
            case 'delete': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                apply(deleteNotes(steps, refs), `Deleted ${plural(refs.length, 'note')}`);
                return true;
            }
            case 'move': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                const result = moveNotes(steps, refs, command.dPosition, command.dPitch, { grid, maxSteps, scale: lockScale });
                if (apply(result, command.dPitch !== 0 ? `Transposed ${plural(refs.length, 'note')}` : `Moved ${plural(refs.length, 'note')}`)) {
                    const lead = cursorAfter(result);
                    if (lead) setCursor({ position: snapPosition(lead.position, grid), pitch: lead.pitch });
                }
                return true;
            }
            case 'resize': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                apply(resizeNotes(steps, refs, command.dLength, { grid, maxSteps }), `${command.dLength > 0 ? 'Lengthened' : 'Shortened'} ${plural(refs.length, 'note')}`);
                return true;
            }
            case 'duplicate': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                apply(duplicateNotes(steps, refs, { maxSteps }), `Duplicated ${plural(refs.length, 'note')}`);
                return true;
            }
            case 'quantize': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                const result = quantizeNotes(steps, refs, { grid, maxSteps });
                if (!apply(result, `Quantized ${plural(refs.length, 'note')}`)) announce('Already on the grid');
                return true;
            }
            case 'lockToScale': {
                if (!o.scale) {
                    announce('No scale is set');
                    return true;
                }
                const refs = targetRefs();
                if (refs.length === 0) return true;
                const result = lockNotesToScale(steps, refs, o.scale);
                if (!apply(result, `Locked ${plural(refs.length, 'note')} to ${o.scale.root} ${o.scale.scale}`)) announce('Already in scale');
                return true;
            }
            case 'slide': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                let result: EditResult = { steps, selection: refs, changed: false };
                for (const step of new Set(refs.map((r) => r.step))) {
                    const next = toggleSlide(result.steps, step);
                    result = { steps: next.steps, selection: refs, changed: result.changed || next.changed };
                }
                apply(result, `Toggled slide on ${plural(new Set(refs.map((r) => r.step)).size, 'step')}`);
                return true;
            }
            case 'velocity': {
                const refs = targetRefs();
                if (refs.length === 0) return true;
                let result: EditResult = { steps, selection: refs, changed: false };
                for (const step of new Set(refs.map((r) => r.step))) {
                    const current = steps[step]?.velocity ?? 1;
                    const next = setLaneValue(result.steps, [step], 'velocity', Math.round((current + command.delta) * 100) / 100);
                    result = { steps: next.steps, selection: refs, changed: result.changed || next.changed };
                }
                const v = result.steps[refs[0].step]?.velocity ?? 1;
                apply(result, `Velocity ${Math.round(v * 100)}%`);
                return true;
            }
            case 'selectAll': {
                setSelection(notes.map((n) => ({ step: n.step, voice: n.voice })));
                announce(`Selected ${plural(notes.length, 'note')}`);
                return true;
            }
            case 'copy': {
                const clip = copySelection(steps, targetRefs());
                if (!clip) return true;
                o.onCopy(clip.steps);
                announce(`Copied ${plural(clip.steps.filter(Boolean).length, 'step')}`);
                return true;
            }
            case 'paste': {
                if (!o.clipboard) {
                    announce('Clipboard is empty');
                    return true;
                }
                o.onPaste(o.clipboard, Math.floor(cursor.position));
                announce(`Pasted at step ${Math.floor(cursor.position) + 1}`);
                return true;
            }
            case 'escape':
                if (selectedRefs.length > 0) {
                    setSelection([]);
                    announce('Selection cleared');
                } else {
                    o.onClose();
                }
                return true;
            case 'help':
                announce(ROLL_KEYBOARD_HELP);
                return true;
        }
    }, [o, cursor, notes, lockScale, moveCursor, noteAtCursor, apply, announce, targetRefs, selectedIds, selectedRefs]);

    return { notes, selection: selectedRefs, selectedIds, setSelection, cursor, setCursor, apply, run };
}

/** Where the first selected note of a result sits, so the cursor can follow a move. */
function cursorAfter(result: EditResult): RollCursor | null {
    const ref = result.selection[0];
    const note = ref ? result.steps[ref.step] : null;
    if (!ref || !note) return null;
    const pitch = stepPitches(note)[ref.voice];
    return pitch === undefined ? null : { position: noteStart(ref.step, note), pitch };
}
