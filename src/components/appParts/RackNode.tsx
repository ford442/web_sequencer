import React, { useMemo, memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
import { HardwareModule } from '../HardwareModule'
import { SamplerVoicePanel } from '../SamplerVoicePanel'
import { Rack } from '../Rack'
import { COLOR_LEAD, COLOR_BASS, COLOR_BASS2, COLOR_KICK, COLOR_SNARE, COLOR_CH, COLOR_OH, COLOR_SAMPLER } from '../../constants/appDefaults'

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
  } = useAppStateContext()

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

  const rackModulePartA = useMemo(() => <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={synthAControls} onParamChange={onSynthAParamChange} is3D={is3DMode}>{synthAChild}</HardwareModule>, [synthAControls, onSynthAParamChange, is3DMode, synthAChild])
  const rackModulePartB = useMemo(() => <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={synthBControls} onParamChange={onSynthBParamChange} is3D={is3DMode} titleBadge={synthBTitleBadge}>{synthBChild}</HardwareModule>, [synthBControls, onSynthBParamChange, is3DMode, synthBChild, synthBTitleBadge])
  const rackModuleBass2 = useMemo(() => <HardwareModule title="BASS 2 // TB-303" colorHex={COLOR_BASS2} controls={bass2Controls} onParamChange={onBass2ParamChange} is3D={is3DMode} titleBadge={bass2TitleBadge}>{bass2Child}</HardwareModule>, [bass2Controls, onBass2ParamChange, is3DMode, bass2Child, bass2TitleBadge])
  const rackModuleKick = useMemo(() => <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={kickControls} onParamChange={handleKickChange} is3D={is3DMode} />, [kickControls, handleKickChange, is3DMode])
  const rackModuleSnare = useMemo(() => <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={snareControls} onParamChange={handleSnareChange} is3D={is3DMode} />, [snareControls, handleSnareChange, is3DMode])
  const rackModuleClosedHat = useMemo(() => <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={closedHatControls} onParamChange={handleClosedHatChange} is3D={is3DMode} />, [closedHatControls, handleClosedHatChange, is3DMode])
  const rackModuleOpenHat = useMemo(() => <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={openHatControls} onParamChange={handleOpenHatChange} is3D={is3DMode} />, [openHatControls, handleOpenHatChange, is3DMode])
  const rackModuleSampler = useMemo(() => (
    <SamplerVoicePanel
      title={`SAMPLER // BANK ${activeSamplerBank + 1}`}
      colorHex={COLOR_SAMPLER}
      controls={samplerControls}
      onParamChange={handleSamplerChange}
      is3D={is3DMode}
      {...samplerVoiceParams}
      onSamplerParamChange={handleSamplerVoiceChange}
      harmonizerConfig={harmonizerConfig}
      onHarmonizerConfigChange={handleHarmonizerConfigChange}
      isHarmonizeActive={isHarmonizeActive}
    >
      {samplerChild}
    </SamplerVoicePanel>
  ), [activeSamplerBank, samplerControls, handleSamplerChange, is3DMode, samplerVoiceParams, handleSamplerVoiceChange, harmonizerConfig, handleHarmonizerConfigChange, isHarmonizeActive, samplerChild])

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
