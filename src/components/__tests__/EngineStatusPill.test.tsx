import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { EngineStatusPill } from '../EngineStatusPill';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

const defaultVoice = (override = {}) => ({
    label: 'A',
    waveform: 'sawtooth',
    engine303: undefined as undefined,
    ...override,
});

describe('EngineStatusPill', () => {
    beforeEach(() => {
        engineDegradationStore.clear('gpu-knobs');
        engineDegradationStore.clear('open303');
        engineDegradationStore.clear('rust');
    });

    it('renders nothing when all voices use default engines', () => {
        const { container } = render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it('shows a JC303 pill when synthB has engine303="jc303"', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A' })}
                synthB={defaultVoice({ label: 'B', waveform: '303-saw', engine303: 'jc303' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        const pill = screen.getByText('B:JC303');
        expect(pill).toBeInTheDocument();
    });

    it('shows a JC303 pill when bass2 has engine303="jc303"', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2', waveform: '303-saw', engine303: 'jc303' })}
            />
        );
        expect(screen.getByText('B2:JC303')).toBeInTheDocument();
    });

    it('shows a JC303 pill when synthA has engine303="jc303"', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: '303-saw', engine303: 'jc303' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.getByText('A:JC303')).toBeInTheDocument();
    });

    it('shows a PROPHECY pill when synthA has a prophecy-* waveform', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: 'prophecy-saw' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.getByText('A:PROPHECY')).toBeInTheDocument();
    });

    it('shows a PROPHECY pill when synthB has a prophecy-* waveform', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A' })}
                synthB={defaultVoice({ label: 'B', waveform: 'prophecy-sqr' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.getByText('B:PROPHECY')).toBeInTheDocument();
    });

    it('shows multiple pills when multiple voices use non-default engines', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: '303-saw', engine303: 'jc303' })}
                synthB={defaultVoice({ label: 'B', waveform: 'prophecy-saw' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.getByText('A:JC303')).toBeInTheDocument();
        expect(screen.getByText('B:PROPHECY')).toBeInTheDocument();
    });

    it('does not show a pill for a voice with open303 engine (default)', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: '303-saw', engine303: 'open303' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.queryByText('A:JC303')).not.toBeInTheDocument();
        expect(screen.queryByText('A:PROPHECY')).not.toBeInTheDocument();
    });

    // ── Accessibility ────────────────────────────────────────────────────────

    it('has role="status" for live-region semantics', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: '303-saw', engine303: 'jc303' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('each pill has a descriptive aria-label', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: '303-saw', engine303: 'jc303' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        const pill = screen.getByText('A:JC303');
        expect(pill).toHaveAttribute('aria-label');
        expect(pill.getAttribute('aria-label')).toMatch(/JC303/i);
    });

    it('each pill has a descriptive title tooltip', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: 'prophecy-tri' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        const pill = screen.getByText('A:PROPHECY');
        expect(pill).toHaveAttribute('title');
        expect(pill.getAttribute('title')).toMatch(/Prophecy/i);
    });

    it('container has descriptive aria-label', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: '303-saw', engine303: 'jc303' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        expect(screen.getByLabelText('Active engine indicators')).toBeInTheDocument();
    });

    it('prefers PROPHECY label over JC303 when waveform is prophecy-* regardless of engine303', () => {
        render(
            <EngineStatusPill
                synthA={defaultVoice({ label: 'A', waveform: 'prophecy-pulse', engine303: 'jc303' })}
                synthB={defaultVoice({ label: 'B' })}
                bass2={defaultVoice({ label: 'B2' })}
            />
        );
        // Prophecy waveform should produce PROPHECY pill, not JC303
        expect(screen.getByText('A:PROPHECY')).toBeInTheDocument();
        expect(screen.queryByText('A:JC303')).not.toBeInTheDocument();
    });
});
