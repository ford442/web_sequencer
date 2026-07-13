import React, { useMemo, useCallback, memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
import { HardwareModule, type KnobConfig } from '../HardwareModule'
import { SamplerVoicePanel } from '../SamplerVoicePanel'
import { Rack } from '../Rack'
import { COLOR_LEAD, COLOR_BASS, COLOR_BASS2, COLOR_KICK, COLOR_SNARE, COLOR_CH, COLOR_OH, COLOR_SAMPLER } from '../../constants/appDefaults'
import { useAutomationStore } from '../../stores/automationStore'
import { midiMapStore, useMidiMapStore } from '../../stores/midiMapStore'
import { registerMidiControlTouch, startMidiLearnForControl } from '../../hooks/useMidi'
import { makeMidiControlId } from '../../types/midi'
import type { AutomationTarget, AutomationRecordArm, UnifiedAutomationLane } from '../../types'
import { NUM_STEPS } from '../../constants'
import { sampleLaneArcValues } from '../../utils/knobAutomationCurve'
import type { TrackKey } from '../../constants/appDefaults'

/** Stamp each KnobConfig with isRecording and isAutomated/automatedValue flags from the store. */
function applyControlFlags(
  controls: KnobConfig[],
  target: AutomationTarget,
  recordArms: AutomationRecordArm[],
  liveValues: Record<string, number>
): KnobConfig[] {
  return controls.map((c) => {
    const armed = recordArms.some((a) => a.target === target && a.parameter === c.id && a.armed);
    const key = `${target}:${c.id}`;
    const automatedValue = liveValues[key];
    const isAutomated = automatedValue !== undefined;
    // Return same reference when nothing changed (avoids downstream re-renders).
    // Use explicit undefined equality to avoid edge cases with undefined comparisons.
    const valueUnchanged = (automatedValue === undefined && c.automatedValue === undefined) || automatedValue === c.automatedValue;
    if (armed === c.isRecording && isAutomated === c.isAutomated && valueUnchanged) return c;
    return { ...c, isRecording: armed, isAutomated, automatedValue };
  });
}

function applyMidiFlags(
  controls: KnobConfig[],
  target: AutomationTarget,
  mappings: ReturnType<typeof useMidiMapStore>['mappings'],
  activeControls: ReturnType<typeof useMidiMapStore>['activeControls'],
): KnobConfig[] {
  return controls.map((c) => {
    const controlId = makeMidiControlId(target, c.id);
    const mapped = mappings.some((m) => m.controlId === controlId);
    const active = activeControls[controlId] !== undefined;
    if (mapped === c.isMidiMapped && active === c.isMidiActive) return c;
    return { ...c, isMidiMapped: mapped, isMidiActive: active };
  });
}

function makeMidiHandlers(target: AutomationTarget) {
  return {
    onMidiTouch: (paramId: string) => registerMidiControlTouch(target, paramId),
    onMidiLearnStart: (paramId: string) => startMidiLearnForControl(target, paramId),
    isMidiMapped: (paramId: string) => midiMapStore.isControlMapped(makeMidiControlId(target, paramId)),
    isMidiActive: (paramId: string) => midiMapStore.getState().activeControls[makeMidiControlId(target, paramId)] !== undefined,
  };
}

function makeAutomationHandlers(
  target: AutomationTarget,
  patternIndex: number,
  handleAutomationNudge: (t: AutomationTarget, paramId: string, value: number, step: number) => void,
  handleAutomationPunchIn: (t: AutomationTarget, paramId: string) => void,
  handleAutomationLaneAction: (t: AutomationTarget, action: 'toggle' | 'clear', paramId?: string) => void,
) {
  return {
    automationTarget: target,
    patternIndex,
    onAutomationNudge: (paramId: string, value: number, step: number) =>
      handleAutomationNudge(target, paramId, value, step),
    onAutomationPunchIn: (paramId: string) => handleAutomationPunchIn(target, paramId),
    onAutomationLaneAction: (action: 'toggle' | 'clear', paramId?: string) =>
      handleAutomationLaneAction(target, action, paramId),
  };
}

const TARGET_SLOT: Partial<Record<AutomationTarget, TrackKey>> = {
  synthA: 'partA',
  synthB: 'partB',
  bass2: 'bass2',
  kick: 'kick',
  snare: 'snare',
  closedHat: 'closedHat',
  openHat: 'openHat',
  sampler: 'sampler',
};

function applyAutomationPreviewFlags(
  controls: KnobConfig[],
  target: AutomationTarget,
  lanes: UnifiedAutomationLane[],
  patternIndex: number,
  showHardwareAutomation: boolean,
): KnobConfig[] {
  return controls.map((c) => {
    const matching = lanes.filter((l) => l.target === target && l.parameter === c.id);
    const activeLane = matching.find(
      (l) => l.enabled && (l.scope === 'song' || l.patternIndex === patternIndex),
    );
    const hasLane = matching.length > 0;
    const curveSamples = activeLane ? sampleLaneArcValues(activeLane, NUM_STEPS) : [];
    const automationPreview = hasLane
      ? {
          laneId: activeLane?.id ?? matching[0].id,
          curveSamples,
          hasLane,
          laneEnabled: activeLane?.enabled ?? false,
        }
      : undefined;
    const automationDimmed = showHardwareAutomation && !hasLane;
    if (
      c.automationPreview?.laneId === automationPreview?.laneId &&
      c.automationDimmed === automationDimmed &&
      (c.automationPreview?.curveSamples.length ?? 0) === curveSamples.length
    ) {
      return c;
    }
    return { ...c, automationPreview, automationDimmed };
  });
}

export const RackNode = React.memo(() => {
  const {
    is3DMode,
    synthAControls,
    synthBControls,
    bass2Controls,
    kickControls,
    snareControls,
    closedHatControls,
    openHatControls,
    samplerControls,
    onSynthAParamChange,
    onSynthBParamChange,
    onBass2ParamChange,
    handleKickChange,
    handleSnareChange,
    handleClosedHatChange,
    handleOpenHatChange,
    handleSamplerChange,
    handleKnobRecordToggle,
    synthAChild,
    synthBChild,
    bass2Child,
    samplerChild,
    activeSamplerBank,
    samplerVoiceParams,
    handleSamplerVoiceChange,
    harmonizerConfig,
    handleHarmonizerConfigChange,
    isHarmonizeActive,
    setSelectedTrack,
    selectedTrack,
    synthB,
    bass2,
    drumKit,
    updateDrumKit,
    activeTrackSlots,
    handleAutomationNudge,
    handleAutomationPunchIn,
    handleAutomationLaneAction,
  } = useAppStateContext()

  // Subscribe to record-arm state and live automated values for knob indicators
  const { recordArms, liveAutomatedValues, lanes, showHardwareAutomation } = useAutomationStore()
  const { mappings, activeControls } = useMidiMapStore()

  // Per-target onRecordToggle callbacks (stable — only depends on handleKnobRecordToggle)
  const onRecordToggleSynthA = useCallback((id: string) => handleKnobRecordToggle('synthA', id), [handleKnobRecordToggle])
  const onRecordToggleSynthB = useCallback((id: string) => handleKnobRecordToggle('synthB', id), [handleKnobRecordToggle])
  const onRecordToggleBass2 = useCallback((id: string) => handleKnobRecordToggle('bass2', id), [handleKnobRecordToggle])
  const onRecordToggleKick = useCallback((id: string) => handleKnobRecordToggle('kick', id), [handleKnobRecordToggle])
  const onRecordToggleSnare = useCallback((id: string) => handleKnobRecordToggle('snare', id), [handleKnobRecordToggle])
  const onRecordToggleClosedHat = useCallback((id: string) => handleKnobRecordToggle('closedHat', id), [handleKnobRecordToggle])
  const onRecordToggleOpenHat = useCallback((id: string) => handleKnobRecordToggle('openHat', id), [handleKnobRecordToggle])
  const onRecordToggleSampler = useCallback((id: string) => handleKnobRecordToggle('sampler', id), [handleKnobRecordToggle])

  // Controls with live isRecording + isAutomated/automatedValue flags — all targets in one memo
  // so a single store update doesn't trigger 8 separate reconciliations.
  const patternIndexFor = useCallback((target: AutomationTarget) => {
    const slot = TARGET_SLOT[target];
    return slot ? (activeTrackSlots[slot] ?? 0) : 0;
  }, [activeTrackSlots]);

  const armedControlsMap = useMemo(() => {
    const withAutomation = {
      synthA:    applyControlFlags(synthAControls,    'synthA',    recordArms, liveAutomatedValues),
      synthB:    applyControlFlags(synthBControls,    'synthB',    recordArms, liveAutomatedValues),
      bass2:     applyControlFlags(bass2Controls,     'bass2',     recordArms, liveAutomatedValues),
      kick:      applyControlFlags(kickControls,      'kick',      recordArms, liveAutomatedValues),
      snare:     applyControlFlags(snareControls,     'snare',     recordArms, liveAutomatedValues),
      closedHat: applyControlFlags(closedHatControls, 'closedHat', recordArms, liveAutomatedValues),
      openHat:   applyControlFlags(openHatControls,   'openHat',   recordArms, liveAutomatedValues),
      sampler:   applyControlFlags(samplerControls,   'sampler',   recordArms, liveAutomatedValues),
    };
    const withMidi = {
      synthA:    applyMidiFlags(withAutomation.synthA,    'synthA',    mappings, activeControls),
      synthB:    applyMidiFlags(withAutomation.synthB,    'synthB',    mappings, activeControls),
      bass2:     applyMidiFlags(withAutomation.bass2,     'bass2',     mappings, activeControls),
      kick:      applyMidiFlags(withAutomation.kick,      'kick',      mappings, activeControls),
      snare:     applyMidiFlags(withAutomation.snare,     'snare',     mappings, activeControls),
      closedHat: applyMidiFlags(withAutomation.closedHat, 'closedHat', mappings, activeControls),
      openHat:   applyMidiFlags(withAutomation.openHat,   'openHat',   mappings, activeControls),
      sampler:   applyMidiFlags(withAutomation.sampler,   'sampler',   mappings, activeControls),
    };
    return {
      synthA:    applyAutomationPreviewFlags(withMidi.synthA,    'synthA',    lanes, patternIndexFor('synthA'), showHardwareAutomation),
      synthB:    applyAutomationPreviewFlags(withMidi.synthB,    'synthB',    lanes, patternIndexFor('synthB'), showHardwareAutomation),
      bass2:     applyAutomationPreviewFlags(withMidi.bass2,     'bass2',     lanes, patternIndexFor('bass2'), showHardwareAutomation),
      kick:      applyAutomationPreviewFlags(withMidi.kick,      'kick',      lanes, patternIndexFor('kick'), showHardwareAutomation),
      snare:     applyAutomationPreviewFlags(withMidi.snare,     'snare',     lanes, patternIndexFor('snare'), showHardwareAutomation),
      closedHat: applyAutomationPreviewFlags(withMidi.closedHat, 'closedHat', lanes, patternIndexFor('closedHat'), showHardwareAutomation),
      openHat:   applyAutomationPreviewFlags(withMidi.openHat,   'openHat',   lanes, patternIndexFor('openHat'), showHardwareAutomation),
      sampler:   applyAutomationPreviewFlags(withMidi.sampler,   'sampler',   lanes, patternIndexFor('sampler'), showHardwareAutomation),
    };
  }, [synthAControls, synthBControls, bass2Controls, kickControls, snareControls, closedHatControls, openHatControls, samplerControls, recordArms, liveAutomatedValues, mappings, activeControls, lanes, showHardwareAutomation, patternIndexFor])

  /** JC303-active badge for the SYNTH B title bar (only when a 303 waveform and jc303 engine are active). */
  const synthBTitleBadge = useMemo(() => {
    const is303 = synthB.waveform === '303-saw' || synthB.waveform === '303-sqr';
    if (!is303 || (synthB.engine303 ?? 'open303') !== 'jc303') return undefined;
    return (
      <span
        className="text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-pink-950/90 text-pink-300 border border-pink-500/60 animate-pulse"
        title="Authentic JC303 (rosic::Open303) engine is active for SYNTH B"
        aria-label="JC303 engine active"
      >
        JC303
      </span>
    );
  }, [synthB.waveform, synthB.engine303]);

  /** JC303-active badge for the BASS 2 title bar. */
  const bass2TitleBadge = useMemo(() => {
    if ((bass2.engine303 ?? 'open303') !== 'jc303') return undefined;
    return (
      <span
        className="text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-pink-950/90 text-pink-300 border border-pink-500/60 animate-pulse"
        title="Authentic JC303 (rosic::Open303) engine is active for BASS 2"
        aria-label="JC303 engine active"
      >
        JC303
      </span>
    );
  }, [bass2.engine303]);

  /** Drum kit LED badge showing active 808/909 with a switcher */
  const drumKitBadge = useMemo(() => (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); updateDrumKit(drumKit === '808' ? '909' : '808'); }}
        className={`text-[7px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border transition-colors cursor-pointer ${
          drumKit === '808'
            ? 'bg-red-950/90 text-red-300 border-red-500/60'
            : 'bg-blue-950/90 text-blue-300 border-blue-500/60'
        }`}
        title={`Active: TR-${drumKit} — Click to switch`}
        aria-label={`Drum kit: TR-${drumKit}. Click to switch.`}
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-0.5 ${drumKit === '808' ? 'bg-red-400 animate-pulse' : 'bg-blue-400 animate-pulse'}`} />
        {drumKit}
      </button>
    </span>
  ), [drumKit, updateDrumKit]);

  const rackModulePartA = useMemo(() => <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={armedControlsMap.synthA} onParamChange={onSynthAParamChange} onRecordToggle={onRecordToggleSynthA} is3D={is3DMode} {...makeMidiHandlers('synthA')} {...makeAutomationHandlers('synthA', patternIndexFor('synthA'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)}>{synthAChild}</HardwareModule>, [armedControlsMap.synthA, onSynthAParamChange, onRecordToggleSynthA, is3DMode, synthAChild, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModulePartB = useMemo(() => <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={armedControlsMap.synthB} onParamChange={onSynthBParamChange} onRecordToggle={onRecordToggleSynthB} is3D={is3DMode} titleBadge={synthBTitleBadge} {...makeMidiHandlers('synthB')} {...makeAutomationHandlers('synthB', patternIndexFor('synthB'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)}>{synthBChild}</HardwareModule>, [armedControlsMap.synthB, onSynthBParamChange, onRecordToggleSynthB, is3DMode, synthBChild, synthBTitleBadge, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModuleBass2 = useMemo(() => <HardwareModule title="BASS 2 // TB-303" colorHex={COLOR_BASS2} controls={armedControlsMap.bass2} onParamChange={onBass2ParamChange} onRecordToggle={onRecordToggleBass2} is3D={is3DMode} titleBadge={bass2TitleBadge} {...makeMidiHandlers('bass2')} {...makeAutomationHandlers('bass2', patternIndexFor('bass2'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)}>{bass2Child}</HardwareModule>, [armedControlsMap.bass2, onBass2ParamChange, onRecordToggleBass2, is3DMode, bass2Child, bass2TitleBadge, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModuleKick = useMemo(() => <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={armedControlsMap.kick} onParamChange={handleKickChange} onRecordToggle={onRecordToggleKick} is3D={is3DMode} titleBadge={drumKitBadge} {...makeMidiHandlers('kick')} {...makeAutomationHandlers('kick', patternIndexFor('kick'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)} />, [armedControlsMap.kick, handleKickChange, onRecordToggleKick, is3DMode, drumKitBadge, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModuleSnare = useMemo(() => <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={armedControlsMap.snare} onParamChange={handleSnareChange} onRecordToggle={onRecordToggleSnare} is3D={is3DMode} {...makeMidiHandlers('snare')} {...makeAutomationHandlers('snare', patternIndexFor('snare'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)} />, [armedControlsMap.snare, handleSnareChange, onRecordToggleSnare, is3DMode, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModuleClosedHat = useMemo(() => <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={armedControlsMap.closedHat} onParamChange={handleClosedHatChange} onRecordToggle={onRecordToggleClosedHat} is3D={is3DMode} {...makeMidiHandlers('closedHat')} {...makeAutomationHandlers('closedHat', patternIndexFor('closedHat'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)} />, [armedControlsMap.closedHat, handleClosedHatChange, onRecordToggleClosedHat, is3DMode, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModuleOpenHat = useMemo(() => <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={armedControlsMap.openHat} onParamChange={handleOpenHatChange} onRecordToggle={onRecordToggleOpenHat} is3D={is3DMode} {...makeMidiHandlers('openHat')} {...makeAutomationHandlers('openHat', patternIndexFor('openHat'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)} />, [armedControlsMap.openHat, handleOpenHatChange, onRecordToggleOpenHat, is3DMode, patternIndexFor, handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction])
  const rackModuleSampler = useMemo(() => (
    <SamplerVoicePanel
      title={`SAMPLER // BANK ${activeSamplerBank + 1}`}
      colorHex={COLOR_SAMPLER}
      controls={armedControlsMap.sampler}
      onParamChange={handleSamplerChange}
      onRecordToggle={onRecordToggleSampler}
      is3D={is3DMode}
      {...makeMidiHandlers('sampler')}
      {...makeAutomationHandlers('sampler', patternIndexFor('sampler'), handleAutomationNudge, handleAutomationPunchIn, handleAutomationLaneAction)}
      {...samplerVoiceParams}
      onSamplerParamChange={handleSamplerVoiceChange}
      harmonizerConfig={harmonizerConfig}
      onHarmonizerConfigChange={handleHarmonizerConfigChange}
      isHarmonizeActive={isHarmonizeActive}
    >
      {samplerChild}
    </SamplerVoicePanel>
  ), [activeSamplerBank, armedControlsMap.sampler, handleSamplerChange, onRecordToggleSampler, is3DMode, samplerVoiceParams, handleSamplerVoiceChange, harmonizerConfig, handleHarmonizerConfigChange, isHarmonizeActive, samplerChild])

  const rackModules = useMemo(() => ({
    partA: rackModulePartA,
    partB: rackModulePartB,
    bass2: rackModuleBass2,
    kick: rackModuleKick,
    snare: rackModuleSnare,
    closedHat: rackModuleClosedHat,
    openHat: rackModuleOpenHat,
    sampler: rackModuleSampler,
  }), [rackModulePartA, rackModulePartB, rackModuleBass2, rackModuleKick, rackModuleSnare, rackModuleClosedHat, rackModuleOpenHat, rackModuleSampler])

  return <Rack is3DMode={is3DMode} selectedTrack={selectedTrack} onSelectTrack={setSelectedTrack} modules={rackModules} />
})

export default RackNode
