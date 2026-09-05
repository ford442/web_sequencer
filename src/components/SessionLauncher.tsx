import React, { memo, useCallback, useMemo, useState } from 'react';
import { TRACK_KEYS } from '../constants';
import type { TrackKey } from '../constants/appDefaults';
import { midiMapStore } from '../stores/midiMapStore';
import { SESSION_PACKS } from '../session/packs';
import { LAUNCH_QUANTIZATIONS, SESSION_TRACK_LABELS, type LaunchQuantization, type SessionDocument } from '../session/types';
import { moveSessionFocus, type SessionGridFocus } from '../session/gridKeyboard';
import { sessionClipControlId, sessionSceneControlId } from '../session/midiMap';
import { startMidiLearnForControl } from '../hooks/useMidi';

interface SessionLauncherProps {
  isVisible: boolean;
  document: SessionDocument;
  playingSlots: Record<TrackKey, number | null>;
  currentStep: number;
  isCapturing: boolean;
  quantization: LaunchQuantization;
  onClose: () => void;
  onLaunchClip: (track: TrackKey, row: number) => void;
  onLaunchScene: (row: number) => void;
  onStopTrack: (track: TrackKey) => void;
  onStopAll: () => void;
  onSetQuantization: (q: LaunchQuantization) => void;
  onBeginCapture: () => void;
  onFinishCapture: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onLoadPack: (id: string) => void;
  onUpdateDocument: (next: SessionDocument) => void;
}

