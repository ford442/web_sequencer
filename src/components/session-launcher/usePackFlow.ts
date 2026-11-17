import { useCallback, useState, type RefObject } from 'react';
import type { PackFileActions, PackLoadResult, PackPreviewResult } from '../../session/pack/actions';
import type { PackIssue } from '../../session/pack/format';
import type { SlotCollisionPolicy } from '../../session/pack/plan';
import type { PackPreview } from '../../session/pack/preview';
import { a11yAnnouncerStore } from '../../stores/a11yAnnouncerStore';

/**
 * The launcher's pack interactions: pick a file → read the preview → load on
 * an explicit confirm. All state here is UI state; the session itself changes
 * only inside `actions.confirmLoad` / `actions.loadLibraryPack`, so an error at
 * any earlier step has nothing to undo.
 */
export function usePackFlow(actions: PackFileActions | undefined, importButtonRef: RefObject<HTMLButtonElement | null>) {
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [policy, setPolicy] = useState<SlotCollisionPolicy>('relocate');
  const [problems, setProblems] = useState<PackIssue[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [packName, setPackName] = useState('My session pack');

  const returnFocus = useCallback(() => {
    // After the preview closes, put the user back on the control that opened it.
    queueMicrotask(() => importButtonRef.current?.focus());
  }, [importButtonRef]);

  const showPreview = useCallback((result: PackPreviewResult) => {
    if (result.ok) {
      const { summary } = result.preview;
      setPreview(result.preview);
      setPolicy('relocate');
      setProblems([]);
      setStatus('');
      a11yAnnouncerStore.announce(
        `Previewing pack ${summary.name}: ${summary.scenes.length} scenes, ${summary.totalClips} clips. Nothing has been loaded yet.`,
      );
    } else {
      setPreview(null);
      setProblems(result.errors);
      setStatus('');
      a11yAnnouncerStore.announce(`Could not import the pack. ${result.errors[0]?.message ?? ''} Your session was not changed.`, 'assertive');
    }
  }, []);

  const finishLoad = useCallback((result: PackLoadResult) => {
    if (result.ok) {
      setPreview(null);
      setProblems([]);
      setStatus(result.message);
      a11yAnnouncerStore.announce(result.message);
      returnFocus();
    } else {
      setProblems(result.errors);
      a11yAnnouncerStore.announce(`Could not load the pack. ${result.errors[0]?.message ?? ''} Your session was not changed.`, 'assertive');
    }
  }, [returnFocus]);

  const withBusy = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFile = useCallback((file: File | undefined) => {
    if (!file || !actions) return Promise.resolve();
    return withBusy(async () => showPreview(await actions.previewFile(file)));
  }, [actions, showPreview, withBusy]);

  const previewImported = useCallback((id: string) => {
    if (!actions) return Promise.resolve();
    return withBusy(async () => showPreview(await actions.previewImported(id)));
  }, [actions, showPreview, withBusy]);

  const confirm = useCallback(() => {
    if (!actions || !preview) return Promise.resolve();
    return withBusy(async () => finishLoad(await actions.confirmLoad(preview.pack, policy)));
  }, [actions, preview, policy, finishLoad, withBusy]);

  const loadLibraryPack = useCallback((id: string) => {
    if (!actions) return Promise.resolve();
    return withBusy(async () => finishLoad(await actions.loadLibraryPack(id)));
  }, [actions, finishLoad, withBusy]);

  const exportPack = useCallback(() => {
    if (!actions) return Promise.resolve();
    return withBusy(async () => {
      const result = await actions.exportPack(packName);
      if (result.ok) {
        setProblems([]);
        const warn = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
        const message = `Exported ${result.filename}.${warn}`;
        setStatus(message);
        a11yAnnouncerStore.announce(message);
      } else {
        setProblems(result.errors);
        setStatus('');
        a11yAnnouncerStore.announce(`Could not export. ${result.errors[0]?.message ?? ''}`, 'assertive');
      }
    });
  }, [actions, packName, withBusy]);

  const cancel = useCallback(() => {
    setPreview(null);
    setProblems([]);
    a11yAnnouncerStore.announce('Pack preview closed. Nothing was loaded.');
    returnFocus();
  }, [returnFocus]);

  return {
    preview, policy, setPolicy, problems, status, busy,
    packName, setPackName,
    pickFile, previewImported, confirm, cancel, exportPack, loadLibraryPack,
    dismissProblems: () => setProblems([]),
  };
}

export type PackFlow = ReturnType<typeof usePackFlow>;
