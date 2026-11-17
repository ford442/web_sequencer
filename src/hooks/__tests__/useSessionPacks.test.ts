import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionPacks } from '../appState/useSessionPacks';
import { createDefaultSessionDocument } from '../../session/defaults';
import { getSessionPack } from '../../session/packs';
import { exportSessionPack } from '../../session/pack/export';
import { PACK_LIMITS } from '../../session/pack/format';
import type { PackPreviewResult } from '../../session/pack/actions';
import { DEFAULT_SYNTH_PARAMS_A, DEFAULT_SYNTH_PARAMS_B } from '../../constants';
import { createEmptyTrackStorage, type TrackStorageMap } from '../../utils/trackStorageUtils';
import type { SessionDocument } from '../../session/types';

function packText(id: string, name?: string): string {
  const p = getSessionPack(id)!;
  const out = exportSessionPack({ name: name ?? p.name, session: p.session, trackStorage: p.trackStorage, synthA: p.instruments?.synthA, synthB: p.instruments?.synthB });
  if (!out.ok) throw new Error('export failed');
  return out.text;
}

const fileOf = (text: string, name = 'pack.hyphonpack.json') => new File([text], name, { type: 'application/json' });

function setup(initial?: { session?: SessionDocument; storage?: TrackStorageMap }) {
  const sessionDocumentRef = { current: initial?.session ?? createDefaultSessionDocument() };
  const trackStorageRef = { current: initial?.storage ?? createEmptyTrackStorage() };
  const synthARef = { current: { ...DEFAULT_SYNTH_PARAMS_A } };
  const synthBRef = { current: { ...DEFAULT_SYNTH_PARAMS_B } };
  const setters = {
    setSessionDocument: vi.fn(),
    setTrackStorage: vi.fn(),
    updateSynthA: vi.fn(),
    updateSynthB: vi.fn(),
  };
  const hook = renderHook(() => useSessionPacks({ sessionDocumentRef, trackStorageRef, synthARef, synthBRef, ...setters }));
  const untouched = () => {
    expect(setters.setSessionDocument).not.toHaveBeenCalled();
    expect(setters.setTrackStorage).not.toHaveBeenCalled();
    expect(setters.updateSynthA).not.toHaveBeenCalled();
    expect(setters.updateSynthB).not.toHaveBeenCalled();
  };
  const preview = async (text: string): Promise<PackPreviewResult> => {
    let result!: PackPreviewResult;
    await act(async () => { result = await hook.result.current.previewFile(fileOf(text)); });
    return result;
  };
  return { hook, setters, untouched, preview, sessionDocumentRef, trackStorageRef, synthARef, synthBRef };
}

