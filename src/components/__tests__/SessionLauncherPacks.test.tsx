import { render, screen, fireEvent, act, waitFor, within, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionLauncher } from '../SessionLauncher';
import { createDefaultSessionDocument } from '../../session/defaults';
import { TRACK_KEYS } from '../../constants';
import type { TrackKey } from '../../constants/appDefaults';
import { createEmptyTrackStorage } from '../../utils/trackStorageUtils';
import { getSessionPack } from '../../session/packs';
import { exportSessionPack } from '../../session/pack/export';
import { parseSessionPackText } from '../../session/pack/validate';
import { previewPack } from '../../session/pack/preview';
import type { PackFileActions } from '../../session/pack/actions';
import type { SessionPack } from '../../session/pack/format';

const emptyPlaying = () => {
  const m = {} as Record<TrackKey, number | null>;
  for (const t of TRACK_KEYS) m[t] = null;
  return m;
};

function packFromBuiltIn(id: string): SessionPack {
  const p = getSessionPack(id)!;
  const out = exportSessionPack({ name: p.name, description: p.description, session: p.session, trackStorage: p.trackStorage, synthA: p.instruments?.synthA, synthB: p.instruments?.synthB });
  if (!out.ok) throw new Error('export failed');
  const parsed = parseSessionPackText(out.text);
  if (!parsed.ok) throw new Error('import failed');
  return parsed.pack;
}

function makeActions(overrides: Partial<PackFileActions> = {}): PackFileActions {
  const pack = packFromBuiltIn('macro-palette');
  return {
    imported: [],
    previewFile: vi.fn(() => Promise.resolve(({ ok: true as const, preview: previewPack(pack, createEmptyTrackStorage()) }))),
    previewImported: vi.fn(() => Promise.resolve(({ ok: true as const, preview: previewPack(pack, createEmptyTrackStorage()) }))),
    confirmLoad: vi.fn(() => Promise.resolve(({ ok: true as const, message: 'Loaded pack Macro Palette.' }))),
    exportPack: vi.fn(() => Promise.resolve(({ ok: true as const, filename: 'my-pack.hyphonpack.json', warnings: [] }))),
    loadLibraryPack: vi.fn(() => Promise.resolve(({ ok: true as const, message: 'Loaded starter pack.' }))),
    ...overrides,
  };
}

