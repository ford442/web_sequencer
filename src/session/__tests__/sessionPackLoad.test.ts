import { describe, expect, it } from 'vitest';
import { TRACK_KEYS } from '../../constants';
import type { PartSequence } from '../../types';
import { createEmptyTrackStorage, type TrackStorageMap } from '../../utils/trackStorageUtils';
import { SESSION_PACKS, getSessionPack } from '../packs';
import { exportSessionPack } from '../pack/export';
import { importPackText } from '../pack/import';
import { findSlotCollisions, planPackLoad, resolvePackId } from '../pack/plan';
import { summarizePack } from '../pack/preview';
import { PACK_LIMITS, type SessionPack } from '../pack/format';
import { parseSessionPackText } from '../pack/validate';

const seq = (note: string, steps = 8): PartSequence => ({
  steps: Array.from({ length: steps }, (_, i) => (i === 0 ? { note, velocity: 0.9 } : null)),
});

/** Deep-freezes storage so any code that mutates what it is given throws. */
function frozen(storage: TrackStorageMap): TrackStorageMap {
  const deep = (v: unknown): unknown => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(deep);
      Object.freeze(v);
    }
    return v;
  };
  return deep(storage) as TrackStorageMap;
}

function packFromBuiltIn(id: string): SessionPack {
  const builtIn = getSessionPack(id)!;
  const out = exportSessionPack({ name: builtIn.name, session: builtIn.session, trackStorage: builtIn.trackStorage, synthA: builtIn.instruments?.synthA, synthB: builtIn.instruments?.synthB });
  if (!out.ok) throw new Error('export failed');
  const parsed = parseSessionPackText(out.text);
  if (!parsed.ok) throw new Error('import failed');
  return parsed.pack;
}

describe('resolvePackId', () => {
  it('keeps a free id and suffixes a taken one with the first free number', () => {
    expect(resolvePackId('my-pack', [])).toBe('my-pack');
    expect(resolvePackId('my-pack', ['my-pack'])).toBe('my-pack-2');
    expect(resolvePackId('my-pack', ['my-pack', 'my-pack-2', 'my-pack-3'])).toBe('my-pack-4');
    expect(resolvePackId('my-pack', new Set(['my-pack', 'my-pack-3']))).toBe('my-pack-2');
  });

  it('never takes a starter’s id and stays within the id limit', () => {
    const taken = SESSION_PACKS.map((p) => p.id);
    expect(resolvePackId('acid-live-set', taken)).toBe('acid-live-set-2');
    const long = 'a'.repeat(PACK_LIMITS.maxIdLength);
    const next = resolvePackId(long, [long]);
    expect(next.length).toBeLessThanOrEqual(PACK_LIMITS.maxIdLength);
    expect(next).toMatch(/-2$/);
    expect(next).not.toBe(long);
  });
});

describe('importPackText', () => {
  const text = (name = 'Imported Beat') => {
    const base = getSessionPack('minimal-drum-lab')!;
    const out = exportSessionPack({ name, session: base.session, trackStorage: base.trackStorage });
    if (!out.ok) throw new Error('export failed');
    return out.text;
  };

  it('previews a valid pack without touching the live storage', () => {
    const current = frozen(createEmptyTrackStorage());
    const outcome = importPackText(text(), { takenIds: SESSION_PACKS.map((p) => p.id), currentStorage: current });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.pack.id).toBe('imported-beat');
    expect(outcome.preview.renamedFrom).toBeUndefined();
    expect(outcome.preview.collisions).toEqual([]);
  });

  it('gives a pack that collides with a starter or an earlier import a stable new id', () => {
    const taken = [...SESSION_PACKS.map((p) => p.id), 'imported-beat'];
    const first = importPackText(text('Acid Live Set'), { takenIds: taken, currentStorage: createEmptyTrackStorage() });
    const second = importPackText(text('Imported Beat'), { takenIds: taken, currentStorage: createEmptyTrackStorage() });
    expect(first.ok && first.preview.pack.id).toBe('acid-live-set-2');
    expect(first.ok && first.preview.renamedFrom).toBe('acid-live-set');
    expect(second.ok && second.preview.pack.id).toBe('imported-beat-2');
    // Same input, same answer.
    const again = importPackText(text('Imported Beat'), { takenIds: taken, currentStorage: createEmptyTrackStorage() });
    expect(again.ok && again.preview.pack.id).toBe('imported-beat-2');
  });

  it('keeps the id when the caller says it is the same pack as the earlier import', () => {
    const outcome = importPackText(text(), { takenIds: ['imported-beat'], currentStorage: createEmptyTrackStorage() }, (p) => p.id === 'imported-beat');
    expect(outcome.ok && outcome.preview.pack.id).toBe('imported-beat');
    expect(outcome.ok && outcome.preview.renamedFrom).toBeUndefined();
  });

  it('fails with issues and builds nothing for an invalid file', () => {
    const outcome = importPackText('{"format":"hyphon-session-pack","formatVersion":9}', { takenIds: [], currentStorage: createEmptyTrackStorage() });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0].code).toBe('unsupported-version');
  });
});

