import React, { useCallback } from 'react';
import { useAppStateSlice } from '../../contexts/AppStateContext';
import { HardwareChassis } from '../chassis/HardwareChassis';
import { OscillatorSignatureIcon } from '../chassis/OscillatorSignatureIcon';
import { chassisModeForTrack, trackForChassisMode, type ChassisMode } from '../chassis/chassisModes';
import { OSCILLATOR_THEMES, waveformToOscillatorType } from '../oscillatorThemes';
import type { TrackKey } from '../../constants/appDefaults';

const CHASSIS_KEYS = ['selectedTrack', 'setSelectedTrack', 'synthA', 'synthB', 'bass2'] as const;

/** LCD names for the track the stage is showing (rack titles, shortened). */
const TRACK_BADGE: Record<TrackKey, string> = {
    partA: 'Synth A',
    partB: 'Synth B',
    bass2: 'Bass 2',
    kick: 'Kick',
    snare: 'Snare',
    closedHat: 'Closed hat',
    openHat: 'Open hat',
    sampler: 'Sampler',
};

/** Modes that have a live rack panel today; TTS / VD / PCF hosting follows in #1582 / #1586. */
const LIVE_MODES: readonly ChassisMode[] = ['osc', 'drm', 'smp'];

interface ChassisNodeProps {
    isCompact: boolean;
    /** The live step sequencer (top anchor). */
    sequencer: React.ReactNode;
    /** The live rack (morphing stage). */
    rack: React.ReactNode;
    /** The live key bed (bottom anchor). */
    keyboard: React.ReactNode;
}

/**
 * Live layout inside the white chassis (opt-in via `?chassis=white`, #1580):
 * the step sequencer is the fixed top anchor, the key bed the fixed bottom
 * anchor, and the rack is the stage that morphs as the selected track moves
 * between oscillator, drum and sampler panels. The hosted nodes are the same
 * components the default layout renders — no handler or state changes. They
 * are passed in (like Studio3D) so this lazy chunk never pulls them out of
 * the entry bundle.
 */
export const ChassisNode = React.memo(({ isCompact, sequencer, rack, keyboard }: ChassisNodeProps) => {
    const { selectedTrack, setSelectedTrack, synthA, synthB, bass2 } = useAppStateSlice(CHASSIS_KEYS);
    const mode = chassisModeForTrack(selectedTrack);
    const synth = selectedTrack === 'partA' ? synthA
        : selectedTrack === 'partB' ? synthB
            : selectedTrack === 'bass2' ? bass2
                : null;
    const oscType = synth ? waveformToOscillatorType(synth.waveform, synth.engine303) : null;
    const trackLabel = TRACK_BADGE[selectedTrack] ?? selectedTrack;
    const badgeDetail = oscType
        ? `${trackLabel} · ${OSCILLATOR_THEMES[oscType].badge ?? OSCILLATOR_THEMES[oscType].label}`
        : trackLabel;

    const handleModeChange = useCallback((next: ChassisMode) => {
        const track = trackForChassisMode(next, selectedTrack);
        if (track && track !== selectedTrack) setSelectedTrack(track);
    }, [selectedTrack, setSelectedTrack]);

    return (
        <HardwareChassis
            mode={mode}
            panelKey={selectedTrack}
            modes={LIVE_MODES}
            onModeChange={handleModeChange}
            badgeDetail={badgeDetail}
            badgeIcon={oscType ? <OscillatorSignatureIcon type={oscType} className="hyphon-chassis__badge-icon" /> : undefined}
            compact={isCompact}
            ledStrip={(
                <div className={isCompact ? 'h-[min(42vh,360px)] min-h-[240px]' : 'h-[440px]'}>
                    {sequencer}
                </div>
            )}
            keybed={keyboard}
        >
            {rack}
        </HardwareChassis>
    );
});

ChassisNode.displayName = 'ChassisNode';
