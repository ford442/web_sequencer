import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { TRACK_KEYS, NUM_STEPS } from '../../constants';
import { createEmptyTrackStorage } from '../../utils/trackStorageUtils';
import { SessionLaunchEngine } from '../SessionLaunchEngine';
import { createDefaultSessionDocument } from '../defaults';
import { migrateSavedSongSession, sessionFromTrackStorage } from '../migrate';
import { quantizeLaunch, secondsPerStep } from '../quantize';
import { resolveTrackConflicts } from '../conflict';
import { captureEventsToSongStructure } from '../capture';
import { resolveFollowClip } from '../followActions';
import { moveSessionFocus } from '../gridKeyboard';
import { parseSessionMidiParam, sessionClipControlId } from '../midiMap';
import type { CompiledLaunchEvent, TransportClockSnapshot } from '../types';

function clock(partial?: Partial<TransportClockSnapshot>): TransportClockSnapshot {
  return {
    step: 0,
    audioTime: 1.0,
    tempo: 120,
    patternSteps: NUM_STEPS,
    stepsPerBeat: 4,
    stepsPerBar: 16,
    isPlaying: true,
    songModeActive: false,
    ...partial,
  };
}

function fillClip(engine: SessionLaunchEngine, track: 'kick' = 'kick', row = 0) {
  engine.document.columns[track].clips[row].empty = false;
}

describe('quantizeLaunch', () => {
  it('fires on the current bar when the request arrives on a bar boundary', () => {
    const c = clock({ step: 0, audioTime: 2 });
    const q = quantizeLaunch('bar', c, 0, 2, 0);
    expect(q.deltaSteps).toBe(0);
    expect(q.audioTime).toBe(2);
  });

  it('waits until the next bar when not on the grid', () => {
    const c = clock({ step: 4, audioTime: 2 });
    const q = quantizeLaunch('bar', c, 4, 2, 4);
    expect(q.deltaSteps).toBe(12);
    expect(q.step).toBe(16);
    expect(q.audioTime).toBeCloseTo(2 + 12 * secondsPerStep(120));
  });

  it('is deterministic for the same clock even if requestAudioTime jitters within the step', () => {
    const c = clock({ step: 8, audioTime: 5, tempo: 140 });
    const a = quantizeLaunch('beat', c, 8, 5.001, 8);
    const b = quantizeLaunch('beat', c, 8, 5.01, 8);
    expect(a.step).toBe(b.step);
    expect(a.timelineStep).toBe(b.timelineStep);
  });
});

