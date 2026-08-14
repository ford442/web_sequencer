import React, { memo } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { BasicNoteProperties } from "./note-selector/BasicNoteProperties";
import {
  SynthEffectProperties,
  SynthGranularEffects,
} from "./note-selector/SynthEffectProperties";
import { EffectsSendProperties } from "./note-selector/EffectsSendProperties";
import { NoteGrid } from "./note-selector/NoteGrid";
import type { NoteSelectorProps } from "./note-selector/types";

export type { NoteSelectorProps } from "./note-selector/types";

export const NoteSelector: React.FC<NoteSelectorProps> = memo(
  ({
    currentPan,
    x,
    y,
    trackType,
    currentNote,
    currentLength,
    onSelect,
    onLengthChange,
    onClose,
    getNoteColor,
    currentScale,

    currentTimbre = 0,
    currentVelocity = 1,
    currentProbability = 1,
    currentMicrotiming = 0,
    currentPitchAmount = 0,
    currentPitchAttack = 0,
    currentPitchDecay = 0,
    currentReverse = false,
    currentRetrigger = 1,
    currentFreeze = 0,
    currentFormantShift,
    currentSlideFormant = false,
    currentFilterCutoff,
    currentFilterResonance,
    currentEnvMod,
    currentCustomWindowShape,
    currentFormantLfoSync,
    currentFormantLfoRate = 0,
    currentFormantLfoDepth = 0,
    currentFormantEnvSync,
    currentFormantEnvAttack = 0.1,
    currentFormantEnvDecay = 0.5,
    currentFormantEnvAmount = 0,
    currentFormantEnvFollower = 0,
    currentFormantSidechainDepth = 0,
    currentFreezeLfoSync = false,
    currentFreezeLfoRate = 0,
    currentFreezeLfoDepth = 0,
    currentVibratoDepth = 0,
    currentTremoloDepth = 0,
    currentTremoloRate = 0,
    currentDrive,
    currentCharacterMorph = 0,
    currentReverbSend,
    currentReverbType,
    currentReverbLfoRate,
    currentReverbLfoDepth,
    currentDelayLfoRate,
    currentDelayLfoDepth,
    currentDelaySend,
    currentFreezeEnvDepth = 0,
    currentGrainEnvDepth = 0,
    currentGrainPitchEnvDepth = 0,
    currentGrainJitter = 0,
    currentGrainPitchQuantize = 0,
    currentTimeStretchEnvDepth = 0,
    currentSpectralPanRate = 0,
    currentSpectralPanDepth = 0,
    currentGranularPitchShift = 0,
    currentBitcrush = 0,
    currentDownsample = 1,
    currentChoir,
    currentVocoderMix,
    currentVocoderFormantShift,
    currentVocoderPreservation,
    currentTranceGate = 0,

    currentGateDepth = 0,
    currentGateRate = 8,
    isProphecy = false,
    currentVowel = 0,
    currentPortamento = 0,
    onPropertyChange,
  }) => {
    const dialogRef = useFocusTrap(true, onClose);

    return (
      <>
        {/* Backdrop for click-outside */}
        <div
          className="fixed inset-0 z-40 bg-transparent"
          onClick={onClose}
          aria-hidden="true"
        />

        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-selector-title"
          tabIndex={-1}
          className="fixed z-50 bg-gray-900/80 backdrop-blur-md border border-cyan-900/50 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.15)] p-3 grid gap-3 outline-none animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: Math.min(x, window.innerWidth - 320),
            top: Math.min(y, window.innerHeight - 400),
          }}
        >
          <div className="flex justify-between items-center pb-2 border-b border-cyan-900/30">
            <span
              id="note-selector-title"
              className="text-xs font-bold font-orbitron text-cyan-400 tracking-widest drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]"
            >
              NOTE PROPERTIES
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close note properties"
              title="Close note properties (Esc)"
              className="text-cyan-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-cyan-400 rounded"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          <BasicNoteProperties
            currentLength={currentLength}
            onLengthChange={onLengthChange}
            onPropertyChange={onPropertyChange}
            currentVelocity={currentVelocity}
            currentTimbre={currentTimbre}
            currentProbability={currentProbability}
            currentMicrotiming={currentMicrotiming}
            currentReverse={currentReverse}
          />

          {onPropertyChange && (
            <>
              <SynthGranularEffects
                trackType={trackType}
                onPropertyChange={onPropertyChange}
                currentFreeze={currentFreeze}
                currentFreezeLfoSync={currentFreezeLfoSync}
                currentFreezeLfoRate={currentFreezeLfoRate}
                currentFreezeLfoDepth={currentFreezeLfoDepth}
                currentFreezeEnvDepth={currentFreezeEnvDepth}
                currentGrainEnvDepth={currentGrainEnvDepth}
                currentGrainPitchEnvDepth={currentGrainPitchEnvDepth}
                currentGrainJitter={currentGrainJitter}
                currentGrainPitchQuantize={currentGrainPitchQuantize}
                currentGranularPitchShift={currentGranularPitchShift}
                currentVocoderMix={currentVocoderMix}
                currentVocoderFormantShift={currentVocoderFormantShift}
                currentVocoderPreservation={currentVocoderPreservation}
                currentBitcrush={currentBitcrush}
                currentDownsample={currentDownsample}
                currentTranceGate={currentTranceGate}
              />

              <EffectsSendProperties
                trackType={trackType}
                onPropertyChange={onPropertyChange}
                currentPan={currentPan}
                currentDelaySend={currentDelaySend}
                currentGateDepth={currentGateDepth}
                currentGateRate={currentGateRate}
                currentReverbSend={currentReverbSend}
                currentReverbType={currentReverbType}
                currentReverbLfoRate={currentReverbLfoRate}
                currentReverbLfoDepth={currentReverbLfoDepth}
                currentDelayLfoRate={currentDelayLfoRate}
                currentDelayLfoDepth={currentDelayLfoDepth}
                currentChoir={currentChoir}
              />

              <SynthEffectProperties
                trackType={trackType}
                onPropertyChange={onPropertyChange}
                isProphecy={isProphecy}
                currentFormantShift={currentFormantShift}
                currentSlideFormant={currentSlideFormant}
                currentFormantLfoSync={currentFormantLfoSync}
                currentFormantLfoRate={currentFormantLfoRate}
                currentFormantLfoDepth={currentFormantLfoDepth}
                currentTremoloRate={currentTremoloRate}
                currentTremoloDepth={currentTremoloDepth}
                currentPitchAmount={currentPitchAmount}
                currentPitchAttack={currentPitchAttack}
                currentPitchDecay={currentPitchDecay}
                currentCustomWindowShape={currentCustomWindowShape}
                currentFormantEnvSync={currentFormantEnvSync}
                currentFormantEnvAttack={currentFormantEnvAttack}
                currentFormantEnvDecay={currentFormantEnvDecay}
                currentFormantEnvAmount={currentFormantEnvAmount}
                currentFormantEnvFollower={currentFormantEnvFollower}
                currentFormantSidechainDepth={currentFormantSidechainDepth}
                currentDrive={currentDrive}
                currentVibratoDepth={currentVibratoDepth}
                currentVowel={currentVowel}
                currentPortamento={currentPortamento}
                currentCharacterMorph={currentCharacterMorph}
                currentFilterCutoff={currentFilterCutoff}
                currentFilterResonance={currentFilterResonance}
                currentEnvMod={currentEnvMod}
                currentRetrigger={currentRetrigger}
                currentTimeStretchEnvDepth={currentTimeStretchEnvDepth}
                currentSpectralPanRate={currentSpectralPanRate}
                currentSpectralPanDepth={currentSpectralPanDepth}
              />
              <p id="note-micro-desc" className="sr-only">
                Nudges the step earlier or later within the beat. Negative
                values play ahead; positive values delay.
              </p>
            </>
          )}

          <NoteGrid
            trackType={trackType}
            currentNote={currentNote}
            currentScale={currentScale}
            getNoteColor={getNoteColor}
            onSelect={onSelect}
          />
        </div>
      </>
    );
  },
);
