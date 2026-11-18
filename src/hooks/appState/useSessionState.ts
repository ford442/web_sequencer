import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { TrackKey } from '../../constants/appDefaults';
import { SessionLaunchEngine } from '../../session/SessionLaunchEngine';
import { sessionDocumentStore } from '../../stores/songRecordStore';
import { useValueStore } from '../../stores/valueStore';
import { captureEventsToArrangement } from '../../session/capture';
import { parseSessionMidiParam } from '../../session/midiMap';
import type { LaunchQuantization, SessionDocument, TransportClockSnapshot } from '../../session/types';
import type { Arrangement } from '../../types/song';
import type { SynthParams } from '../../types';
import { getSessionPack, mergePackStorage } from '../../session/packs';
import type { TrackStorageMap } from '../../utils/trackStorageUtils';
import { transportMixStore } from '../../stores/transportMixStore';
import { transportGrid } from '../../utils/songMeter';
import { swingPercentToClock } from '../../utils/musicTheory';

/** Clock snapshot for launch requests made between steps (UI, MIDI, gamepad). */
function clockSnapshot(clock: { step: number; audioTime: number; tempo: number }): TransportClockSnapshot {
  const meter = transportMixStore.meterRef.current;
  return {
    step: clock.step,
    audioTime: clock.audioTime || 0,
    tempo: clock.tempo,
    ...transportGrid(meter),
    swing: swingPercentToClock(meter.swing),
    isPlaying: true,
    songModeActive: false,
  };
}

/**
 * The clip launcher. Its document is `sessionDocumentStore` (bound to the
 * project doc, so session edits are undone with Ctrl/Cmd+Z like any other);
 * the launch engine, playing slots and capture are this tab's own.
 */
export function useSessionState() {
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const sessionDocument = useValueStore(sessionDocumentStore);
  const [playingSlots, setPlayingSlots] = useState<Record<TrackKey, number | null>>(() => {
    const empty = {} as Record<TrackKey, number | null>;
    empty.partA = null;
    empty.partB = null;
    empty.bass2 = null;
    empty.kick = null;
    empty.snare = null;
    empty.closedHat = null;
    empty.openHat = null;
    empty.sampler = null;
    return empty;
  });
  const [isCapturing, setIsCapturing] = useState(false);
  const engineRef = useRef<SessionLaunchEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new SessionLaunchEngine(sessionDocument);
  }
  const clockRef = useRef({ step: 0, audioTime: 0, tempo: 120 });
  const sessionDocumentRef = sessionDocumentStore.ref as MutableRefObject<SessionDocument>;

  // The engine follows the document whoever changed it (this tab, a peer, an undo).
  useEffect(() => sessionDocumentStore.subscribe(() => {
    engineRef.current?.setDocument(sessionDocumentStore.getSnapshot());
  }), []);

  const replaceSession = useCallback((next: SessionDocument) => {
    sessionDocumentStore.set(next);
  }, []);

  const launchClip = useCallback((track: TrackKey, row: number, source: 'manual' | 'midi' | 'gamepad' = 'manual', gateDown = true) => {
    const engine = engineRef.current;
    if (!engine) return;
    const clip = engine.document.columns[track]?.clips[row];
    if (!clip || clip.empty) return;
    engine.enqueue({
      kind: 'clip',
      source,
      requestAudioTime: clockRef.current.audioTime,
      requestStep: clockRef.current.step,
      track,
      clipId: clip.id,
      gateDown,
    }, clockSnapshot(clockRef.current));
  }, []);

  const launchScene = useCallback((sceneIndex: number, source: 'manual' | 'midi' | 'gamepad' | 'scene' = 'scene') => {
    const engine = engineRef.current;
    if (!engine) return;
    const scene = engine.document.scenes[sceneIndex];
    if (!scene) return;
    engine.enqueue({
      kind: 'scene',
      source,
      requestAudioTime: clockRef.current.audioTime,
      requestStep: clockRef.current.step,
      sceneId: scene.id,
    }, clockSnapshot(clockRef.current));
  }, []);

  const stopTrack = useCallback((track: TrackKey, source: 'manual' | 'midi' | 'gamepad' = 'manual') => {
    engineRef.current?.enqueue({
      kind: 'stop-track',
      source,
      requestAudioTime: clockRef.current.audioTime,
      requestStep: clockRef.current.step,
      track,
    }, clockSnapshot(clockRef.current));
  }, []);

  const stopAll = useCallback(() => {
    engineRef.current?.enqueue({
      kind: 'stop-all',
      source: 'manual',
      requestAudioTime: clockRef.current.audioTime,
      requestStep: clockRef.current.step,
    }, clockSnapshot(clockRef.current));
  }, []);

  const setQuantization = useCallback((q: LaunchQuantization) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setQuantization(q);
    sessionDocumentStore.set({ ...engine.document });
  }, []);

  const handleSessionMidi = useCallback((param: string, normalized: number) => {
    const action = parseSessionMidiParam(param, normalized);
    if (!action) return;
    if (action.type === 'clip') launchClip(action.track, action.row, 'midi', action.down);
    else if (action.type === 'scene' && action.down) launchScene(action.sceneIndex, 'midi');
    else if (action.type === 'stop-track') stopTrack(action.track, 'midi');
    else if (action.type === 'stop-all') stopAll();
  }, [launchClip, launchScene, stopTrack, stopAll]);

  const beginCapture = useCallback(() => {
    engineRef.current?.armCapture();
    setIsCapturing(true);
  }, []);

  const finishCapture = useCallback((): Arrangement => {
    const engine = engineRef.current;
    // Read before disarming: clips still playing run to the release point.
    const endStep = engine?.timelineStep;
    const events = engine?.disarmCapture() ?? [];
    setIsCapturing(false);
    return captureEventsToArrangement(events, {
      stepsPerMeasure: transportMixStore.meterRef.current.stepCount,
      endStep,
    });
  }, []);

  const loadPack = useCallback((
    packId: string,
    setTrackStorage: (s: TrackStorageMap | ((p: TrackStorageMap) => TrackStorageMap)) => void,
    instruments?: { synthA?: (u: Partial<SynthParams>) => void; synthB?: (u: Partial<SynthParams>) => void },
  ) => {
    const pack = getSessionPack(packId);
    if (!pack) return;
    sessionDocumentStore.set(pack.session);
    setTrackStorage((prev) => mergePackStorage(prev, pack.trackStorage));
    // The patches the pack's clips were written for (e.g. Macro Palette's models).
    if (pack.instruments?.synthA) instruments?.synthA?.(pack.instruments.synthA);
    if (pack.instruments?.synthB) instruments?.synthB?.(pack.instruments.synthB);
  }, []);

  return {
    isSessionOpen,
    setIsSessionOpen,
    sessionDocument,
    setSessionDocument: replaceSession,
    playingSlots,
    setPlayingSlots,
    isCapturing,
    sessionEngineRef: engineRef,
    sessionClockRef: clockRef,
    sessionDocumentRef,
    launchClip,
    launchScene,
    stopTrack,
    stopAll,
    setQuantization,
    handleSessionMidi,
    beginCapture,
    finishCapture,
    loadPack,
  };
}
