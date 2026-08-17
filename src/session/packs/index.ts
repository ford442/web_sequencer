import { TRACK_KEYS, NUM_STEPS } from '@/constants';
import type { TrackKey } from '@/constants/appDefaults';
import type { Note, PartSequence } from '@/types';
import type { TrackStorageMap } from '@/utils/trackStorageUtils';
import { createEmptyTrackStorage } from '@/utils/trackStorageUtils';
import { randomizeDrumTrack, randomizeMelodicTrack, seededRng } from '@/utils/patternRandomizer';
import { createDefaultSessionDocument } from '../defaults';
import type { SessionDocument } from '../types';

export interface SessionPack {
  id: string;
  name: string;
  description: string;
  session: SessionDocument;
  trackStorage: TrackStorageMap;
}

function note(n: string, velocity = 0.9, extra?: Partial<Note>): Note {
  return { note: n, velocity, ...extra };
}

function seqFromNotes(steps: (Note | null)[]): PartSequence {
  const padded = [...steps];
  while (padded.length < NUM_STEPS) padded.push(null);
  return { steps: padded.slice(0, NUM_STEPS) };
}

function emptySampler(): PartSequence[] {
  return Array.from({ length: 8 }, () => ({ steps: Array(NUM_STEPS).fill(null) as (Note | null)[] }));
}

function putSlot(storage: TrackStorageMap, track: TrackKey, slot: number, seq: PartSequence | PartSequence[]): void {
  storage[track][slot] = seq;
}

function nameClips(session: SessionDocument, track: TrackKey, names: string[]): void {
  names.forEach((name, i) => {
    const clip = session.columns[track].clips[i];
    if (!clip) return;
    clip.name = name;
    clip.empty = false;
  });
}

function wireScenes(session: SessionDocument, filledRows: number): void {
  session.scenes = session.scenes.map((scene, i) => {
    const clipIds = { ...scene.clipIds };
    for (const track of TRACK_KEYS) {
      const clip = session.columns[track].clips[i];
      clipIds[track] = i < filledRows && clip && !clip.empty ? clip.id : null;
    }
    return { ...scene, clipIds, name: scene.name };
  });
}

/** Acid Live Set — 303 lines + 909-ish drums. */
export function createAcidLiveSetPack(): SessionPack {
  const rng = seededRng(303);
  const storage = createEmptyTrackStorage();
  const session = createDefaultSessionDocument();

  putSlot(storage, 'partB', 0, randomizeMelodicTrack(NUM_STEPS, { root: 'A', scale: 'Minor', density: 0.45, rng }));
  putSlot(storage, 'partB', 1, randomizeMelodicTrack(NUM_STEPS, { root: 'A', scale: 'Minor', density: 0.7, rng }));
  putSlot(storage, 'bass2', 0, randomizeMelodicTrack(NUM_STEPS, { root: 'A', scale: 'Minor', density: 0.5, rng }));
  putSlot(storage, 'bass2', 1, randomizeMelodicTrack(NUM_STEPS, { root: 'E', scale: 'Minor', density: 0.55, rng }));
  putSlot(storage, 'kick', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.25, euclidean: true, rng }));
  putSlot(storage, 'kick', 1, seqFromNotes([note('C2'), null, null, null, note('C2'), null, null, null, note('C2'), null, null, null, note('C2'), null, null, null]));
  putSlot(storage, 'snare', 0, seqFromNotes([null, null, null, null, note('D3'), null, null, null, null, null, null, null, note('D3'), null, null, null]));
  putSlot(storage, 'closedHat', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.5, euclidean: true, rng }));
  putSlot(storage, 'openHat', 0, seqFromNotes([null, null, null, note('F#3'), null, null, null, note('F#3')]));

  nameClips(session, 'partB', ['Acid A', 'Acid B']);
  nameClips(session, 'bass2', ['303 A', '303 B']);
  nameClips(session, 'kick', ['Four', 'Boom']);
  nameClips(session, 'snare', ['Back']);
  nameClips(session, 'closedHat', ['Hats']);
  nameClips(session, 'openHat', ['Open']);
  session.scenes[0].name = 'Intro';
  session.scenes[1].name = 'Drop';
  wireScenes(session, 2);
  return {
    id: 'acid-live-set',
    name: 'Acid Live Set',
    description: 'Dual 303 lines with four-on-the-floor drums for a live acid set.',
    session,
    trackStorage: storage,
  };
}

