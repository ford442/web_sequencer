import React, { useMemo, useCallback, memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
import { HardwareModule, type KnobConfig } from '../HardwareModule'
import { SamplerVoicePanel } from '../SamplerVoicePanel'
import { Rack } from '../Rack'
import { COLOR_LEAD, COLOR_BASS, COLOR_BASS2, COLOR_KICK, COLOR_SNARE, COLOR_CH, COLOR_OH, COLOR_SAMPLER } from '../../constants/appDefaults'
import { useAutomationStore } from '../../stores/automationStore'
import type { AutomationTarget, AutomationRecordArm } from '../../types'

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
  } = useAppStateContext()

  // Subscribe to record-arm state and live automated values for knob indicators
  const { recordArms, liveAutomatedValues } = useAutomationStore()

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
  const armedControlsMap = useMemo(() => ({
    synthA:    applyControlFlags(synthAControls,    'synthA',    recordArms, liveAutomatedValues),
    synthB:    applyControlFlags(synthBControls,    'synthB',    recordArms, liveAutomatedValues),
    bass2:     applyControlFlags(bass2Controls,     'bass2',     recordArms, liveAutomatedValues),
    kick:      applyControlFlags(kickControls,      'kick',      recordArms, liveAutomatedValues),
    snare:     applyControlFlags(snareControls,     'snare',     recordArms, liveAutomatedValues),
    closedHat: applyControlFlags(closedHatControls, 'closedHat', recordArms, liveAutomatedValues),
    openHat:   applyControlFlags(openHatControls,   'openHat',   recordArms, liveAutomatedValues),
    sampler:   applyControlFlags(samplerControls,   'sampler',   recordArms, liveAutomatedValues),
  }), [synthAControls, synthBControls, bass2Controls, kickControls, snareControls, closedHatControls, openHatControls, samplerControls, recordArms, liveAutomatedValues])

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

  const rackModulePartA = useMemo(() => <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={armedControlsMap.synthA} onParamChange={onSynthAParamChange} onRecordToggle={onRecordToggleSynthA} is3D={is3DMode}>{synthAChild}</HardwareModule>, [armedControlsMap.synthA, onSynthAParamChange, onRecordToggleSynthA, is3DMode, synthAChild])
  const rackModulePartB = useMemo(() => <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={armedControlsMap.synthB} onParamChange={onSynthBParamChange} onRecordToggle={onRecordToggleSynthB} is3D={is3DMode} titleBadge={synthBTitleBadge}>{synthBChild}</HardwareModule>, [armedControlsMap.synthB, onSynthBParamChange, onRecordToggleSynthB, is3DMode, synthBChild, synthBTitleBadge])
  const rackModuleBass2 = useMemo(() => <HardwareModule title="BASS 2 // TB-303" colorHex={COLOR_BASS2} controls={armedControlsMap.bass2} onParamChange={onBass2ParamChange} onRecordToggle={onRecordToggleBass2} is3D={is3DMode} titleBadge={bass2TitleBadge}>{bass2Child}</HardwareModule>, [armedControlsMap.bass2, onBass2ParamChange, onRecordToggleBass2, is3DMode, bass2Child, bass2TitleBadge])
  const rackModuleKick = useMemo(() => <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={armedControlsMap.kick} onParamChange={handleKickChange} onRecordToggle={onRecordToggleKick} is3D={is3DMode} titleBadge={drumKitBadge} />, [armedControlsMap.kick, handleKickChange, onRecordToggleKick, is3DMode, drumKitBadge])
  const rackModuleSnare = useMemo(() => <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={armedControlsMap.snare} onParamChange={handleSnareChange} onRecordToggle={onRecordToggleSnare} is3D={is3DMode} />, [armedControlsMap.snare, handleSnareChange, onRecordToggleSnare, is3DMode])
  const rackModuleClosedHat = useMemo(() => <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={armedControlsMap.closedHat} onParamChange={handleClosedHatChange} onRecordToggle={onRecordToggleClosedHat} is3D={is3DMode} />, [armedControlsMap.closedHat, handleClosedHatChange, onRecordToggleClosedHat, is3DMode])
  const rackModuleOpenHat = useMemo(() => <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={armedControlsMap.openHat} onParamChange={handleOpenHatChange} onRecordToggle={onRecordToggleOpenHat} is3D={is3DMode} />, [armedControlsMap.openHat, handleOpenHatChange, onRecordToggleOpenHat, is3DMode])
  const rackModuleSampler = useMemo(() => (
    <SamplerVoicePanel
      title={`SAMPLER // BANK ${activeSamplerBank + 1}`}
      colorHex={COLOR_SAMPLER}
      controls={armedControlsMap.sampler}
      onParamChange={handleSamplerChange}
      onRecordToggle={onRecordToggleSampler}
      is3D={is3DMode}
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
