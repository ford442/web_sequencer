/**
 * A11y + keyboard contract of the piano roll (#1345): named landmarks and
 * controls, a keyboard-complete grid whose edits are announced, and focus
 * containment — the roll's keys never trigger the window shortcuts behind it
 * (Escape = tape stop, Delete = clear grid selection).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/types';
import { a11yAnnouncerStore } from '@/stores/a11yAnnouncerStore';
import { pianoRollStore } from '@/stores/pianoRollStore';
import { resetWebGpuProbe } from '@/engines/backends/webgpuProbe';
import { PianoRollChip } from '../../sequencer/PianoRollChip';
import { PianoRollView, type PianoRollViewProps } from '../PianoRollView';

const n = (note: string, extra: Partial<Note> = {}): Note => ({ note, velocity: 1, length: 1, slide: false, ...extra });

function setup(overrides: Partial<PianoRollViewProps> = {}) {
    const onCommit = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();
    const props: PianoRollViewProps = {
        target: { track: 'partA', bank: 0 },
        trackLabel: 'Lead',
        trackLabels: { partA: 'Lead', partB: 'Bass', bass2: 'Bass2', sampler: 'SMP' },
        color: '#06b6d4',
        steps: Array<Note | null>(16).fill(null),
        ghostSources: [],
        columns: 16,
        loopLength: 16,
        stepsPerBeat: 4,
        stepsPerBar: 16,
        scale: null,
        clipboard: null,
        onCommit,
        onCopy,
        onPaste,
        onSelectTarget: vi.fn(),
        onClose,
        ...overrides,
    };
    const utils = render(<PianoRollView {...props} />);
    return { ...utils, props, onCommit, onClose, onCopy, onPaste, grid: screen.getByRole('application') };
}

let announcements: string[];
let unsubscribe: () => void = () => {};

beforeEach(() => {
    resetWebGpuProbe();
    vi.stubGlobal('navigator', { ...navigator, gpu: undefined });
    announcements = [];
    unsubscribe = a11yAnnouncerStore.subscribe((s) => {
        const msg = s?.message ?? '';
        if (msg) announcements.push(msg);
    });
});

afterEach(() => {
    unsubscribe();
    vi.unstubAllGlobals();
    pianoRollStore.reset();
});

describe('PianoRollView accessibility', () => {
    it('is a named region with a named, described, focusable grid', () => {
        const { grid } = setup();
        expect(screen.getByRole('region', { name: 'Piano roll, Lead' })).toBeInTheDocument();
        expect(grid).toHaveAttribute('aria-roledescription', 'piano roll');
        expect(grid).toHaveAttribute('aria-label', 'Lead notes, 0 notes');
        expect(grid).toHaveAttribute('tabindex', '0');
        const help = document.getElementById(grid.getAttribute('aria-describedby')!);
        expect(help?.textContent).toMatch(/Arrow keys move the cursor/);
    });

    it('names every control and reports toggle state', () => {
        setup();
        expect(screen.getByRole('button', { name: 'Draw' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Select' }));
        expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Scale lock' })).toBeDisabled();
        expect(screen.getByRole('combobox', { name: 'Grid' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Lane' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Lead' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Close piano roll' })).toBeInTheDocument();
    });

    it('falls back to Canvas2D without WebGPU', async () => {
        setup();
        await waitFor(() => expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-backend', 'canvas2d'));
    });
});

describe('PianoRollView keyboard', () => {
    it('moves a cursor, announces cells and adds a note with Enter', () => {
        const { grid, onCommit } = setup();
        act(() => grid.focus());
        fireEvent.keyDown(grid, { key: 'ArrowRight' });
        fireEvent.keyDown(grid, { key: 'ArrowUp', shiftKey: true });
        expect(announcements.at(-1)).toBe('C5, step 2, empty');
        fireEvent.keyDown(grid, { key: 'Enter' });
        expect(onCommit).toHaveBeenCalledTimes(1);
        const steps = onCommit.mock.calls[0][0] as (Note | null)[];
        expect(steps[1]).toEqual(n('C5'));
        expect(announcements.at(-1)).toBe('Added C5 at step 2');
    });

    it('edits the selection: transpose, lengthen, delete', () => {
        const steps = Array<Note | null>(16).fill(null);
        steps[0] = n('C4');
        const { grid, onCommit, rerender, props } = setup({ steps });
        act(() => grid.focus());
        fireEvent.keyDown(grid, { key: 'a', ctrlKey: true });
        expect(announcements.at(-1)).toBe('Selected 1 note');

        fireEvent.keyDown(grid, { key: 'ArrowUp', altKey: true });
        const up = onCommit.mock.calls.at(-1)![0] as (Note | null)[];
        expect(up[0]).toEqual(n('C#4'));
        rerender(<PianoRollView {...props} steps={up} />);

        fireEvent.keyDown(grid, { key: ']' });
        const longer = onCommit.mock.calls.at(-1)![0] as (Note | null)[];
        expect(longer[0]).toEqual(n('C#4', { length: 2 }));
        rerender(<PianoRollView {...props} steps={longer} />);

        fireEvent.keyDown(grid, { key: 'Delete' });
        expect((onCommit.mock.calls.at(-1)![0] as (Note | null)[])[0]).toBeNull();
        expect(announcements.at(-1)).toBe('Deleted 1 note');
    });

    it('keeps its keys away from the window shortcuts but lets Space and undo through', () => {
        const windowKeys = vi.fn();
        window.addEventListener('keydown', windowKeys);
        try {
            const steps = Array<Note | null>(16).fill(null);
            steps[0] = n('C4');
            const { grid, onClose } = setup({ steps });
            act(() => grid.focus());
            fireEvent.keyDown(grid, { key: 'a', ctrlKey: true });
            fireEvent.keyDown(grid, { key: 'Escape' });
            // First Escape clears the selection, the second closes.
            expect(onClose).not.toHaveBeenCalled();
            fireEvent.keyDown(grid, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
            fireEvent.keyDown(grid, { key: 'Delete' });
            fireEvent.keyDown(grid, { key: 'k' });
            expect(windowKeys).not.toHaveBeenCalled();

            fireEvent.keyDown(grid, { key: ' ' });
            fireEvent.keyDown(grid, { key: 'z', ctrlKey: true });
            expect(windowKeys).toHaveBeenCalledTimes(2);
        } finally {
            window.removeEventListener('keydown', windowKeys);
        }
    });

    it('copies and pastes through the shared clipboard', () => {
        const steps = Array<Note | null>(16).fill(null);
        steps[2] = n('E4');
        const { grid, onCopy, onPaste, rerender, props } = setup({ steps });
        act(() => grid.focus());
        fireEvent.keyDown(grid, { key: 'a', ctrlKey: true });
        fireEvent.keyDown(grid, { key: 'c', ctrlKey: true });
        expect(onCopy).toHaveBeenCalledWith([n('E4')]);
        rerender(<PianoRollView {...props} clipboard={[n('E4')]} />);
        fireEvent.keyDown(grid, { key: 'End' });
        fireEvent.keyDown(grid, { key: 'v', ctrlKey: true });
        expect(onPaste).toHaveBeenCalledWith([n('E4')], 15);
    });
});

describe('PianoRollChip', () => {
    it('opens and closes the roll from the row header and reports its state', () => {
        render(<svg><PianoRollChip trackKey="partA" label="Lead" /></svg>);
        const chip = screen.getByRole('button', { name: 'Open Lead piano roll' });
        expect(chip).toHaveAttribute('aria-pressed', 'false');
        expect(chip).toHaveAttribute('tabindex', '0');
        fireEvent.keyDown(chip, { key: 'Enter' });
        expect(pianoRollStore.getSnapshot().open).toEqual({ track: 'partA', bank: 0 });
        expect(screen.getByRole('button', { name: 'Close Lead piano roll' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Close Lead piano roll' }));
        expect(pianoRollStore.getSnapshot().open).toBeNull();
    });

    it('renders nothing on drum rows', () => {
        const { container } = render(<svg><PianoRollChip trackKey="kick" label="Kick" /></svg>);
        expect(container.querySelector('.track-piano-roll')).toBeNull();
    });
});
