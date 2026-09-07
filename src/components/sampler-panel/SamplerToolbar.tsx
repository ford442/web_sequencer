import React from 'react';
import { LoadingButton } from '../LoadingButton';
import { HelpIconButton, HelpTip } from '../help/HelpTip';

interface SamplerToolbarProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isRecording: boolean;
  toggleRecording: () => void;
  currentTtsText: string;
  setCurrentTtsText: (text: string) => void;
  ttsReady: boolean;
  isGenerating: boolean;
  handleTTS: () => void;
  onOpenEditor?: () => void;
  isVoiceEditorOpen?: boolean;
  chordType: string;
  setChordType: (type: string) => void;
  isProcessingHarmonize: boolean;
  handleHarmonizeClick: () => void;
  onHarmonize?: boolean;
  harmonyMix: number;
  setHarmonyMix: (mix: number) => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const SamplerToolbar: React.FC<SamplerToolbarProps> = React.memo(({
  fileInputRef,
  handleFileChange,
  isRecording,
  toggleRecording,
  currentTtsText,
  setCurrentTtsText,
  ttsReady,
  isGenerating,
  handleTTS,
  onOpenEditor,
  isVoiceEditorOpen,
  chordType,
  setChordType,
  isProcessingHarmonize,
  handleHarmonizeClick,
  onHarmonize,
  harmonyMix,
  setHarmonyMix,
}) => {
  return (
    <div className="flex flex-col gap-2 bg-gray-800/20 p-2 rounded border border-gray-800">
      {/* Row A: Load / Record */}
      <div className="flex justify-between items-center gap-2">
        <div className="flex gap-1" role="toolbar" aria-label="Sample Management">
          <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" aria-label="Load Sample File" />
          <button type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 rounded border border-gray-600 hover:bg-gray-600 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 text-[10px] font-bold text-gray-300"
            aria-label="Load Sample from File"
            title="Load audio file into current bank"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            LOAD
          </button>
          <button type="button"
            onClick={toggleRecording}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 text-[10px] font-bold transition-colors ${
              isRecording
                ? 'bg-red-900 border-red-500 animate-pulse text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                : 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:text-white text-gray-300'
            }`}
            aria-label={isRecording ? "Stop Recording" : "Record Sample from Microphone"}
            title={isRecording ? "Stop recording audio" : "Record audio from microphone"}
          >
            {isRecording ? (
              <div className="w-2 h-2 bg-white rounded-sm" />
            ) : (
              <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
            )}
            {isRecording ? 'STOP' : 'REC'}
          </button>
        </div>
      </div>

      {/* Row B: TTS */}
      <div className="flex gap-1 items-center">
        <HelpIconButton topicId="sampler-tts" className="shrink-0" />
        <div className="relative flex-1 flex items-center">
          <input
            value={currentTtsText}
            onChange={e => setCurrentTtsText(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-1 pr-4 text-white text-[10px] outline-none focus-visible:border-purple-500 h-5"
            placeholder="Phrase..."
            aria-label="Text to Speech Phrase"
          />
          {currentTtsText && (
            <button type="button"
              onClick={() => setCurrentTtsText('')}
              className="absolute right-1 text-gray-500 hover:text-white text-[10px] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
              aria-label="Clear Text-to-Speech phrase input"
              title="Clear Text-to-Speech phrase input"
            ><span aria-hidden="true">✕</span></button>
          )}
        </div>
        <div
          className={`w-2 h-2 border border-black shadow-sm flex-shrink-0 rounded-full transition-colors ${ttsReady ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}
          role="status"
          aria-label={ttsReady ? 'TTS engine ready' : 'TTS engine unavailable'}
          title={ttsReady ? "TTS Engine Ready" : "TTS Engine Loading/Unavailable"}
        />
        <HelpTip topicId="sampler-tts" position="bottom">
        <LoadingButton
          onClick={handleTTS}
          disabled={!ttsReady}
          isLoading={isGenerating}
          loadingText="GEN"
          spinnerColor="text-purple-200"
          className="flex items-center justify-center gap-1.5 px-2 h-5 bg-purple-900 border border-purple-600 text-purple-200 rounded text-[10px] hover:bg-purple-800 disabled:opacity-50 transition-all"
          aria-label={
            isGenerating
              ? 'Generating TTS voice for current bank...'
              : 'Generate TTS voice for current bank'
          }
          title={
            !ttsReady
              ? 'TTS engine not ready'
              : isGenerating
                ? 'Generating TTS voice...'
                : 'Generate TTS voice for current bank'
          }
        >
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1M12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
          </svg>
          GEN
        </LoadingButton>
        </HelpTip>
        {onOpenEditor && (
          <HelpTip topicId="voice-designer" position="bottom">
          <button type="button"
            onClick={onOpenEditor}
            aria-haspopup="dialog"
            aria-expanded={isVoiceEditorOpen}
            className="text-[10px] text-purple-400 underline hover:text-white px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
            aria-label="Open Voice Editor for current bank"
          >
            EDIT
          </button>
          </HelpTip>
        )}
      </div>

      {/* Row C: Harmonizer */}
      <div className="flex gap-1 items-center">
        <select
          value={chordType}
          onChange={(e) => setChordType(e.target.value)}
          aria-label="Harmonization Chord Type"
          className="flex-1 bg-gray-900 text-[10px] text-gray-300 border border-gray-700 rounded px-1 h-5 outline-none focus-visible:border-purple-500 focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <option value="major">Major</option>
          <option value="minor">Minor</option>
          <option value="maj7">Major 7</option>
          <option value="min7">Minor 7</option>
          <option value="octave">Octave</option>
          <option value="stack">Power Stack</option>
        </select>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isProcessingHarmonize ? "Applying harmonization, please wait..." : ""}
        </div>
        <button type="button"
          onClick={handleHarmonizeClick}
          disabled={isProcessingHarmonize || !onHarmonize}
          className={`flex items-center gap-1.5 px-2 h-5 bg-cyan-900 border border-cyan-600 text-cyan-200 rounded text-[10px] hover:bg-cyan-800 disabled:opacity-50 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 transition-all ${isProcessingHarmonize ? 'cursor-wait' : ''}`}
          aria-label={
            isProcessingHarmonize
              ? 'Applying Harmonization...'
              : !onHarmonize
                ? 'Harmonizer unavailable'
                : 'Apply Harmonization'
          }
          title={
            isProcessingHarmonize
              ? 'Applying harmonization…'
              : !onHarmonize
                ? 'Harmonizer unavailable for this bank'
                : 'Apply 3rd, 5th, and octave layers'
          }
          aria-busy={isProcessingHarmonize}
        >
          {isProcessingHarmonize ? (
            <svg aria-hidden="true" className="animate-spin h-2.5 w-2.5 text-cyan-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
            </svg>
          )}
          HARM
        </button>
        <label className="flex items-center gap-1 text-[9px] text-gray-400 shrink-0">
          <span className="sr-only">Harmony mix</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={harmonyMix}
            onChange={(e) => setHarmonyMix(Number(e.target.value))}
            aria-label="Harmony mix"
            className="w-14 h-5 accent-cyan-500"
            disabled={!onHarmonize}
          />
        </label>
      </div>
    </div>
  );
});