describe('useSessionPacks', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('a failed import leaves the active session untouched', () => {
    it.each([
      ['not JSON', 'definitely not json'],
      ['not a pack', '{"hello":"world"}'],
      ['an unknown version', JSON.stringify({ ...JSON.parse(packText('acid-live-set')), formatVersion: 99 })],
      ['a malformed pattern', packText('acid-live-set').replace('"velocity":0.9', '"velocity":9')],
      ['a dangling scene reference', packText('acid-live-set').replace(/"kick": "c:kick:0"/, '"kick": "c:kick:77"')],
      ['an invalid instrument value', JSON.stringify({ ...JSON.parse(packText('macro-palette')), instruments: { synthA: { filterCutoff: 1 } } })],
    ])('%s', async (_label, text) => {
      const { hook, untouched, preview } = setup();
      const result = await preview(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].message.length).toBeGreaterThan(10);
      expect(hook.result.current.imported).toEqual([]);
      untouched();
    });

    it('an oversized file is refused from its size alone — it is never read', async () => {
      const { hook, untouched } = setup();
      const big = new File([new Uint8Array(PACK_LIMITS.maxBytes + 1)], 'huge.hyphonpack.json');
      const read = vi.spyOn(big, 'text');
      let result!: PackPreviewResult;
      await act(async () => { result = await hook.result.current.previewFile(big); });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('too-large');
      expect(read).not.toHaveBeenCalled();
      untouched();
    });

    it('a load that cannot be planned changes nothing', async () => {
      const full = createEmptyTrackStorage();
      for (let i = 0; i < PACK_LIMITS.maxSlotsPerTrack; i++) full.kick[i] = { steps: [{ note: 'A5', velocity: 1 }] };
      const { hook, untouched, preview } = setup({ storage: full });
      const result = await preview(packText('minimal-drum-lab'));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      let loaded!: Awaited<ReturnType<typeof hook.result.current.confirmLoad>>;
      await act(async () => { loaded = await hook.result.current.confirmLoad(result.preview.pack, 'relocate'); });
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.errors[0].message).toMatch(/no free pattern slot/);
      expect(hook.result.current.imported).toEqual([]);
      untouched();
    });
  });

  it('previewing a valid pack applies nothing; only the explicit load does', async () => {
    const { hook, setters, untouched, preview } = setup();
    const result = await preview(packText('macro-palette'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    untouched();
    expect(hook.result.current.imported).toEqual([]);

    let loaded!: Awaited<ReturnType<typeof hook.result.current.confirmLoad>>;
    await act(async () => { loaded = await hook.result.current.confirmLoad(result.preview.pack, 'relocate'); });
    expect(loaded).toEqual({ ok: true, message: 'Loaded pack Macro Palette.' });

    expect(setters.setSessionDocument).toHaveBeenCalledTimes(1);
    expect(setters.setSessionDocument.mock.calls[0][0]).toEqual(getSessionPack('macro-palette')!.session);
    const storage = setters.setTrackStorage.mock.calls[0][0] as TrackStorageMap;
    expect(storage.partA[0]).toEqual(getSessionPack('macro-palette')!.trackStorage.partA[0]);
    expect(setters.updateSynthA).toHaveBeenCalledWith(getSessionPack('macro-palette')!.instruments!.synthA);
    expect(setters.updateSynthB).toHaveBeenCalledWith(getSessionPack('macro-palette')!.instruments!.synthB);
    expect(hook.result.current.imported).toEqual([{ id: result.preview.pack.id, name: 'Macro Palette' }]);
  });

  it('keeps the user’s patterns when relocating, and replaces them only when asked to', async () => {
    const mine = createEmptyTrackStorage();
    mine.kick[0] = { steps: [{ note: 'C5', velocity: 1 }] };
    const { hook, setters, preview } = setup({ storage: mine });
    const result = await preview(packText('minimal-drum-lab'));
    if (!result.ok) throw new Error('preview failed');
    expect(result.preview.collisions).toEqual([{ track: 'kick', slot: 0 }]);

    await act(async () => { await hook.result.current.confirmLoad(result.preview.pack, 'relocate'); });
    const relocated = setters.setTrackStorage.mock.calls[0][0] as TrackStorageMap;
    expect(relocated.kick[0]).toEqual(mine.kick[0]);

    await act(async () => { await hook.result.current.confirmLoad(result.preview.pack, 'overwrite'); });
    const overwritten = setters.setTrackStorage.mock.calls[1][0] as TrackStorageMap;
    expect(overwritten.kick[0]).toEqual(getSessionPack('minimal-drum-lab')!.trackStorage.kick[0]);
  });

  describe('stable ids and collisions', () => {
    const importAndLoad = async (hook: ReturnType<typeof setup>['hook'], preview: ReturnType<typeof setup>['preview'], text: string) => {
      const result = await preview(text);
      if (!result.ok) throw new Error('preview failed');
      await act(async () => { await hook.result.current.confirmLoad(result.preview.pack, 'relocate'); });
      return result.preview;
    };

    it('never takes a starter’s id', async () => {
      const { preview } = setup();
      const result = await preview(packText('acid-live-set'));
      expect(result.ok && result.preview.pack.id).toBe('acid-live-set-2');
      expect(result.ok && result.preview.renamedFrom).toBe('acid-live-set');
    });

    it('importing the identical file again keeps its id and replaces the earlier import', async () => {
      const { hook, preview } = setup();
      const text = packText('minimal-drum-lab', 'Drum Notes');
      const first = await importAndLoad(hook, preview, text);
      const second = await importAndLoad(hook, preview, text);
      expect(first.pack.id).toBe('drum-notes');
      expect(second.pack.id).toBe('drum-notes');
      expect(second.renamedFrom).toBeUndefined();
      expect(hook.result.current.imported).toEqual([{ id: 'drum-notes', name: 'Drum Notes' }]);
    });

    it('a different pack under a taken id gets the next numeric suffix, deterministically', async () => {
      const { hook, preview } = setup();
      await importAndLoad(hook, preview, packText('minimal-drum-lab', 'Drum Notes'));
      const other = JSON.parse(packText('acid-live-set', 'Drum Notes')) as { id: string };
      expect(other.id).toBe('drum-notes');
      const second = await importAndLoad(hook, preview, JSON.stringify(other));
      expect(second.pack.id).toBe('drum-notes-2');
      expect(second.renamedFrom).toBe('drum-notes');
      const third = await importAndLoad(hook, preview, packText('dual-303-jam', 'Drum Notes'));
      expect(third.pack.id).toBe('drum-notes-3');
      expect(hook.result.current.imported.map((p) => p.id)).toEqual(['drum-notes', 'drum-notes-2', 'drum-notes-3']);
    });

    it('re-previews an imported pack by id', async () => {
      const { hook, preview } = setup();
      await importAndLoad(hook, preview, packText('minimal-drum-lab', 'Drum Notes'));
      let again!: PackPreviewResult;
      await act(async () => { again = await hook.result.current.previewImported('drum-notes'); });
      expect(again.ok && again.preview.summary.name).toBe('Drum Notes');
      await act(async () => { again = await hook.result.current.previewImported('nope'); });
      expect(again.ok).toBe(false);
    });
  });

  describe('library starters', () => {
    it('load in one click with the starters’ replace-the-slots-they-use semantics, instruments included', async () => {
      const mine = createEmptyTrackStorage();
      mine.partA[0] = { steps: [{ note: 'C5', velocity: 1 }] };
      mine.partA[9] = { steps: [{ note: 'D5', velocity: 1 }] };
      const { hook, setters } = setup({ storage: mine });
      let result!: Awaited<ReturnType<typeof hook.result.current.loadLibraryPack>>;
      await act(async () => { result = await hook.result.current.loadLibraryPack('ambient-drift'); });
      expect(result).toEqual({ ok: true, message: 'Loaded starter pack Ambient Drift.' });

      expect(setters.setSessionDocument).toHaveBeenCalledTimes(1);
      const storage = setters.setTrackStorage.mock.calls[0][0] as TrackStorageMap;
      expect(storage.partA[0]).not.toEqual(mine.partA[0]); // replaced, like Acid Live Set would
      expect(storage.partA[9]).toEqual(mine.partA[9]); // slots the pack does not use survive
      expect(setters.updateSynthA.mock.calls[0][0]).toMatchObject({ waveform: 'macro-string-machine' });
      expect(setters.updateSynthB.mock.calls[0][0]).toMatchObject({ waveform: 'macro-modal', delayMix: 0.4 });
      // A starter is not an import: nothing joins the imported list.
      expect(hook.result.current.imported).toEqual([]);
    });

    it('reports an unknown starter without changing anything', async () => {
      const { hook, untouched } = setup();
      let result!: Awaited<ReturnType<typeof hook.result.current.loadLibraryPack>>;
      await act(async () => { result = await hook.result.current.loadLibraryPack('nope'); });
      expect(result.ok).toBe(false);
      untouched();
    });

    it('imported packs never take a library starter’s id', async () => {
      const { preview } = setup();
      const result = await preview(packText('minimal-drum-lab', 'Ambient Drift'));
      expect(result.ok && result.preview.pack.id).toBe('ambient-drift-2');
    });
  });

  describe('export', () => {
    let blobs: Blob[];
    let clicks: Array<{ href: string; download: string }>;
    beforeEach(() => {
      blobs = [];
      clicks = [];
      URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return `blob:test/${blobs.length}`; });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ href: this.href, download: this.download });
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('downloads the live session, and importing that download reproduces it', async () => {
      const source = getSessionPack('macro-palette')!;
      const { hook, preview } = setup({ session: source.session, storage: source.trackStorage });
      // The live SYNTH A / B parameters feed the instruments block.
      let outcome!: Awaited<ReturnType<typeof hook.result.current.exportPack>>;
      await act(async () => { outcome = await hook.result.current.exportPack('Round Trip'); });
      expect(outcome).toEqual({ ok: true, filename: 'round-trip.hyphonpack.json', warnings: [] });
      expect(clicks).toEqual([{ href: 'blob:test/1', download: 'round-trip.hyphonpack.json' }]);

      const result = await preview(await blobs[0].text());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.pack.session).toEqual(source.session);
      expect(result.preview.pack.trackStorage).toEqual(source.trackStorage);
      expect(result.preview.pack.name).toBe('Round Trip');
    });

    it('does not download when the session cannot be exported', async () => {
      const storage = createEmptyTrackStorage();
      storage.kick[0] = { steps: [{ note: 'C2', velocity: Number.NaN }] };
      const session = createDefaultSessionDocument();
      session.columns.kick.clips[0].empty = false;
      const { hook } = setup({ session, storage });
      let outcome!: Awaited<ReturnType<typeof hook.result.current.exportPack>>;
      await act(async () => { outcome = await hook.result.current.exportPack('Broken'); });
      expect(outcome.ok).toBe(false);
      expect(clicks).toEqual([]);
    });
  });
});
