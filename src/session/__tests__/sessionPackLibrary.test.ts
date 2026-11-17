import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TRACK_KEYS } from '../../constants';
import { createEmptyTrackStorage } from '../../utils/trackStorageUtils';
import { SESSION_PACKS } from '../packs';
import { LIBRARY_PACKS } from '../packs/library';
import { exportSessionPack } from '../pack/export';
import { planPackLoad } from '../pack/plan';
import { summarizePack } from '../pack/preview';
import { parseSessionPackText, parseSessionPackValue } from '../pack/validate';
import type { SessionPack } from '../pack/format';

const LIBRARY_DIR = resolve(__dirname, '../packs/library');
const files = readdirSync(LIBRARY_DIR).filter((f) => f.endsWith('.hyphonpack.json')).sort();

function load(id: string): { text: string; pack: SessionPack } {
  const text = readFileSync(resolve(LIBRARY_DIR, `${id}.hyphonpack.json`), 'utf8');
  const parsed = parseSessionPackText(text);
  if (!parsed.ok) throw new Error(`${id}: ${parsed.errors.map((e) => e.message).join('; ')}`);
  expect(parsed.warnings, `${id} should validate without warnings`).toEqual([]);
  return { text, pack: parsed.pack };
}

describe('library starter packs', () => {
  it('lists exactly the files in packs/library, named by their id', () => {
    expect(LIBRARY_PACKS.map((p) => `${p.id}.hyphonpack.json`).sort()).toEqual(files);
  });

  it('has at least the three workflows: ambient/evolving, broken-beat, vocal/sampler', () => {
    expect(LIBRARY_PACKS.map((p) => p.id)).toEqual(
      expect.arrayContaining(['ambient-drift', 'broken-beat-workbench', 'vocal-sampler-booth']),
    );
  });

  it('never reuses a built-in starter id', () => {
    const builtIn = new Set(SESSION_PACKS.map((p) => p.id));
    for (const entry of LIBRARY_PACKS) expect(builtIn.has(entry.id)).toBe(false);
  });

  describe.each(LIBRARY_PACKS.map((p) => [p.id, p] as const))('%s', (id, entry) => {
    it('is a valid pack whose manifest entry matches the file', async () => {
      const { pack } = load(id);
      expect(pack.id).toBe(entry.id);
      expect(pack.name).toBe(entry.name);
      expect(pack.description).toBe(entry.description);
      // The lazily loaded module is the file: same data, and it validates through the value entry point.
      const loaded = await entry.load();
      expect(loaded).toEqual(JSON.parse(readFileSync(resolve(LIBRARY_DIR, `${id}.hyphonpack.json`), 'utf8')));
      expect(parseSessionPackValue(loaded).ok).toBe(true);
    });

    it('is plain data: no URLs, no remote assets, no code', () => {
      const { text } = load(id);
      expect(text).not.toMatch(/https?:|\/\/|data:|<script|javascript:/i);
      expect(text).not.toMatch(/sampleUrl|ambianceUrl|backgroundImage/);
    });

    it('re-exports to the same file (stable, deterministic)', () => {
      const { text, pack } = load(id);
      const again = exportSessionPack({
        name: pack.name,
        description: pack.description,
        author: pack.author,
        session: pack.session,
        trackStorage: pack.trackStorage,
        synthA: pack.instruments?.synthA,
        synthB: pack.instruments?.synthB,
      });
      expect(again.ok && again.text).toBe(text);
    });

    it('loads into an empty song with every clip backed by a pattern', () => {
      const { pack } = load(id);
      const result = planPackLoad(pack, createEmptyTrackStorage(), 'relocate');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const track of TRACK_KEYS) {
        for (const clip of result.plan.session.columns[track].clips) {
          if (!clip.empty) {
            const slot = result.plan.trackStorage[track][clip.slotIndex];
            expect(slot, `${track} ${clip.name}`).not.toBeNull();
          }
        }
      }
      expect(result.plan.relocated).toEqual([]);
    });

    it('has launchable scenes and original, credited content', () => {
      const { pack } = load(id);
      const summary = summarizePack(pack);
      expect(summary.scenes.filter((s) => s.clips > 0).length).toBeGreaterThanOrEqual(3);
      expect(summary.totalNotes).toBeGreaterThanOrEqual(20);
      expect(pack.author).toBe('Hyphon starter library');
    });
  });

  describe('each demonstrates a different workflow', () => {
    const clips = (pack: SessionPack) => TRACK_KEYS.flatMap((t) => pack.session.columns[t].clips.filter((c) => !c.empty));

    it('Ambient Drift: macro pads that evolve on their own through follow actions', () => {
      const { pack } = load('ambient-drift');
      expect(pack.session.quantization).toBe('2bars');
      expect(pack.instruments?.synthA?.waveform).toMatch(/^macro-/);
      expect(pack.instruments?.synthB?.waveform).toMatch(/^macro-/);
      const follows = new Set(clips(pack).map((c) => c.followAction));
      expect(follows).toEqual(new Set(['next', 'random', 'none']));
      // Pad chords hold across the pattern.
      const pad = pack.trackStorage.partA[0] as { steps: Array<{ chord?: string[]; length?: number } | null> };
      expect(pad.steps.filter(Boolean).every((s) => (s!.chord?.length ?? 0) >= 3 && (s!.length ?? 0) >= 8)).toBe(true);
    });

    it('Broken Beat Workbench: syncopated drum cells, groove timing, toggled layers and a one-shot fill', () => {
      const { pack } = load('broken-beat-workbench');
      const modes = new Set(clips(pack).map((c) => c.launchMode));
      expect(modes).toEqual(new Set(['trigger', 'toggle', 'one-shot']));
      const hats = pack.trackStorage.closedHat[0] as { steps: Array<{ microtiming?: number } | null> };
      expect(hats.steps.some((s) => (s?.microtiming ?? 0) !== 0)).toBe(true);
      // The kick cells are not four-on-the-floor.
      const kick = pack.trackStorage.kick[1] as { steps: unknown[] };
      expect(kick.steps.map((s, i) => (s ? i : -1)).filter((i) => i >= 0).slice(0, 5)).toEqual([0, 3, 6, 10, 13]);
    });

    it('Vocal Sampler Booth: sampler banks, call and reply, reverse/retrigger chops, a held gate clip', () => {
      const { pack } = load('vocal-sampler-booth');
      const samplerSlots = pack.trackStorage.sampler.filter((s): s is NonNullable<typeof s> => s != null);
      expect(samplerSlots.length).toBeGreaterThanOrEqual(5);
      // Call and reply: one slot uses two different banks.
      const usedBanks = (slot: unknown) => (slot as Array<{ steps: unknown[] }>).filter((b) => b.steps.some(Boolean)).length;
      expect(samplerSlots.some((s) => usedBanks(s) === 2)).toBe(true);
      const notes = samplerSlots.flatMap((s) => (s as Array<{ steps: Array<Record<string, unknown> | null> }>).flatMap((b) => b.steps.filter(Boolean)));
      expect(notes.some((n) => n!.reverse === true)).toBe(true);
      expect(notes.some((n) => typeof n!.retrigger === 'number')).toBe(true);
      expect(clips(pack).some((c) => c.launchMode === 'gate')).toBe(true);
      expect(summarizePack(pack).notices.join(' ')).toMatch(/carries patterns, not audio/);
    });
  });
});
