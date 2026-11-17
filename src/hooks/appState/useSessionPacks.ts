import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { SynthParams } from '../../types';
import type { SessionDocument } from '../../session/types';
import type { PackIssue, SessionPack } from '../../session/pack/format';
import type {
  PackExportOutcome,
  PackFileActions,
  PackLoadResult,
  PackPreviewResult,
} from '../../session/pack/actions';
import type { PackLoadPlan, SlotCollisionPolicy } from '../../session/pack/plan';
import { SESSION_PACKS } from '../../session/packs';
import { LIBRARY_PACKS } from '../../session/packs/library';
import type { TrackStorageMap } from '../../utils/trackStorageUtils';

/** The validator and planner load on first use, not with the app. */
const loadPackModule = () => import('../../session/pack');

interface SessionPackDeps {
  sessionDocumentRef: MutableRefObject<SessionDocument>;
  /** Replaces the session document and records one undo step. */
  setSessionDocument: (doc: SessionDocument, recordUndo?: boolean) => void;
  trackStorageRef: MutableRefObject<TrackStorageMap>;
  setTrackStorage: (storage: TrackStorageMap) => void;
  synthARef: MutableRefObject<SynthParams>;
  synthBRef: MutableRefObject<SynthParams>;
  updateSynthA: (update: Partial<SynthParams>) => void;
  updateSynthB: (update: Partial<SynthParams>) => void;
}

/** Hands a Blob to the browser as a file download. */
function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function failure(message: string): { ok: false; errors: PackIssue[] } {
  return { ok: false, errors: [{ code: 'export', path: '', message }] };
}

/**
 * Pack import / export / load for the Session Launcher. Importing only ever
 * *previews*: the session, the pattern slots and the instruments change in
 * `applyPlan`, which runs only from an explicit confirm (or a one-click
 * library starter) after a plan was computed without error.
 */
export function useSessionPacks(deps: SessionPackDeps): PackFileActions {
  const {
    sessionDocumentRef, setSessionDocument, trackStorageRef, setTrackStorage,
    synthARef, synthBRef, updateSynthA, updateSynthB,
  } = deps;

  const [importedPacks, setImportedPacks] = useState<SessionPack[]>([]);
  const importedRef = useRef(importedPacks);
  useEffect(() => {
    importedRef.current = importedPacks;
  }, [importedPacks]);

  const takenIds = useCallback(
    () => [...SESSION_PACKS, ...LIBRARY_PACKS, ...importedRef.current].map((p) => p.id),
    [],
  );

  const applyPlan = useCallback((plan: PackLoadPlan) => {
    setSessionDocument(plan.session);
    setTrackStorage(plan.trackStorage);
    // The patches the pack's clips were written for (e.g. a macro model).
    if (plan.instruments?.synthA) updateSynthA(plan.instruments.synthA);
    if (plan.instruments?.synthB) updateSynthB(plan.instruments.synthB);
  }, [setSessionDocument, setTrackStorage, updateSynthA, updateSynthB]);

  const previewFile = useCallback(async (file: File): Promise<PackPreviewResult> => {
    const { importPackFile } = await loadPackModule();
    const outcome = await importPackFile(
      file,
      { takenIds: takenIds(), currentStorage: trackStorageRef.current },
      // The same pack imported again is not a collision: it keeps its id and replaces the earlier import.
      (pack) => importedRef.current.some((p) => p.id === pack.id && JSON.stringify(p) === JSON.stringify(pack)),
    );
    return outcome;
  }, [takenIds, trackStorageRef]);

  const previewImported = useCallback(async (id: string): Promise<PackPreviewResult> => {
    const pack = importedRef.current.find((p) => p.id === id);
    if (!pack) return failure('That imported pack is no longer available.');
    const { previewPack } = await loadPackModule();
    return { ok: true, preview: previewPack(pack, trackStorageRef.current) };
  }, [trackStorageRef]);

  const confirmLoad = useCallback(async (pack: SessionPack, policy: SlotCollisionPolicy): Promise<PackLoadResult> => {
    const { planPackLoad } = await loadPackModule();
    const planned = planPackLoad(pack, trackStorageRef.current, policy);
    if (!planned.ok) return failure(planned.error);
    applyPlan(planned.plan);
    setImportedPacks((prev) => [...prev.filter((p) => p.id !== pack.id), pack]);
    const { overwritten, relocated } = planned.plan;
    const detail =
      relocated.length > 0 ? ` ${relocated.length} pattern${relocated.length === 1 ? '' : 's'} went to free slots; yours are untouched.`
      : overwritten.length > 0 ? ` ${overwritten.length} of your pattern${overwritten.length === 1 ? ' was' : 's were'} replaced.`
      : '';
    return { ok: true, message: `Loaded pack ${pack.name}.${detail}` };
  }, [applyPlan, trackStorageRef]);

  const loadLibraryPack = useCallback(async (id: string): Promise<PackLoadResult> => {
    const entry = LIBRARY_PACKS.find((p) => p.id === id);
    if (!entry) return failure(`There is no starter pack "${id}".`);
    const [value, mod] = await Promise.all([entry.load(), loadPackModule()]);
    const parsed = mod.parseSessionPackValue(value);
    if (!parsed.ok) return { ok: false, errors: parsed.errors };
    // Starters replace the slots they use, exactly like the built-in ones.
    const planned = mod.planPackLoad(parsed.pack, trackStorageRef.current, 'overwrite');
    if (!planned.ok) return failure(planned.error);
    applyPlan(planned.plan);
    return { ok: true, message: `Loaded starter pack ${parsed.pack.name}.` };
  }, [applyPlan, trackStorageRef]);

  const exportPack = useCallback(async (name: string): Promise<PackExportOutcome> => {
    const { exportSessionPack } = await loadPackModule();
    const result = exportSessionPack({
      name,
      session: sessionDocumentRef.current,
      trackStorage: trackStorageRef.current,
      synthA: synthARef.current,
      synthB: synthBRef.current,
    });
    if (!result.ok) return { ok: false, errors: result.errors };
    downloadText(result.text, result.filename);
    return { ok: true, filename: result.filename, warnings: result.warnings };
  }, [sessionDocumentRef, trackStorageRef, synthARef, synthBRef]);

  const imported = useMemo(() => importedPacks.map((p) => ({ id: p.id, name: p.name })), [importedPacks]);

  return useMemo(
    () => ({ imported, previewFile, previewImported, confirmLoad, exportPack, loadLibraryPack }),
    [imported, previewFile, previewImported, confirmLoad, exportPack, loadLibraryPack],
  );
}