/** Vocal Chop Performance — sampler-forward scenes. */
export function createVocalChopPack(): SessionPack {
  const rng = seededRng(808);
  const storage = createEmptyTrackStorage();
  const session = createDefaultSessionDocument();
  const chopA: PartSequence[] = emptySampler();
  chopA[0] = seqFromNotes([note('C4'), null, note('C4'), null, note('D4'), null, note('C4'), null]);
  const chopB: PartSequence[] = emptySampler();
  chopB[0] = seqFromNotes([note('E4', 1, { reverse: true }), null, null, note('G4'), null, note('E4')]);
  putSlot(storage, 'sampler', 0, chopA);
  putSlot(storage, 'sampler', 1, chopB);
  putSlot(storage, 'kick', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.2, euclidean: true, rng }));
  putSlot(storage, 'snare', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.12, rng }));
  putSlot(storage, 'partA', 0, randomizeMelodicTrack(NUM_STEPS, { root: 'C', scale: 'Major', density: 0.2, rng }));

  nameClips(session, 'sampler', ['Chop A', 'Chop B']);
  nameClips(session, 'kick', ['Pulse']);
  nameClips(session, 'snare', ['Snap']);
  nameClips(session, 'partA', ['Pad']);
  session.scenes[0].name = 'Vox In';
  session.scenes[1].name = 'Chop Flip';
  wireScenes(session, 2);
  return {
    id: 'vocal-chop-performance',
    name: 'Vocal Chop Performance',
    description: 'Sampler banks as launchable vocal chops over a light rhythm bed.',
    session,
    trackStorage: storage,
  };
}

/** Dual-303 Jam — lead + bass 303 with complementary scenes. */
export function createDual303JamPack(): SessionPack {
  const rng = seededRng(303303);
  const storage = createEmptyTrackStorage();
  const session = createDefaultSessionDocument();
  putSlot(storage, 'partA', 0, randomizeMelodicTrack(NUM_STEPS, { root: 'G', scale: 'Minor', density: 0.35, rng }));
  putSlot(storage, 'partA', 1, randomizeMelodicTrack(NUM_STEPS, { root: 'G', scale: 'Minor', density: 0.6, rng }));
  putSlot(storage, 'partB', 0, randomizeMelodicTrack(NUM_STEPS, { root: 'G', scale: 'Minor', density: 0.4, rng }));
  putSlot(storage, 'bass2', 0, randomizeMelodicTrack(NUM_STEPS, { root: 'G', scale: 'Minor', density: 0.5, rng }));
  putSlot(storage, 'kick', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.25, euclidean: true, rng }));
  putSlot(storage, 'closedHat', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.45, rng }));

  nameClips(session, 'partA', ['Lead A', 'Lead B']);
  nameClips(session, 'partB', ['Bass 303']);
  nameClips(session, 'bass2', ['Bass 2']);
  nameClips(session, 'kick', ['Kick']);
  nameClips(session, 'closedHat', ['Hats']);
  session.scenes[0].name = 'Jam A';
  session.scenes[1].name = 'Jam B';
  wireScenes(session, 2);
  return {
    id: 'dual-303-jam',
    name: 'Dual-303 Jam',
    description: 'Lead and bass 303 clips for call-and-response scene launches.',
    session,
    trackStorage: storage,
  };
}

/** Minimal Drum Lab — kick/snare/hat variations. */
export function createMinimalDrumLabPack(): SessionPack {
  const rng = seededRng(909);
  const storage = createEmptyTrackStorage();
  const session = createDefaultSessionDocument();
  putSlot(storage, 'kick', 0, seqFromNotes([note('C2'), null, null, null, note('C2'), null, null, null]));
  putSlot(storage, 'kick', 1, randomizeDrumTrack(NUM_STEPS, { density: 0.35, euclidean: true, rng }));
  putSlot(storage, 'snare', 0, seqFromNotes([null, null, null, null, note('D3'), null, null, null]));
  putSlot(storage, 'snare', 1, randomizeDrumTrack(NUM_STEPS, { density: 0.18, rng }));
  putSlot(storage, 'closedHat', 0, randomizeDrumTrack(NUM_STEPS, { density: 0.5, euclidean: true, rng }));
  putSlot(storage, 'closedHat', 1, randomizeDrumTrack(NUM_STEPS, { density: 0.75, rng }));
  putSlot(storage, 'openHat', 0, seqFromNotes([null, null, null, null, null, null, note('F#3'), null]));

  nameClips(session, 'kick', ['Four', 'Broken']);
  nameClips(session, 'snare', ['2+4', 'Ghost']);
  nameClips(session, 'closedHat', ['16ths', 'Busy']);
  nameClips(session, 'openHat', ['Off']);
  session.scenes[0].name = 'Lab A';
  session.scenes[1].name = 'Lab B';
  wireScenes(session, 2);
  return {
    id: 'minimal-drum-lab',
    name: 'Minimal Drum Lab',
    description: 'Kick, snare, and hat clip columns for drum-only scene practice.',
    session,
    trackStorage: storage,
  };
}

export const SESSION_PACKS: SessionPack[] = [
  createAcidLiveSetPack(),
  createVocalChopPack(),
  createDual303JamPack(),
  createMinimalDrumLabPack(),
];

export function getSessionPack(id: string): SessionPack | undefined {
  return SESSION_PACKS.find((p) => p.id === id);
}

/** Merge pack slots into existing storage without wiping empty user slots. */
export function mergePackStorage(base: TrackStorageMap, pack: TrackStorageMap): TrackStorageMap {
  const next = createEmptyTrackStorage();
  for (const track of TRACK_KEYS) {
    next[track] = base[track].slice();
    for (let i = 0; i < pack[track].length; i++) {
      if (pack[track][i] != null) next[track][i] = pack[track][i];
    }
  }
  return next;
}
