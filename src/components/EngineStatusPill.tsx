import React, { memo } from 'react';
import type { Engine303 } from '../types';

interface EngineVoiceStatus {
    /** Short label for the voice, e.g. "A", "B", "B2" */
    label: string;
    /** Currently active waveform (determines if 303 / Prophecy is in use) */
    waveform?: string;
    /** Engine selection for 303 voices */
    engine303?: Engine303;
}

interface EngineStatusPillProps {
    synthA: EngineVoiceStatus;
    synthB: EngineVoiceStatus;
    bass2: EngineVoiceStatus;
}

/**
 * Lightweight, always-visible engine status bar for the Transport.
 *
 * Shows a small pill for each voice that is using a non-default engine:
 *  - Pink "JC303" badge when the authentic JC303 engine is selected
 *  - Cyan "PROPHECY" badge when a prophecy-* waveform is active
 *
 * Hidden entirely when all voices are using default engines, so it only
 * takes up space when relevant.
 */
export const EngineStatusPill: React.FC<EngineStatusPillProps> = memo(({
    synthA,
    synthB,
    bass2,
}) => {
    const voices = [synthA, synthB, bass2];

    type PillEntry = { key: string; label: string; engine: string; style: string; title: string };
    const pills: PillEntry[] = [];

    for (const voice of voices) {
        const isProphecy = voice.waveform?.startsWith('prophecy-') ?? false;
        const isJc303 = (voice.engine303 ?? 'open303') === 'jc303';

        if (isProphecy) {
            pills.push({
                key: `${voice.label}-prophecy`,
                label: voice.label,
                engine: 'PROPHECY',
                style: 'bg-violet-950/90 text-violet-300 border-violet-500/60',
                title: `SYNTH ${voice.label}: Korg Prophecy formant engine active`,
            });
        } else if (isJc303) {
            pills.push({
                key: `${voice.label}-jc303`,
                label: voice.label,
                engine: 'JC303',
                style: 'bg-pink-950/90 text-pink-300 border-pink-500/60',
                title: `SYNTH ${voice.label}: Authentic JC303 engine active`,
            });
        }
    }

    if (pills.length === 0) return null;

    return (
        <div
            className="flex items-center gap-1"
            aria-label="Active engine indicators"
            role="status"
        >
            {pills.map(pill => (
                <span
                    key={pill.key}
                    className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${pill.style}`}
                    title={pill.title}
                    aria-label={pill.title}
                >
                    {pill.label}:{pill.engine}
                </span>
            ))}
        </div>
    );
});

EngineStatusPill.displayName = 'EngineStatusPill';
