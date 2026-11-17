import React, { useCallback, useState } from 'react';
import { useAppStateSlice } from '../../contexts/AppStateContext';
import { HardwareChassis } from '../chassis/HardwareChassis';
import { OscillatorSignatureIcon } from '../chassis/OscillatorSignatureIcon';
import { ChassisVoiceDeck } from '../chassis/ChassisVoiceDeck';
import { ChassisPatchDeck, ChassisPcfPlate } from '../chassis/ChassisPcfDeck';
import {
    DEFAULT_SAMPLER_CHASSIS_MODE,
    chassisModeHasVoiceDeck,
    chassisModeHidesRack,
    isPanelChassisMode,
    isSamplerChassisMode,
    resolveChassisMode,
    trackForChassisMode,
    type ChassisMode,
    type OpenChassisPanel,
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

/**
 * Modes with a live panel: every mode. TTS / VD host the sampler + voice deck
 * (#1582); PCF hosts the filter plate + patch bay (#1586).
 */
const LIVE_MODES: readonly ChassisMode[] = ['osc', 'drm', 'smp', 'tts', 'vd', 'pcf'];

interface ChassisNodeProps {
    isCompact: boolean;
    /** The live step sequencer (top anchor). */
    sequencer: React.ReactNode;
    /** The live rack (morphing stage). */
    rack: React.ReactNode;
    /** The live key bed (bottom anchor). */
    keyboard: React.ReactNode;
    /** The master loudness / limiter strip (fixed footer under the key bed). */
    master?: React.ReactNode;
}

/**
 * Live layout inside the white chassis (opt-in via `?chassis=white`, #1580):
 * the step sequencer is the fixed top anchor, the key bed the fixed bottom
 * anchor, and the rack is the stage that morphs as the selected track moves
 * between oscillator, drum and sampler panels. The PCF key opens the filter
 * plate with the patch bay beside it over the current track (#1586). With the sampler selected the
 * stage expands to the voice deck (TTS phrase + GEN + Voice Designer, #1582);
 * SMP collapses it back to the plain rack, and any synth / drum track collapses
 * it entirely. The deck is the chassis's secondary panel, so it opens and
 * closes with the same morph + reveal as every other footprint change. The hosted nodes are the same
 * components the default layout renders — no handler or state changes. They
 * are passed in (like Studio3D) so this lazy chunk never pulls them out of
 * the entry bundle.
 */
export const ChassisNode = React.memo(({ isCompact, sequencer, rack, keyboard, master }: ChassisNodeProps) => {
    const {
        selectedTrack, setSelectedTrack, synthA, synthB, bass2,
        activeSamplerBank, ttsPhrases, handleTtsPhraseChange, handleGenerateTTS,
    } = useAppStateSlice(CHASSIS_KEYS);
    // Which sampler view (SMP rack / TTS deck / full VD) the sampler track opens
    // in. Remembered across track switches so returning to the sampler restores it.
    const [samplerMode, setSamplerMode] = useState<SamplerChassisMode>(DEFAULT_SAMPLER_CHASSIS_MODE);
    // An open panel mode (PCF) and the track it was opened over. It only shows
    // while that track stays selected, so picking a track anywhere collapses it.
    const [panel, setPanel] = useState<OpenChassisPanel | null>(null);
    // Another track was selected: drop the panel for good (adjusting state
    // during render, so the collapsed mode lands in this same pass), so coming
    // back to the original track does not reopen it.
    if (panel && panel.track !== selectedTrack) setPanel(null);
    // PCF node the filter plate drives (null = the master PCF).
    const [pcfNode, setPcfNode] = useState<string | null>(null);
    const mode = resolveChassisMode(selectedTrack, samplerMode, panel);
    const showDeck = chassisModeHasVoiceDeck(mode);
    const showPcf = mode === 'pcf';
    const hideRack = chassisModeHidesRack(mode);
    const synth = selectedTrack === 'partA' ? synthA
        : selectedTrack === 'partB' ? synthB
            : selectedTrack === 'bass2' ? bass2
                : null;
    const oscType = synth ? waveformToOscillatorType(synth.waveform, synth.engine303) : null;
    const trackLabel = selectedTrack === 'sampler'
        ? `${TRACK_BADGE.sampler} · Bank ${activeSamplerBank + 1}`
        : TRACK_BADGE[selectedTrack] ?? selectedTrack;
    const badgeDetail = showPcf
        ? `${pcfNode ? `PCF · ${pcfNode}` : 'Master PCF'} · Patch bay`
        : oscType
            ? `${trackLabel} · ${OSCILLATOR_THEMES[oscType].badge ?? OSCILLATOR_THEMES[oscType].label}`
            : trackLabel;
    // The oscillator theme only applies while the synth panel owns the stage.
    const themed = oscType && !hideRack ? oscType : null;

    const handleModeChange = useCallback((next: ChassisMode) => {
        if (isPanelChassisMode(next)) {
            setPanel({ mode: next, track: selectedTrack });
            return;
        }
        setPanel(null);
        if (isSamplerChassisMode(next)) setSamplerMode(next);
        const track = trackForChassisMode(next, selectedTrack);
        if (track && track !== selectedTrack) setSelectedTrack(track);
    }, [selectedTrack, setSelectedTrack]);

    const handleSelectPcfNode = useCallback((id: string) => setPcfNode(id), []);

    return (
        <HardwareChassis
            mode={mode}
            // Type switches re-run the panel entry so the new art + theme land
            // as a fresh module, without remounting the rack (#1585).
            panelKey={showPcf ? 'pcf' : themed ? `${selectedTrack}:${themed}` : selectedTrack}
            accent={themed ? OSCILLATOR_ACCENT_HEX[themed] : undefined}
            theme={themed ?? undefined}
            badgeAccent={themed ? OSCILLATOR_ACCENT_HEX[themed] : undefined}
            modes={LIVE_MODES}
            onModeChange={handleModeChange}
            badgeDetail={badgeDetail}
            badgeIcon={themed ? <OscillatorSignatureIcon type={themed} className="hyphon-chassis__badge-icon" /> : undefined}
            compact={isCompact}
            ledStrip={(
                <div className={isCompact ? 'h-[min(42vh,360px)] min-h-[240px]' : 'h-[440px]'}>
                    {sequencer}
                </div>
            )}
            keybed={keyboard}
            footer={master}
            secondary={showDeck ? (
                <ChassisVoiceDeck
                    bankIdx={activeSamplerBank}
                    phrases={ttsPhrases}
                    onPhrasesChange={handleTtsPhraseChange}
                    onGenerate={handleGenerateTTS}
                    expanded={mode === 'vd'}
                />
            ) : showPcf ? (
                <ChassisPatchDeck onSelectPcfNode={handleSelectPcfNode} />
            ) : undefined}
        >
            {/* The rack stays mounted in every mode, so it (and its GPU knob
                slots) never remounts: the voice deck opens under it as the
                `below` secondary in TTS / VD, and in PCF it is hidden while the
                filter plate takes the primary slot and the patch bay the
                `side` secondary. */}
            <div className="absolute inset-0" hidden={hideRack} data-testid="chassis-rack">{rack}</div>
            {showPcf && <ChassisPcfPlate nodeId={pcfNode} onSelectNode={handleSelectPcfNode} />}
        </HardwareChassis>
    );
});

ChassisNode.displayName = 'ChassisNode';
