/**
 * Keyboard map of the focused piano roll, as a pure function from a key
 * event to a command (the view executes it).
 *
 * The roll is keyboard-complete: a cursor cell moves over the grid, and every
 * pointer edit has a key. While the roll has focus it swallows its keys so the
 * window-level shortcuts underneath (Escape = tape stop, Delete = clear the
 * grid selection, PC-keyboard notes) do not fire — except Space (transport),
 * Tab (focus order) and Ctrl/Cmd+Z / Y (the shared undo history, which roll
 * edits are part of).
 */

export type RollCommand =
    | { type: 'cursor'; dPosition: number; dPitch: number }
    | { type: 'cursorEdge'; edge: 'start' | 'end' }
    | { type: 'jumpNote'; direction: 1 | -1 }
    | { type: 'toggleAtCursor' }
    | { type: 'selectAtCursor'; additive: boolean }
    | { type: 'delete' }
    | { type: 'move'; dPosition: number; dPitch: number }
    | { type: 'resize'; dLength: number }
    | { type: 'duplicate' }
    | { type: 'quantize' }
    | { type: 'lockToScale' }
    | { type: 'slide' }
    | { type: 'velocity'; delta: number }
    | { type: 'selectAll' }
    | { type: 'copy' }
    | { type: 'paste' }
    | { type: 'escape' }
    | { type: 'help' };

export interface RollKeyEvent {
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}

/** Keys the roll leaves to the rest of the app even while focused. */
export function passesThrough(e: RollKeyEvent): boolean {
    if (e.key === 'Tab' || e.key === ' ') return true;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    return mod && (k === 'z' || k === 'y');
}

/** `grid` is the grid unit in steps (1 = 1/16, 0.5 = 1/32, 0.25 = 1/64). */
export function resolveRollKey(e: RollKeyEvent, grid: number): RollCommand | null {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const octave = e.shiftKey ? 12 : 1;

    switch (k) {
        case 'ArrowLeft':
        case 'ArrowRight': {
            const dir = k === 'ArrowLeft' ? -1 : 1;
            if (mod) return { type: 'jumpNote', direction: dir };
            if (e.altKey) return e.shiftKey ? { type: 'resize', dLength: dir * grid } : { type: 'move', dPosition: dir * grid, dPitch: 0 };
            return { type: 'cursor', dPosition: dir * (e.shiftKey ? grid * 4 : grid), dPitch: 0 };
        }
        case 'ArrowUp':
        case 'ArrowDown': {
            const dir = k === 'ArrowUp' ? 1 : -1;
            if (e.altKey) return { type: 'move', dPosition: 0, dPitch: dir * octave };
            return { type: 'cursor', dPosition: 0, dPitch: dir * octave };
        }
        case 'PageUp':
            return { type: 'cursor', dPosition: 0, dPitch: 12 };
        case 'PageDown':
            return { type: 'cursor', dPosition: 0, dPitch: -12 };
        case 'Home':
            return { type: 'cursorEdge', edge: 'start' };
        case 'End':
            return { type: 'cursorEdge', edge: 'end' };
        case 'Enter':
            return e.shiftKey ? { type: 'selectAtCursor', additive: true } : { type: 'toggleAtCursor' };
        case 'Delete':
        case 'Backspace':
            return { type: 'delete' };
        case 'Escape':
            return { type: 'escape' };
        case '[':
            return { type: 'resize', dLength: -grid };
        case ']':
            return { type: 'resize', dLength: grid };
        case '=':
        case '+':
            return { type: 'velocity', delta: 0.1 };
        case '-':
        case '_':
            return { type: 'velocity', delta: -0.1 };
        case '?':
            return { type: 'help' };
        default:
            break;
    }

    if (mod) {
        if (k === 'a') return { type: 'selectAll' };
        if (k === 'd') return { type: 'duplicate' };
        if (k === 'c') return { type: 'copy' };
        if (k === 'v') return { type: 'paste' };
        return null;
    }
    if (k === 'q') return { type: 'quantize' };
    if (k === 'l') return { type: 'lockToScale' };
    if (k === 's') return { type: 'slide' };
    return null;
}

export const ROLL_KEYBOARD_HELP =
    'Arrow keys move the cursor (Shift: by a beat or an octave). Enter adds or removes a note; Shift+Enter adds it to the selection. ' +
    'Alt+arrows move the selection, Alt+Shift+Left or Right and the bracket keys change its length. ' +
    'Delete removes, Ctrl+D duplicates, Q quantizes, L locks to the scale, S toggles slide, plus and minus change velocity. ' +
    'Ctrl+arrows jump between notes, Ctrl+A selects all, Ctrl+C and Ctrl+V copy and paste, Ctrl+Z undoes. Escape clears the selection, then closes the roll.';
