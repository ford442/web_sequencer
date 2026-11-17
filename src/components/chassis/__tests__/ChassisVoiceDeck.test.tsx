import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChassisVoiceDeck } from '../ChassisVoiceDeck';
import { HardwareChassis } from '../HardwareChassis';
import {
    DEFAULT_SAMPLER_CHASSIS_MODE,
    chassisModeHasVoiceDeck,
    isSamplerChassisMode,
    resolveChassisMode,
    trackForChassisMode,
    type ChassisMode,
    type SamplerChassisMode,
} from '../chassisModes';
import type { TrackKey } from '../../../constants/appDefaults';

const service = vi.hoisted(() => ({
    ready: true,
    updateStyleFromRaw: vi.fn(),
}));

vi.mock('../../../services/VoiceDesigner', () => ({
    VoiceDesigner: class {
        setCanvas = vi.fn();
        loadFromStyle = vi.fn();
        getRawData = vi.fn().mockReturnValue({ ttl: [1], dp: [1], ttlDims: [], dpDims: [] });
        mirrorX = vi.fn();
        reset = vi.fn();
    },
}));

vi.mock('../../../services/Supertonic', () => ({
    SupertonicService: {
        getInstance: () => ({
            isServiceReady: () => service.ready,
            getStyle: () => ({ ttl: { data: [] }, dp: { data: [] } }),
            updateStyleFromRaw: service.updateStyleFromRaw,
            purgeCache: vi.fn(),
        }),
    },
}));

const PHRASES = ['one', 'two', '', '', '', '', '', ''];

describe('ChassisVoiceDeck (#1582)', () => {
    beforeEach(() => {
        service.ready = true;
        service.updateStyleFromRaw.mockClear();
    });

    it('shows the TTS phrase, GEN and the Voice Designer heatmap for the active bank', () => {
        render(<ChassisVoiceDeck bankIdx={1} phrases={PHRASES} onPhrasesChange={vi.fn()} onGenerate={vi.fn()} />);
        expect(screen.getByTestId('chassis-tts-phrase')).toHaveValue('two');
        expect(screen.getByLabelText('Text to Speech phrase for bank 2')).toBeInTheDocument();
        expect(screen.getByTestId('chassis-tts-gen')).toBeEnabled();
        expect(screen.getByRole('img', { name: /voice heatmap/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /apply to engine/i })).toBeInTheDocument();
    });

    it('edits only the active bank\'s phrase (per-bank TTS text)', () => {
        const onPhrasesChange = vi.fn();
        render(<ChassisVoiceDeck bankIdx={1} phrases={PHRASES} onPhrasesChange={onPhrasesChange} onGenerate={vi.fn()} />);
        fireEvent.change(screen.getByTestId('chassis-tts-phrase'), { target: { value: 'hi there' } });
        const next = onPhrasesChange.mock.calls[0][0] as string[];
        expect(next[1]).toBe('hi there');
        expect(next[0]).toBe('one');
        expect(next).toHaveLength(8);
    });

    it('GEN renders the current phrase into the bank', async () => {
        const onGenerate = vi.fn().mockResolvedValue(undefined);
        render(<ChassisVoiceDeck bankIdx={0} phrases={PHRASES} onPhrasesChange={vi.fn()} onGenerate={onGenerate} />);
        await act(async () => {
            fireEvent.click(screen.getByTestId('chassis-tts-gen'));
        });
        expect(onGenerate).toHaveBeenCalledWith('one');
        expect(screen.getByText('Gen: Bank 1')).toBeInTheDocument();
    });

    it('falls back to the default phrase for an empty bank', () => {
        render(<ChassisVoiceDeck bankIdx={3} phrases={PHRASES} onPhrasesChange={vi.fn()} onGenerate={vi.fn()} />);
        expect(screen.getByTestId('chassis-tts-phrase')).toHaveValue('Hello World');
    });

    it('disables GEN while the TTS engine is loading', () => {
        service.ready = false;
        render(<ChassisVoiceDeck bankIdx={0} phrases={PHRASES} onPhrasesChange={vi.fn()} onGenerate={vi.fn()} />);
        expect(screen.getByTestId('chassis-tts-gen')).toBeDisabled();
        expect(screen.getByRole('status', { name: 'TTS engine unavailable' })).toBeInTheDocument();
    });

    it('applies an edited voice style to the engine inline', () => {
        render(<ChassisVoiceDeck bankIdx={0} phrases={PHRASES} onPhrasesChange={vi.fn()} onGenerate={vi.fn()} expanded />);
        fireEvent.click(screen.getByRole('button', { name: /apply to engine/i }));
        expect(service.updateStyleFromRaw).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('chassis-voice-deck')).toHaveAttribute('data-expanded', 'true');
    });
});