export const SessionLauncher = memo(function SessionLauncher({
  isVisible,
  document,
  playingSlots,
  currentStep,
  isCapturing,
  quantization,
  onClose,
  onLaunchClip,
  onLaunchScene,
  onStopTrack,
  onStopAll,
  onSetQuantization,
  onBeginCapture,
  onFinishCapture,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onLoadPack,
  onUpdateDocument,
}: SessionLauncherProps) {
  const [focus, setFocus] = useState<SessionGridFocus>({ kind: 'scene', row: 0 });
  const rowCount = document.columns.partA.clips.length;

  const queuedHint = useMemo(() => `Step ${currentStep + 1}`, [currentStep]);

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const next = moveSessionFocus(focus, e.key, rowCount);
      if (next !== focus && (e.key.startsWith('Arrow'))) {
        e.preventDefault();
        setFocus(next);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ControlLeft') {
        e.preventDefault();
        if (focus.kind === 'scene') onLaunchScene(focus.row);
        else onLaunchClip(focus.track, focus.row);
      }
      if (e.key === 'AltLeft') {
        e.preventDefault();
        onLaunchScene(focus.kind === 'scene' ? focus.row : focus.row);
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (focus.kind === 'clip') onStopTrack(focus.track);
        else onStopAll();
      }
    },
    [focus, rowCount, onLaunchClip, onLaunchScene, onStopTrack, onStopAll],
  );

  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/70 p-2 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1000px] max-h-[min(78vh,640px)] bg-[#0c1014] border border-cyan-900/50 rounded-xl shadow-[0_0_40px_rgba(6,182,212,0.15)] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-launcher-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onGridKeyDown}
      >
        <header className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-800 bg-gray-900/40">
          <h2 id="session-launcher-title" className="font-orbitron text-cyan-400 tracking-widest text-sm font-bold mr-auto">
            SESSION
          </h2>
          <label className="text-[10px] uppercase text-gray-500 flex items-center gap-1">
            Quant
            <select
              className="bg-zinc-900 border border-zinc-700 text-cyan-200 text-[11px] rounded px-1 py-0.5"
              value={quantization}
              aria-label="Launch quantization"
              onChange={(e) => onSetQuantization(e.target.value as LaunchQuantization)}
            >
              {LAUNCH_QUANTIZATIONS.map((q) => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </label>
          <span className="text-[10px] font-mono text-gray-500" aria-live="polite">{queuedHint}</span>
          <button type="button" className="h-7 px-2 text-[10px] font-orbitron border border-zinc-700 rounded" onClick={onUndo} disabled={!canUndo} aria-label="Undo session edit">UNDO</button>
          <button type="button" className="h-7 px-2 text-[10px] font-orbitron border border-zinc-700 rounded" onClick={onRedo} disabled={!canRedo} aria-label="Redo session edit">REDO</button>
          <button
            type="button"
            className={`h-7 px-2 text-[10px] font-orbitron border rounded ${isCapturing ? 'bg-red-700 text-white border-red-400' : 'border-zinc-700 text-gray-300'}`}
            aria-pressed={isCapturing}
            aria-label={isCapturing ? 'Stop capturing launches into Song Mode' : 'Capture launches into Song Mode'}
            onClick={() => (isCapturing ? onFinishCapture() : onBeginCapture())}
          >
            {isCapturing ? 'CAPTURING' : 'CAPTURE'}
          </button>
          <button type="button" className="h-7 px-2 text-[10px] font-orbitron border border-zinc-700 rounded" onClick={onStopAll} aria-label="Stop all clips">STOP</button>
          <button type="button" className="h-7 w-7 text-gray-400" onClick={onClose} aria-label="Close Session Launcher">✕</button>
        </header>

        <div className="px-3 py-2 flex gap-2 overflow-x-auto border-b border-gray-800">
          {SESSION_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className="shrink-0 h-7 px-2 text-[10px] font-orbitron border border-cyan-900/60 text-cyan-300 rounded"
              onClick={() => onLoadPack(pack.id)}
              aria-label={`Load starter pack ${pack.name}`}
            >
              {pack.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto custom-scrollbar p-2" data-testid="session-grid">
          {rowCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-gray-800/20 border border-dashed border-gray-700 rounded-lg h-full min-h-[300px]">
              <div className="w-12 h-12 rounded-full bg-cyan-900/30 flex items-center justify-center mb-4 text-cyan-500" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </div>
              <h3 className="text-gray-300 font-bold mb-2 text-sm">No clips in session</h3>
              <p className="text-gray-500 text-xs mb-6 max-w-[250px]">
                Your session is empty. Load a starter pack from the bar above or record your own clips.
              </p>
            </div>
          ) : (
          <div
            role="grid"
            aria-label="Clip launcher"
            className="min-w-[640px]"
          >
            <div role="row" className="flex text-[9px] uppercase tracking-wider text-gray-500 mb-1">
              <div role="columnheader" className="w-16 shrink-0 px-1">Scene</div>
              {TRACK_KEYS.map((track) => (
                <div key={track} role="columnheader" className="flex-1 min-w-[72px] px-1 text-center">
                  {SESSION_TRACK_LABELS[track]}
                </div>
              ))}
            </div>
            {Array.from({ length: rowCount }, (_, row) => (
              <div key={row} role="row" className="flex gap-1 mb-1">
                <button
                  type="button"
                  role="gridcell"
                  data-testid={`session-scene-${row}`}
                  tabIndex={focus.kind === 'scene' && focus.row === row ? 0 : -1}
                  aria-label={`Launch ${document.scenes[row]?.name ?? `scene ${row + 1}`}`}
                  className={`w-16 shrink-0 h-10 text-[10px] font-bold rounded border ${
                    focus.kind === 'scene' && focus.row === row
                      ? 'border-cyan-400 bg-cyan-950 text-cyan-200'
                      : 'border-zinc-800 bg-zinc-900 text-gray-300'
                  }`}
                  onFocus={() => setFocus({ kind: 'scene', row })}
                  onClick={() => onLaunchScene(row)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    startMidiLearnForControl('session', `scene:${row}`);
                    midiMapStore.touchControl(sessionSceneControlId(row));
                  }}
                >
                  {document.scenes[row]?.name ?? row + 1}
                </button>
                {TRACK_KEYS.map((track) => {
                  const clip = document.columns[track].clips[row];
                  const playing = playingSlots[track] === clip?.slotIndex && clip && !clip.empty;
                  const focused = focus.kind === 'clip' && focus.track === track && focus.row === row;
                  return (
                    <button
                      key={track}
                      type="button"
                      role="gridcell"
                      data-testid={`session-clip-${track}-${row}`}
                      tabIndex={focused ? 0 : -1}
                      disabled={!clip || clip.empty}
                      aria-label={`${SESSION_TRACK_LABELS[track]} clip ${clip?.name ?? row + 1}${playing ? ', playing' : clip?.empty ? ', empty' : ''}`}
                      aria-pressed={!!playing}
                      className={`flex-1 min-w-[72px] h-10 text-[10px] rounded border truncate px-1 ${
                        playing
                          ? 'bg-cyan-600 text-black border-cyan-300'
                          : clip?.empty
                            ? 'bg-transparent border-zinc-800 text-zinc-600'
                            : focused
                              ? 'bg-zinc-800 border-cyan-400 text-white'
                              : 'bg-zinc-900 border-zinc-700 text-gray-200'
                      }`}
                      onFocus={() => setFocus({ kind: 'clip', track, row })}
                      onClick={() => onLaunchClip(track, row)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        startMidiLearnForControl('session', `clip:${track}:${row}`);
                        midiMapStore.touchControl(sessionClipControlId(track, row));
                      }}
                    >
                      {clip?.empty ? '·' : clip?.name}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          )}
        </div>

        <p className="sr-only">
          Arrow keys move focus. Enter or Space launches the focused clip or scene.
          Delete stops the focused track. Gamepad D-pad navigates; Attack launches the clip;
          Jump launches the scene. Right-click a cell to MIDI-learn.
        </p>
      </div>
    </div>
  );
});
