/**
 * Master meter UI: reads scalar stats from the stage registry, writes settings
 * back through it, and stays mounted (disabled) when no stage exists.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

import { MasterLoudnessMeter } from '../MasterLoudnessMeter';
import {
    setMasterLoudnessStage,
    DEFAULT_LIMITER_SETTINGS,
    IDLE_LOUDNESS_STATS,
    type LimiterSettings,
    type LoudnessStats,
    type LoudnessStatsListener,
    type MasterLoudnessStage,
} from '../../audio/loudness';

/** Minimal stand-in for the worklet-backed stage. */
function createFakeStage() {
    const listeners = new Set<LoudnessStatsListener>();
    const updates: Array<Partial<LimiterSettings>> = [];
    let settings: LimiterSettings = { ...DEFAULT_LIMITER_SETTINGS };
    let resets = 0;

    const stage = {
        latestStats: IDLE_LOUDNESS_STATS,
        latencySeconds: 0.0015,
        getSettings: () => ({ ...settings }),
        subscribe(listener: LoudnessStatsListener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        update(update: Partial<LimiterSettings>) {
            updates.push(update);
            settings = { ...settings, ...update };
        },
        resetLoudness() {
            resets += 1;
        },
    } as unknown as MasterLoudnessStage;

    return {
        stage,
        updates,
        get resets() {
            return resets;
        },
        emit(stats: Partial<LoudnessStats>) {
            const next = { ...IDLE_LOUDNESS_STATS, ...stats };
            (stage as { latestStats: LoudnessStats }).latestStats = next;
            for (const listener of listeners) listener(next);
        },
    };
}

describe('MasterLoudnessMeter', () => {
    beforeEach(() => {
        setMasterLoudnessStage(null);
    });

    afterEach(() => {
        setMasterLoudnessStage(null);
        vi.restoreAllMocks();
    });

    it('renders an offline strip when the engine is not running', () => {
        render(<MasterLoudnessMeter />);
        expect(screen.getByText('Master meter offline')).toBeInTheDocument();
        expect(screen.getByLabelText('Limiter ceiling in dBTP')).toBeDisabled();
    });

    it('shows momentary, short-term, integrated and true peak from the worklet', () => {
        const fake = createFakeStage();
        act(() => setMasterLoudnessStage(fake.stage));
        render(<MasterLoudnessMeter />);

        act(() => {
            fake.emit({
                momentary: -12.34,
                shortTerm: -13.5,
                integrated: -14.02,
                truePeak: -1.2,
                gainReduction: -2.5,
            });
        });

        expect(screen.getByText('-12.3')).toBeInTheDocument();
        expect(screen.getByText('-13.5')).toBeInTheDocument();
        expect(screen.getByText('-14.0')).toBeInTheDocument();
        expect(screen.getByText('-1.2')).toBeInTheDocument();
        expect(screen.getByText('-2.5')).toBeInTheDocument();
    });

    it('renders silence as -inf rather than NaN', () => {
        const fake = createFakeStage();
        act(() => setMasterLoudnessStage(fake.stage));
        render(<MasterLoudnessMeter />);
        expect(screen.getAllByText('-inf').length).toBeGreaterThan(0);
    });

    it('sends limiter changes one way, to the stage', () => {
        const fake = createFakeStage();
        act(() => setMasterLoudnessStage(fake.stage));
        render(<MasterLoudnessMeter />);

        fireEvent.change(screen.getByLabelText('Limiter ceiling in dBTP'), {
            target: { value: '-2.5' },
        });
        fireEvent.click(screen.getByLabelText('Limiter enabled'));

        expect(fake.updates).toContainEqual({ ceilingDbtp: -2.5 });
        expect(fake.updates.some((u) => u.enabled === false)).toBe(true);
    });

    it('asks the stage to restart the integrated measurement', () => {
        const fake = createFakeStage();
        act(() => setMasterLoudnessStage(fake.stage));
        render(<MasterLoudnessMeter />);

        fireEvent.click(screen.getByText('Reset'));
        expect(fake.resets).toBe(1);
    });

    it('reports the limiter lookahead as monitor latency', () => {
        const fake = createFakeStage();
        act(() => setMasterLoudnessStage(fake.stage));
        render(<MasterLoudnessMeter />);
        act(() => fake.emit({ momentary: -20 }));
        expect(screen.getByText(/Lookahead latency 1\.5 ms/)).toBeInTheDocument();
    });
});
