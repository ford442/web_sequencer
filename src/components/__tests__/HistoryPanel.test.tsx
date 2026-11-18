/**
 * The history panel (#1597 P2) lists labelled steps of both editors and jumps
 * to any of them.
 */
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from '../HistoryPanel';
import { liveProject } from '../../collab/liveProject';
import { startLiveProject, stopLiveProject } from '../../collab/liveProjectRuntime';
import { transportMixStore } from '../../stores/transportMixStore';
import { instrumentStore } from '../../stores/instrumentStore';

afterEach(() => {
    cleanup();
    stopLiveProject();
    transportMixStore.reset();
    instrumentStore.reset();
});

function step(fn: () => void): void {
    act(() => {
        liveProject.beginGesture();
        fn();
    });
}

describe('HistoryPanel', () => {
    it('lists the user\'s and the co-producer\'s steps and jumps to one', () => {
        startLiveProject();
        render(<HistoryPanel onClose={vi.fn()} />);
        expect(screen.getByText(/No edits yet/)).toBeInTheDocument();

        step(() => transportMixStore.setTempo(128));
        step(() => instrumentStore.set('synthA', (p) => ({ ...p, filterCutoff: 4000 })));
        act(() => {
            liveProject.edit('agent', () => transportMixStore.setSwing(60), 'co-producer: set_params');
        });

        const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(rows[1]).toContain('Tempo 120 → 128');
        expect(rows[2]).toMatch(/Synth A: Cutoff \d+ → 4000/);
        expect(rows[3]).toContain('co-producer: set_params');
        expect(rows[3]).toContain('co-producer');

        // Jump back to right after the tempo change: the knob step is undone,
        // the co-producer's step is left alone.
        fireEvent.click(screen.getByRole('button', { name: /Tempo 120 → 128/ }));
        expect(instrumentStore.getParams().synthA.filterCutoff).not.toBe(4000);
        expect(transportMixStore.getSnapshot().tempo).toBe(128);
        expect(transportMixStore.getSnapshot().swing).toBe(60);
        expect(screen.getByRole('button', { name: /Cutoff .*undone/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Start/ }));
        expect(transportMixStore.getSnapshot().tempo).toBe(120);

        fireEvent.click(screen.getByRole('button', { name: /Cutoff .*undone/ }));
        expect(instrumentStore.getParams().synthA.filterCutoff).toBe(4000);
        expect(transportMixStore.getSnapshot().tempo).toBe(128);
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<HistoryPanel onClose={onClose} />);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