describe('planPackLoad', () => {
  const pack = () => packFromBuiltIn('minimal-drum-lab');

  it('into an empty song puts every pack slot where the pack says, under either policy', () => {
    const empty = frozen(createEmptyTrackStorage());
    for (const policy of ['overwrite', 'relocate'] as const) {
      const result = planPackLoad(pack(), empty, policy);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.plan.trackStorage).toEqual(pack().trackStorage);
      expect(result.plan.overwritten).toEqual([]);
      expect(result.plan.relocated).toEqual([]);
      expect(result.plan.session).toEqual(pack().session);
    }
  });

  it('reports collisions with different, occupied patterns and ignores identical or empty ones', () => {
    const current = createEmptyTrackStorage();
    current.kick[0] = seq('C5'); // different, occupied → collision
    current.kick[1] = pack().trackStorage.kick[1]; // identical → not a collision
    current.snare[0] = { steps: Array<null>(8).fill(null) }; // present but empty → not a collision
    expect(findSlotCollisions(pack(), current)).toEqual([{ track: 'kick', slot: 0 }]);
  });

  it('overwrite replaces the occupied slot and lists it; other slots of the user survive', () => {
    const current = createEmptyTrackStorage();
    current.kick[0] = seq('C5');
    current.kick[9] = seq('D5');
    const result = planPackLoad(pack(), frozen(current), 'overwrite');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.trackStorage.kick[0]).toEqual(pack().trackStorage.kick[0]);
    expect(result.plan.trackStorage.kick[9]).toEqual(seq('D5'));
    expect(result.plan.overwritten).toEqual([{ track: 'kick', slot: 0 }]);
  });

  it('relocate keeps the user’s pattern and moves the pack’s into the lowest free slot, repointing clips and scenes', () => {
    const imported = pack();
    const kickClip = imported.session.columns.kick.clips[0];
    const sceneIndex = imported.session.scenes.findIndex((s) => s.clipIds.kick === kickClip.id);
    expect(sceneIndex).toBeGreaterThanOrEqual(0);

    const current = createEmptyTrackStorage();
    current.kick[0] = seq('C5'); // collides with the pack's kick slot 0
    current.kick[2] = seq('E5'); // not in the pack: stays, and is skipped when looking for a free slot
    const result = planPackLoad(imported, frozen(current), 'relocate');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan } = result;

    // The user's slots are untouched.
    expect(plan.trackStorage.kick[0]).toEqual(seq('C5'));
    expect(plan.trackStorage.kick[2]).toEqual(seq('E5'));
    // The pack's pattern landed in the lowest free slot: 1 is the pack's own kick slot, 2 is the user's, so 3.
    expect(plan.relocated).toEqual([{ track: 'kick', slot: 0, to: 3 }]);
    expect(plan.trackStorage.kick[3]).toEqual(imported.trackStorage.kick[0]);
    expect(plan.overwritten).toEqual([]);

    // The clip follows its pattern and the scene follows the clip.
    const moved = plan.session.columns.kick.clips[0];
    expect(moved.slotIndex).toBe(3);
    // `c:kick:3` is the pack's own (empty) clip on row 3, so the moved clip takes the next free id.
    expect(moved.id).toBe('c:kick:3:r1');
    expect(plan.session.scenes[sceneIndex].clipIds.kick).toBe('c:kick:3:r1');
    // Clips that did not move are exactly as in the pack, and the pack itself is not edited.
    expect(plan.session.columns.kick.clips[1]).toEqual(imported.session.columns.kick.clips[1]);
    expect(kickClip.slotIndex).toBe(0);
    expect(kickClip.id).toBe('c:kick:0');
  });

  it('relocated plans are valid packs again: ids unique, every scene clip exists', () => {
    const imported = pack();
    const current = createEmptyTrackStorage();
    for (const track of TRACK_KEYS) for (let i = 0; i < 2; i++) current[track][i] = seq('B5');
    const result = planPackLoad(imported, current, 'relocate');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = TRACK_KEYS.flatMap((t) => result.plan.session.columns[t].clips.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const scene of result.plan.session.scenes) {
      for (const track of TRACK_KEYS) {
        const id = scene.clipIds[track];
        if (id) expect(result.plan.session.columns[track].clips.some((c) => c.id === id)).toBe(true);
      }
    }
    // Every non-empty clip still has a pattern behind it.
    for (const track of TRACK_KEYS) {
      for (const clip of result.plan.session.columns[track].clips) {
        if (!clip.empty) expect(result.plan.trackStorage[track][clip.slotIndex]).not.toBeNull();
      }
    }
  });

  it('relocate fails clearly, and applies nothing, when a track has no free slot left', () => {
    const current = createEmptyTrackStorage();
    for (let i = 0; i < PACK_LIMITS.maxSlotsPerTrack; i++) current.kick[i] = seq('A5');
    const result = planPackLoad(pack(), frozen(current), 'relocate');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/KICK has no free pattern slot/);
    // …while overwrite still works on the same song.
    expect(planPackLoad(pack(), current, 'overwrite').ok).toBe(true);
  });

  it('is deterministic', () => {
    const current = createEmptyTrackStorage();
    current.kick[0] = seq('C5');
    expect(planPackLoad(pack(), current, 'relocate')).toEqual(planPackLoad(pack(), current, 'relocate'));
  });

  it('carries the pack’s instrument settings through unchanged', () => {
    const macro = packFromBuiltIn('macro-palette');
    const result = planPackLoad(macro, createEmptyTrackStorage(), 'overwrite');
    expect(result.ok && result.plan.instruments).toEqual(macro.instruments);
  });
});

