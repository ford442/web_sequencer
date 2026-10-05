import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrackKey } from '../../constants/appDefaults';
import { useUndoRedo } from '../useUndoRedo';
import { SessionLaunchEngine } from '../../session/SessionLaunchEngine';
import { createDefaultSessionDocument } from '../../session/defaults';
import { captureEventsToSongStructure } from '../../session/capture';
import { parseSessionMidiParam } from '../../session/midiMap';
import type { LaunchQuantization, SessionDocument, TransportClockSnapshot } from '../../session/types';
import type { SongStructure } from '../../types/songMode';
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

export function useSessionState() {
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [sessionDocument, setSessionDocument] = useState<SessionDocument>(() => createDefaultSessionDocument());
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
  const undo = useUndoRedo<SessionDocument>(40);
  const sessionDocumentRef = useRef(sessionDocument);
  useEffect(() => {
    sessionDocumentRef.current = sessionDocument;
  }, [sessionDocument]);

  useEffect(() => {
    engineRef.current?.setDocument(sessionDocument);
  }, [sessionDocument]);

  const replaceSession = useCallback((next: SessionDocument, recordUndo = true) => {
    if (recordUndo) undo.push(sessionDocument);
    setSessionDocument(next);
    engineRef.current?.setDocument(next);
  }, [sessionDocument, undo]);

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
    undo.push(sessionDocument);
    engine.setQuantization(q);
    setSessionDocument({ ...engine.document });
  }, [sessionDocument, undo]);

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

  const finishCapture = useCallback((): SongStructure => {
    const events = engineRef.current?.disarmCapture() ?? [];
    setIsCapturing(false);
    return captureEventsToSongStructure(events, {
      stepsPerMeasure: transportMixStore.meterRef.current.stepCount,
    });
  }, []);

  const undoSession = useCallback(() => {
    const prev = undo.undo();
    if (prev) {
      setSessionDocument(prev);
      engineRef.current?.setDocument(prev);
    }
  }, [undo]);

  const redoSession = useCallback(() => {
    const next = undo.redo();
    if (next) {
      setSessionDocument(next);
      engineRef.current?.setDocument(next);
    }
  }, [undo]);

  const loadPack = useCallback((packId: string, setTrackStorage: (s: TrackStorageMap | ((p: TrackStorageMap) => TrackStorageMap)) => void) => {
    const pack = getSessionPack(packId);
    if (!pack) return;
    undo.push(sessionDocument);
    setSessionDocument(pack.session);
    engineRef.current?.setDocument(pack.session);
    setTrackStorage((prev) => mergePackStorage(prev, pack.trackStorage));
  }, [sessionDocument, undo]);

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
    undoSession,
    redoSession,
    canUndoSession: undo.canUndo,
    canRedoSession: undo.canRedo,
    loadPack,
  };
}
