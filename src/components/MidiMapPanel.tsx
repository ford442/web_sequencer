import React, { memo } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { midiMapStore, useMidiMapStore } from '../stores/midiMapStore';
import { formatMidiBindingLabel, parseMidiControlId } from '../types/midi';

interface MidiMapPanelProps {
  onClose: () => void;
}

export const MidiMapPanel = memo(function MidiMapPanel({ onClose }: MidiMapPanelProps) {
  const modalRef = useFocusTrap(true, onClose);
  const { mappings, learnMode, lastTouchedControl, inputAvailable, connectedInputs } = useMidiMapStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="absolute inset-0 z-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={modalRef}
        className="w-full max-w-lg z-10 bg-[#0f1215] border border-purple-900/50 rounded-xl shadow-[0_0_50px_rgba(168,85,247,0.2)] overflow-hidden flex flex-col max-h-[70vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="midi-map-title"
        tabIndex={-1}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50">
          <h2 id="midi-map-title" className="text-lg font-orbitron font-bold text-purple-400 tracking-widest">
            MIDI MAP
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-purple-500 rounded p-1"
            aria-label="Close MIDI Map"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-gray-400">
              {inputAvailable ? (
                <span className="text-green-400">
                  ● {connectedInputs.length} input{connectedInputs.length !== 1 ? 's' : ''}: {connectedInputs.join(', ')}
                </span>
              ) : (
                <span className="text-gray-500">No MIDI input detected — connect a controller and refresh</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => midiMapStore.toggleLearnMode()}
              aria-pressed={learnMode}
              className={`px-3 py-1 text-[10px] font-bold font-orbitron rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-purple-500 ${
                learnMode
                  ? 'bg-purple-600 text-white border-purple-400 animate-pulse'
                  : 'bg-zinc-900 text-purple-400 border-purple-900/50 hover:bg-purple-950/40'
              }`}
            >
              {learnMode ? 'LEARNING…' : 'MIDI LEARN'}
            </button>
          </div>

          {learnMode && (
            <p className="text-xs text-purple-300 bg-purple-950/30 border border-purple-800/40 rounded p-2">
              {lastTouchedControl
                ? `Touch a control, then move a knob/fader on your controller. Waiting for MIDI on: ${lastTouchedControl}`
                : 'Touch any knob or master slider, then move a controller knob/fader.'}
            </p>
          )}

          {mappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg">
              <div className="w-12 h-12 rounded-full bg-purple-900/30 flex items-center justify-center mb-4 text-purple-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <h3 className="text-gray-300 font-bold mb-2">No mappings yet</h3>
              <p className="text-gray-500 text-xs mb-6 max-w-[250px]">
                Enable MIDI Learn and touch a control on the screen, then move a physical knob on your MIDI controller.
              </p>
              {!learnMode && (
                <button type="button"
                  onClick={() => midiMapStore.toggleLearnMode()}
                  className="bg-purple-900/30 text-purple-400 border border-purple-800/50 hover:bg-purple-900/50 px-4 py-2 rounded-full text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                  aria-label="Start MIDI Learn"
                >
                  Start MIDI Learn
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-1">
              {mappings.map((m) => {
                const { target, param } = parseMidiControlId(m.controlId);
                return (
                  <li
                    key={`${formatMidiBindingLabel(m.key)}-${m.controlId}`}
                    className="flex items-center justify-between gap-2 text-sm bg-gray-900/40 border border-gray-800 rounded px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-purple-400 font-mono text-xs">{formatMidiBindingLabel(m.key)}</span>
                      <span className="text-gray-600 mx-2">→</span>
                      <span className="text-gray-300 truncate">{target}.{param}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => midiMapStore.removeBinding(m.key, m.deviceId)}
                      className="text-[10px] text-red-400 hover:text-red-300 shrink-0 px-2 py-0.5 border border-red-900/40 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-red-500"
                      aria-label={`Remove mapping for ${m.controlId}`}
                    >
                      CLEAR
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {mappings.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Clear all MIDI mappings?')) midiMapStore.clearAllBindings();
              }}
              className="w-full text-[10px] font-bold text-red-400 border border-red-900/40 rounded py-2 hover:bg-red-950/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-red-500"
              aria-label="Clear all MIDI mappings"
              title="Remove all customized MIDI controller mappings"
            >
              CLEAR ALL MAPPINGS
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