describe('SessionLaunchEngine', () => {
  it('launches a clip at the quantized bar and leaves other tracks independent', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.snare.clips[0].empty = false;
    const engine = new SessionLaunchEngine(doc);
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: doc.columns.kick.clips[0].id },
      clock(),
    );
    const tick = engine.tick(clock());
    expect(tick.applied).toHaveLength(1);
    expect(tick.applied[0].track).toBe('kick');
    expect(engine.playingSlot('kick')).toBe(0);
    expect(engine.playingSlot('snare')).toBeNull();
  });

  it('partitions queued events: applies due, retains not-yet-due', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.kick.clips[1].empty = false;
    const engine = new SessionLaunchEngine(doc);
    const mk = (timelineStep: number, slot: number): CompiledLaunchEvent => ({
      audioTime: 1,
      step: 0,
      timelineStep,
      track: 'kick',
      action: 'start',
      clipId: doc.columns.kick.clips[slot].id,
      slotIndex: slot,
      source: 'manual',
      requestSeq: slot + 1,
    });
    engine.queued = [mk(2, 0), mk(10, 1)];
    engine.timelineStep = 5;
    (engine as unknown as { lastClockStep: number }).lastClockStep = 5;
    engine.tick(clock({ step: 5 }));
    expect(engine.queued).toHaveLength(1);
    expect(engine.queued[0].timelineStep).toBe(10);
    expect(engine.playingSlot('kick')).toBe(0);
  });

  it('applies a scene atomically on one boundary', () => {
    const doc = createDefaultSessionDocument();
    for (const t of TRACK_KEYS) {
      doc.columns[t].clips[0].empty = false;
      doc.scenes[0].clipIds[t] = doc.columns[t].clips[0].id;
    }
    const engine = new SessionLaunchEngine(doc);
    engine.enqueue(
      { kind: 'scene', source: 'scene', requestAudioTime: 1, requestStep: 0, sceneId: doc.scenes[0].id },
      clock(),
    );
    const tick = engine.tick(clock());
    expect(new Set(tick.applied.map((e) => e.step)).size).toBe(1);
    expect(tick.applied).toHaveLength(TRACK_KEYS.length);
    for (const t of TRACK_KEYS) {
      expect(engine.playingSlot(t)).toBe(0);
    }
  });

  it('lets a later manual clip override a scene on the same track', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.kick.clips[1].empty = false;
    doc.scenes[0].clipIds.kick = doc.columns.kick.clips[0].id;
    const engine = new SessionLaunchEngine(doc);
    const c = clock();
    engine.enqueue(
      { kind: 'scene', source: 'scene', requestSeq: 1, requestAudioTime: 1, requestStep: 0, sceneId: doc.scenes[0].id },
      c,
    );
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestSeq: 2, requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: doc.columns.kick.clips[1].id },
      c,
    );
    engine.tick(c);
    expect(engine.playingSlot('kick')).toBe(1);
  });

  it('toggles a playing clip off', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.kick.clips[0].launchMode = 'toggle';
    const engine = new SessionLaunchEngine(doc);
    const id = doc.columns.kick.clips[0].id;
    engine.enqueue({ kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: id }, clock());
    engine.tick(clock());
    expect(engine.playingSlot('kick')).toBe(0);
    engine.enqueue({ kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: id }, clock());
    engine.tick(clock({ step: 0, audioTime: 1 }));
    expect(engine.playingSlot('kick')).toBeNull();
  });

  it('releases a gate clip on gateDown=false', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.kick.clips[0].launchMode = 'gate';
    const engine = new SessionLaunchEngine(doc);
    const id = doc.columns.kick.clips[0].id;
    engine.enqueue({ kind: 'clip', source: 'midi', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: id, gateDown: true }, clock());
    engine.tick(clock());
    expect(engine.playingSlot('kick')).toBe(0);
    engine.enqueue({ kind: 'clip', source: 'midi', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: id, gateDown: false }, clock());
    engine.tick(clock());
    expect(engine.playingSlot('kick')).toBeNull();
  });

  it('one-shot stops after one loop', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.kick.clips[0].launchMode = 'one-shot';
    const engine = new SessionLaunchEngine(doc);
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: doc.columns.kick.clips[0].id },
      clock(),
    );
    engine.tick(clock({ step: 0, audioTime: 1 }));
    expect(engine.playingSlot('kick')).toBe(0);
    // Advance a full pattern (32 steps) so follow boundary fires.
    let audio = 1;
    let step = 0;
    for (let i = 0; i < NUM_STEPS; i++) {
      step = (step + 1) % NUM_STEPS;
      audio += secondsPerStep(120);
      engine.tick(clock({ step, audioTime: audio }));
    }
    expect(engine.playingSlot('kick')).toBeNull();
  });

  it('preempts song mode on a live scene launch', () => {
    const doc = createDefaultSessionDocument();
    fillClip(new SessionLaunchEngine(doc));
    doc.columns.kick.clips[0].empty = false;
    const engine = new SessionLaunchEngine(doc);
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: doc.columns.kick.clips[0].id },
      clock({ songModeActive: true }),
    );
    const tick = engine.tick(clock({ songModeActive: true }));
    expect(tick.preemptSongMode).toBe(true);
    expect(engine.playingSlot('kick')).toBe(0);
  });

  it('stops session clips when song mode latches', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    const engine = new SessionLaunchEngine(doc);
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: doc.columns.kick.clips[0].id },
      clock(),
    );
    engine.tick(clock());
    expect(engine.playingSlot('kick')).toBe(0);
    const tick = engine.tick(clock({ step: 1, audioTime: 1.125, songModeActive: true }));
    expect(tick.preemptSession).toBe(true);
    expect(engine.playingSlot('kick')).toBeNull();
  });

  it('captures launches and compiles equivalent song-structure order', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.snare.clips[1].empty = false;
    const engine = new SessionLaunchEngine(doc);
    engine.armCapture();
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'kick', clipId: doc.columns.kick.clips[0].id },
      clock(),
    );
    engine.tick(clock());
    engine.enqueue(
      { kind: 'clip', source: 'manual', requestAudioTime: 1, requestStep: 0, track: 'snare', clipId: doc.columns.snare.clips[1].id },
      clock({ step: 16, audioTime: 1 + 16 * secondsPerStep(120) }),
    );
    // Need timeline to advance to bar 2 — simulate 16 steps first
    let audio = 1;
    for (let s = 1; s <= 16; s++) {
      audio += secondsPerStep(120);
      engine.tick(clock({ step: s % NUM_STEPS, audioTime: audio }));
    }
    const captured = engine.disarmCapture();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const structure = captureEventsToSongStructure(captured);
    expect(structure[0].kick).toBe(0);
  });

  it('stress: rapid scene changes never leave two clips playing on one track', () => {
    const doc = createDefaultSessionDocument();
    for (const t of TRACK_KEYS) {
      doc.columns[t].clips[0].empty = false;
      doc.columns[t].clips[1].empty = false;
      doc.scenes[0].clipIds[t] = doc.columns[t].clips[0].id;
      doc.scenes[1].clipIds[t] = doc.columns[t].clips[1].id;
    }
    const engine = new SessionLaunchEngine(doc);
    const c = clock();
    for (let i = 0; i < 64; i++) {
      engine.enqueue(
        { kind: 'scene', source: 'scene', requestAudioTime: 1, requestStep: 0, sceneId: doc.scenes[i % 2].id },
        c,
      );
    }
    engine.tick(c);
    for (const t of TRACK_KEYS) {
      const slot = engine.playingSlot(t);
      expect(slot === 0 || slot === 1).toBe(true);
    }
  });
});