describe('SessionLauncher pack files', () => {
  const doc = createDefaultSessionDocument();
  doc.columns.kick.clips[0].empty = false;
  doc.columns.kick.clips[0].name = 'Kick A';

  const baseProps = () => ({
    isVisible: true,
    document: doc,
    playingSlots: emptyPlaying(),
    currentStep: 0,
    isCapturing: false,
    quantization: 'bar' as const,
    onClose: vi.fn(),
    onLaunchClip: vi.fn(),
    onLaunchScene: vi.fn(),
    onStopTrack: vi.fn(),
    onStopAll: vi.fn(),
    onSetQuantization: vi.fn(),
    onBeginCapture: vi.fn(),
    onFinishCapture: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: false,
    canRedo: false,
    onLoadPack: vi.fn(),
    onUpdateDocument: vi.fn(),
  });

  const pickFile = async (content = '{}') => {
    // Let the dialog's own initial-focus pass (next animation frame) finish first, as it would
    // long before a person has chosen a file.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const input = screen.getByTestId<HTMLInputElement>('session-pack-file-input');
    const file = new File([content], 'set.hyphonpack.json', { type: 'application/json' });
    await act(() => {
      fireEvent.change(input, { target: { files: [file] } });
      return Promise.resolve();
    });
  };

  beforeEach(() => vi.clearAllMocks());

  it('shows no file controls when the app does not provide pack actions', () => {
    render(<SessionLauncher {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /Import a session pack file/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Load starter pack Acid Live Set' })).toBeTruthy();
  });

  it('loads a data-file starter in one click through the pack actions', async () => {
    const actions = makeActions();
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load starter pack Ambient Drift' }));
      return Promise.resolve();
    });
    expect(actions.loadLibraryPack).toHaveBeenCalledWith('ambient-drift');
    expect(screen.getByRole('status').textContent).toMatch(/Loaded starter pack/);
    // Built-in starters keep their own, synchronous path.
    expect(screen.getByRole('button', { name: 'Load starter pack Acid Live Set' })).toBeTruthy();
  });

  it('labels every pack control', () => {
    render(<SessionLauncher {...baseProps()} packFiles={makeActions({ imported: [{ id: 'mine', name: 'Mine' }] })} />);
    expect(screen.getByRole('group', { name: 'Starter packs' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Pack files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Import a session pack file\. It is shown for review before anything is loaded/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review imported pack Mine' })).toBeTruthy();
    expect(screen.getByLabelText('Pack name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export the current session as .hyphonpack.json' })).toBeTruthy();
  });

  it('lets header controls keep Enter, Space and Delete; the grid keeps them for launching', () => {
    const props = baseProps();
    render(<SessionLauncher {...props} packFiles={makeActions()} />);

    const importButton = screen.getByRole('button', { name: /Import a session pack file/ });
    for (const key of ['Enter', ' ']) {
      const event = createEvent.keyDown(importButton, { key });
      fireEvent(importButton, event);
      expect(event.defaultPrevented, `${JSON.stringify(key)} on a button must not be swallowed`).toBe(false);
    }
    const quant = screen.getByLabelText('Launch quantization');
    const arrow = createEvent.keyDown(quant, { key: 'ArrowDown' });
    fireEvent(quant, arrow);
    expect(arrow.defaultPrevented).toBe(false);

    // Editing the pack name: Backspace edits text, it does not stop the clips.
    const name = screen.getByLabelText('Pack name');
    const backspace = createEvent.keyDown(name, { key: 'Backspace' });
    fireEvent(name, backspace);
    expect(backspace.defaultPrevented).toBe(false);
    expect(props.onStopAll).not.toHaveBeenCalled();

    // …while in the grid the same keys still launch and stop.
    const scene = screen.getByTestId('session-scene-0');
    act(() => scene.focus());
    fireEvent.keyDown(scene, { key: ' ' });
    expect(props.onLaunchScene).toHaveBeenCalledWith(0);
    fireEvent.keyDown(scene, { key: 'Delete' });
    expect(props.onStopAll).toHaveBeenCalledTimes(1);
  });

  it('previews a picked pack — name, scenes, tracks, instruments — and loads nothing yet', async () => {
    const actions = makeActions();
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await pickFile();

    const region = await screen.findByRole('region', { name: 'Macro Palette' });
    expect(actions.previewFile).toHaveBeenCalledTimes(1);
    expect(actions.confirmLoad).not.toHaveBeenCalled();
    const view = within(region);
    expect(view.getByText(/Nothing is loaded until you choose Load pack/)).toBeTruthy();
    expect(view.getByRole('heading', { name: 'Scenes' })).toBeTruthy();
    expect(view.getByText(/Chords — 4 clips/)).toBeTruthy();
    expect(view.getByRole('table', { name: 'Tracks' })).toBeTruthy();
    expect(view.getByRole('rowheader', { name: 'SYNTH A' })).toBeTruthy();
    expect(view.getByText(/SYNTH A: macro-additive \(Macro\).*needs the native macro engine/)).toBeTruthy();
    expect(view.getByText(/Sampler|Nothing/, { exact: false })).toBeTruthy();
    // Keyboard users land on the preview.
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole('heading', { name: 'Macro Palette' })));
  });

  it('loads only on the explicit button, then closes the preview and says so', async () => {
    const actions = makeActions();
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await pickFile();
    await screen.findByRole('region', { name: 'Macro Palette' });

    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load pack Macro Palette into the session' }));
      return Promise.resolve();
    });
    expect(actions.confirmLoad).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actions.confirmLoad).mock.calls[0][1]).toBe('relocate');
    expect(screen.queryByRole('region', { name: 'Macro Palette' })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Loaded pack Macro Palette/);
  });

  it('cancel discards the preview without loading', async () => {
    const actions = makeActions();
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await pickFile();
    await screen.findByRole('region', { name: 'Macro Palette' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel and discard this pack preview' }));
    expect(screen.queryByRole('region', { name: 'Macro Palette' })).toBeNull();
    expect(actions.confirmLoad).not.toHaveBeenCalled();
  });

  it('a file that fails validation shows actionable errors and no preview, load or change', async () => {
    const actions = makeActions({
      previewFile: vi.fn(() => Promise.resolve({
        ok: false as const,
        errors: [{ code: 'schema' as const, path: 'trackStorage.kick[0].steps[0].velocity', message: 'trackStorage.kick[0].steps[0].velocity: 7 is out of range; it must be at most 1.' }],
      })),
    });
    const props = baseProps();
    render(<SessionLauncher {...props} packFiles={actions} />);
    await pickFile('{"nonsense":true}');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/steps\[0\]\.velocity: 7 is out of range/);
    expect(alert.textContent).toMatch(/Your session was not changed/);
    expect(screen.queryByTestId('session-pack-preview')).toBeNull();
    expect(actions.confirmLoad).not.toHaveBeenCalled();
    expect(props.onLoadPack).not.toHaveBeenCalled();
    expect(props.onUpdateDocument).not.toHaveBeenCalled();
  });

  it('a load that fails (no free slot) keeps the preview open and reports it', async () => {
    const actions = makeActions({
      confirmLoad: vi.fn(() => Promise.resolve(({ ok: false as const, errors: [{ code: 'export' as const, path: '', message: 'KICK has no free pattern slot left.' }] }))),
    });
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await pickFile();
    await screen.findByRole('region', { name: 'Macro Palette' });
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load pack Macro Palette into the session' }));
      return Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/KICK has no free pattern slot left/);
    expect(screen.getByRole('region', { name: 'Macro Palette' })).toBeTruthy();
  });

  it('an action that rejects (the lazy importer chunk failing to load) still ends in an alert, not silence', async () => {
    const actions = makeActions({
      previewFile: vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module'))),
    });
    const props = baseProps();
    render(<SessionLauncher {...props} packFiles={actions} />);
    await pickFile();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Could not import the pack: Failed to fetch dynamically imported module/);
    expect(alert.textContent).toMatch(/Your session was not changed/);
    expect(screen.queryByTestId('session-pack-preview')).toBeNull();
    expect(actions.confirmLoad).not.toHaveBeenCalled();
    expect(props.onUpdateDocument).not.toHaveBeenCalled();
    // The controls come back, so the person can try again.
    const importButton = screen.getByRole('button', { name: /Import a session pack file/ }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);
  });

  it('a load that rejects keeps the preview open and reports it', async () => {
    const actions = makeActions({ confirmLoad: vi.fn(() => Promise.reject(new Error('boom'))) });
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await pickFile();
    await screen.findByRole('region', { name: 'Macro Palette' });
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load pack Macro Palette into the session' }));
      return Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Could not load the pack: boom/);
    expect(screen.getByRole('region', { name: 'Macro Palette' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Load pack Macro Palette into the session' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a choice when the pack collides with the song’s patterns, defaulting to keeping them', async () => {
    const pack = packFromBuiltIn('minimal-drum-lab');
    const current = createEmptyTrackStorage();
    current.kick[0] = { steps: [{ note: 'C5', velocity: 1 }] };
    const actions = makeActions({
      previewFile: vi.fn(() => Promise.resolve(({ ok: true as const, preview: previewPack(pack, current) }))),
    });
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await pickFile();
    const region = await screen.findByRole('region', { name: 'Minimal Drum Lab' });

    expect(within(region).getByText(/1 pattern slot in your song would collide/)).toBeTruthy();
    expect(within(region).getByText('KICK slot 1')).toBeTruthy();
    const keep = within(region).getByRole<HTMLInputElement>('radio', { name: /Keep my patterns/ });
    const replace = within(region).getByRole<HTMLInputElement>('radio', { name: /Replace my 1 pattern/ });
    expect(keep.checked).toBe(true);

    fireEvent.click(replace);
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load pack Minimal Drum Lab into the session' }));
      return Promise.resolve();
    });
    expect(vi.mocked(actions.confirmLoad).mock.calls[0][1]).toBe('overwrite');
  });

  it('Escape closes the preview first and the launcher second', async () => {
    const props = baseProps();
    render(<SessionLauncher {...props} packFiles={makeActions()} />);
    await pickFile();
    await screen.findByRole('region', { name: 'Macro Palette' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Macro Palette' })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('exports with the typed pack name, and reports a failed export without a download', async () => {
    const actions = makeActions();
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'Friday Jam' } });
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Export the current session as .hyphonpack.json' }));
      return Promise.resolve();
    });
    expect(actions.exportPack).toHaveBeenCalledWith('Friday Jam');
    expect(screen.getByRole('status').textContent).toMatch(/Exported my-pack\.hyphonpack\.json/);

    vi.mocked(actions.exportPack).mockResolvedValueOnce({ ok: false, errors: [{ code: 'export', path: 'trackStorage.kick[0]', message: 'This session cannot be exported as a pack — oops.' }] });
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Export the current session as .hyphonpack.json' }));
      return Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/cannot be exported as a pack/);
  });

  it('re-opens an earlier import for review', async () => {
    const actions = makeActions({ imported: [{ id: 'macro-palette', name: 'Macro Palette' }] });
    render(<SessionLauncher {...baseProps()} packFiles={actions} />);
    await act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Review imported pack Macro Palette' }));
      return Promise.resolve();
    });
    expect(actions.previewImported).toHaveBeenCalledWith('macro-palette');
    expect(await screen.findByRole('region', { name: 'Macro Palette' })).toBeTruthy();
  });
});