describe('summarizePack', () => {
  it('lists scenes, clips per scene, tracks with note counts and instrument requirements', () => {
    const summary = summarizePack(packFromBuiltIn('macro-palette'));
    expect(summary.name).toBe('Macro Palette');
    expect(summary.rows).toBe(8);
    // Only scenes that launch something are listed; the pack's unused rows are counted.
    expect(summary.scenes).toEqual([
      { name: 'Chords', clips: 4 },
      { name: 'Plucks', clips: 1 },
    ]);
    expect(summary.emptyScenes).toBe(6);
    const partA = summary.tracks.find((t) => t.track === 'partA');
    expect(partA).toMatchObject({ label: 'SYNTH A', clips: 2, patterns: 2 });
    expect(partA!.notes).toBeGreaterThan(4);
    expect(summary.totalClips).toBe(summary.tracks.reduce((n, t) => n + t.clips, 0));
    expect(summary.instruments).toMatchObject([
      { part: 'SYNTH A', waveform: 'macro-additive', engine: 'Macro', requirement: expect.stringMatching(/native macro engine/) as string },
      { part: 'SYNTH B', waveform: 'macro-va', engine: 'Macro' },
    ]);
  });

  it('says what a pack cannot bring: audio for sampler clips, and that synth sounds are kept without settings', () => {
    const summary = summarizePack(packFromBuiltIn('vocal-chop-performance'));
    expect(summary.notices.join(' ')).toMatch(/Sampler clips trigger the sampler banks you have loaded/);
    expect(summary.notices.join(' ')).toMatch(/current SYNTH A \/ B sounds are kept/);
  });
});