/** Mirrors ChassisNode's wiring without the app-state provider. */
function SamplerChassisHarness({ initialTrack = 'partA' as TrackKey }) {
    const [track, setTrack] = useState<TrackKey>(initialTrack);
    const [samplerMode, setSamplerMode] = useState<SamplerChassisMode>(DEFAULT_SAMPLER_CHASSIS_MODE);
    const mode = resolveChassisMode(track, samplerMode);
    const onModeChange = (next: ChassisMode) => {
        if (isSamplerChassisMode(next)) setSamplerMode(next);
        const t = trackForChassisMode(next, track);
        if (t) setTrack(t);
    };
    return (
        <>
            <button type="button" onClick={() => setTrack('sampler')}>select sampler</button>
            <button type="button" onClick={() => setTrack('partA')}>select synth</button>
            <HardwareChassis
                mode={mode}
                modes={['osc', 'drm', 'smp', 'tts', 'vd']}
                onModeChange={onModeChange}
                ledStrip={<div />}
                secondary={chassisModeHasVoiceDeck(mode) ? (
                    <ChassisVoiceDeck bankIdx={0} phrases={PHRASES} onPhrasesChange={vi.fn()} onGenerate={vi.fn()} expanded={mode === 'vd'} />
                ) : undefined}
            >
                <input data-testid="rack" aria-label="rack" />
            </HardwareChassis>
        </>
    );
}

describe('sampler chassis expansion (#1582)', () => {
    const body = () => screen.getByRole('region', { name: /hardware chassis/i });

    it('selecting the sampler track expands to TTS + Voice Designer; switching back to a synth collapses', () => {
        render(<SamplerChassisHarness />);
        expect(body()).toHaveAttribute('data-chassis-mode', 'osc');
        expect(screen.queryByTestId('chassis-voice-deck')).toBeNull();
        const rack = screen.getByTestId('rack');

        fireEvent.click(screen.getByText('select sampler'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'tts');
        expect(screen.getByTestId('chassis-secondary')).toContainElement(screen.getByTestId('chassis-voice-deck'));
        expect(screen.getByTestId('chassis-secondary')).toHaveAttribute('data-placement', 'below');
        expect(body().style.getPropertyValue('--chassis-stage-h')).toBe('640px');
        // The deck opens under the rack; the rack itself never remounts.
        expect(screen.getByTestId('rack')).toBe(rack);

        fireEvent.click(screen.getByText('select synth'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'osc');
        expect(screen.queryByTestId('chassis-voice-deck')).toBeNull();
        expect(screen.queryByTestId('chassis-secondary')).toBeNull();
        expect(body().style.getPropertyValue('--chassis-stage-h')).toBe('380px');
        expect(screen.getByTestId('rack')).toBe(rack);
    });

    it('mode keys move between SMP / TTS / VD on the sampler and the choice is remembered', () => {
        render(<SamplerChassisHarness />);
        fireEvent.click(screen.getByTestId('chassis-mode-vd'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'vd');
        expect(screen.getByTestId('chassis-voice-deck')).toHaveAttribute('data-expanded', 'true');

        fireEvent.click(screen.getByTestId('chassis-mode-smp'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'smp');
        expect(screen.queryByTestId('chassis-voice-deck')).toBeNull();

        fireEvent.click(screen.getByTestId('chassis-mode-osc'));
        fireEvent.click(screen.getByText('select sampler'));
        expect(body()).toHaveAttribute('data-chassis-mode', 'smp');
    });
});
