import React, { useCallback, useState } from 'react';
import { useAppStateSlice } from '../../contexts/AppStateContext';
import { HardwareChassis } from '../chassis/HardwareChassis';
import { OscillatorSignatureIcon } from '../chassis/OscillatorSignatureIcon';
import { ChassisVoiceDeck } from '../chassis/ChassisVoiceDeck';
import {
    DEFAULT_SAMPLER_CHASSIS_MODE,
    chassisModeHasVoiceDeck,
    isSamplerChassisMode,
    resolveChassisMode,
    trackForChassisMode,
    type ChassisMode,
    type SamplerChassisMode,
} from '../chassis/chassisModes';
import { OSCILLATOR_ACCENT_HEX, OSCILLATOR_THEMES, waveformToOscillatorType } from '../oscillatorThemes';
import type { TrackKey } from '../../constants/appDefaults';

const CHASSIS_KEYS = [
    'selectedTrack', 'setSelectedTrack', 'synthA', 'synthB', 'bass2',
    'activeSamplerBank', 'ttsPhrases', 'handleTtsPhraseChange', 'handleGenerateTTS',
] as const;

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

/** Modes with a live panel; TTS / VD host the sampler + voice deck (#1582), PCF follows in #1586. */
const LIVE_MODES: readonly ChassisMode[] = ['osc', 'drm', 'smp', 'tts', 'vd'];

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
 * between oscillator, drum and sampler panels. With the sampler selected the
 * stage expands to the voice deck (TTS phrase + GEN + Voice Designer, #1582);
 * SMP collapses it back to the plain rack, and any synth / drum track collapses
 * it entirely. The deck is the chassis's secondary panel, so it opens and
 * closes with the same morph + reveal as every other footprint change. The hosted nodes are the same
 * components the default layout renders — no handler or state changes. They
 * are passed in (like Studio3D) so this lazy chunk never pulls them out of
 * the entry bundle.
 */
export const ChassisNode = React.memo(({ isCompact, sequencer, rack, keyboard }: ChassisNodeProps) => {
    const {
        selectedTrack, setSelectedTrack, synthA, synthB, bass2,
        activeSamplerBank, ttsPhrases, handleTtsPhraseChange, handleGenerateTTS,
    } = useAppStateSlice(CHASSIS_KEYS);
    // Which sampler view (SMP rack / TTS deck / full VD) the sampler track opens
    // in. Remembered across track switches so returning to the sampler restores it.
    const [samplerMode, setSamplerMode] = useState<SamplerChassisMode>(DEFAULT_SAMPLER_CHASSIS_MODE);
    const mode = resolveChassisMode(selectedTrack, samplerMode);
    const showDeck = chassisModeHasVoiceDeck(mode);
    const synth = selectedTrack === 'partA' ? synthA
        : selectedTrack === 'partB' ? synthB
            : selectedTrack === 'bass2' ? bass2
                : null;
    const oscType = synth ? waveformToOscillatorType(synth.waveform, synth.engine303) : null;
    const trackLabel = selectedTrack === 'sampler'
        ? `${TRACK_BADGE.sampler} · Bank ${activeSamplerBank + 1}`
        : TRACK_BADGE[selectedTrack] ?? selectedTrack;
    const badgeDetail = oscType
        ? `${trackLabel} · ${OSCILLATOR_THEMES[oscType].badge ?? OSCILLATOR_THEMES[oscType].label}`
        : trackLabel;

    const handleModeChange = useCallback((next: ChassisMode) => {
        if (isSamplerChassisMode(next)) setSamplerMode(next);
        const track = trackForChassisMode(next, selectedTrack);
        if (track && track !== selectedTrack) setSelectedTrack(track);
    }, [selectedTrack, setSelectedTrack]);

    return (
        <HardwareChassis
            mode={mode}
            // Type switches re-run the panel entry so the new art + theme land
            // as a fresh module, without remounting the rack (#1585).
            panelKey={oscType ? `${selectedTrack}:${oscType}` : selectedTrack}
            accent={oscType ? OSCILLATOR_ACCENT_HEX[oscType] : undefined}
            theme={oscType ?? undefined}
            badgeAccent={oscType ? OSCILLATOR_ACCENT_HEX[oscType] : undefined}
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
            secondary={showDeck ? (
                <ChassisVoiceDeck
                    bankIdx={activeSamplerBank}
                    phrases={ttsPhrases}
                    onPhrasesChange={handleTtsPhraseChange}
                    onGenerate={handleGenerateTTS}
                    expanded={mode === 'vd'}
                />
            ) : undefined}
        >
            {/* The rack is the primary panel in every mode, so it (and its GPU
                knob slots) never remounts; the voice deck opens under it as the
                chassis's `below` secondary only in TTS / VD. */}
            <div className="absolute inset-0">{rack}</div>
        </HardwareChassis>
    );
});

ChassisNode.displayName = 'ChassisNode';