describe('migrateSavedSongSession', () => {
  it('builds a default session from v2 songs without a session field', () => {
    const storage = createEmptyTrackStorage();
    storage.kick[0] = { steps: Array(NUM_STEPS).fill({ note: 'C2', velocity: 1 }) };
    const doc = migrateSavedSongSession(2, undefined, storage);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.columns.kick.clips[0].empty).toBe(false);
    expect(doc.columns.snare.clips[0].empty).toBe(true);
  });

  it('preserves clip ids when round-tripping JSON', () => {
    const original = sessionFromTrackStorage(createEmptyTrackStorage());
    original.columns.partA.clips[0].name = 'Lead A';
    original.columns.partA.clips[0].empty = false;
    const parsed = migrateSavedSongSession(3, JSON.parse(JSON.stringify(original)));
    expect(parsed.columns.partA.clips[0].id).toBe(original.columns.partA.clips[0].id);
    expect(parsed.columns.partA.clips[0].name).toBe('Lead A');
  });
});

describe('followActions', () => {
  it('picks next non-empty clip', () => {
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[0].empty = false;
    doc.columns.kick.clips[2].empty = false;
    const next = resolveFollowClip(doc, 'kick', { ...doc.columns.kick.clips[0], followAction: 'next' });
    expect(next === 'stop' ? null : next?.id).toBe(doc.columns.kick.clips[2].id);
  });
});

describe('gridKeyboard', () => {
  it('moves from scene column into the first track', () => {
    const next = moveSessionFocus({ kind: 'scene', row: 2 }, 'ArrowRight', 8);
    expect(next).toEqual({ kind: 'clip', track: 'partA', row: 2 });
  });
});

describe('session midi ids', () => {
  it('parses clip / scene / stop controls', () => {
    expect(parseSessionMidiParam('clip:kick:3', 1)).toEqual({ type: 'clip', track: 'kick', row: 3, down: true });
    expect(parseSessionMidiParam('scene:1', 0)).toEqual({ type: 'scene', sceneIndex: 1, down: false });
    expect(parseSessionMidiParam('stop:partA', 1)).toEqual({ type: 'stop-track', track: 'partA' });
    expect(sessionClipControlId('kick', 0)).toBe('session:clip:kick:0');
  });
});

describe('quantizeLaunch properties', () => {
  it('never schedules in the past relative to the origin audioTime', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 31 }),
        fc.integer({ min: 60, max: 180 }),
        fc.constantFrom('step', 'beat', 'bar', '2bars', '4bars') as fc.Arbitrary<
          'step' | 'beat' | 'bar' | '2bars' | '4bars'
        >,
        (step, tempo, quant) => {
          const c = clock({ step, tempo, audioTime: 10 });
          const q = quantizeLaunch(quant, c, step, 10, step);
          expect(q.audioTime).toBeGreaterThanOrEqual(10 - 1e-9);
          expect(q.deltaSteps).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('resolveTrackConflicts', () => {
  it('keeps a single winner per track', () => {
    const mk = (seq: number, source: CompiledLaunchEvent['source'], slot: number): CompiledLaunchEvent => ({
      audioTime: 1,
      step: 0,
      timelineStep: 0,
      track: 'kick',
      action: 'start',
      clipId: `c:kick:${slot}`,
      slotIndex: slot,
      source,
      requestSeq: seq,
    });
    const winner = resolveTrackConflicts([mk(1, 'scene', 0), mk(2, 'manual', 1)]);
    expect(winner).toHaveLength(1);
    expect(winner[0].slotIndex).toBe(1);
  });
});
