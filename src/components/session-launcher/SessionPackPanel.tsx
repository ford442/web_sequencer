import { memo, useEffect, useId, useRef, type RefObject } from 'react';
import type { PackFileActions } from '../../session/pack/actions';
import { SESSION_PACK_FILE_EXTENSION, PACK_LIMITS } from '../../session/pack/format';
import type { PackPreview } from '../../session/pack/preview';
import { LIBRARY_PACKS } from '../../session/packs/library';
import { SESSION_PACKS } from '../../session/packs';
import { SESSION_TRACK_LABELS } from '../../session/types';
import type { PackFlow } from './usePackFlow';

const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014]';
const PACK_BUTTON = `shrink-0 h-7 px-2 text-[10px] font-orbitron border border-cyan-900/60 text-cyan-300 rounded transition-all ${FOCUS_RING} hover:bg-cyan-900/30 hover:scale-105 active:scale-95 disabled:opacity-50`;
const FILE_BUTTON = `shrink-0 h-7 px-2 text-[10px] font-orbitron border border-zinc-600 text-gray-200 rounded transition-all ${FOCUS_RING} hover:bg-zinc-800 disabled:opacity-50`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface SessionPackPanelProps {
  onLoadPack: (id: string) => void;
  actions?: PackFileActions;
  flow: PackFlow;
  /** The Import button; the flow returns focus to it when a preview closes. */
  importButtonRef: RefObject<HTMLButtonElement | null>;
}

export const SessionPackPanel = memo(function SessionPackPanel({ onLoadPack, actions, flow, importButtonRef }: SessionPackPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

  return (
    <div className="border-b border-gray-800" data-testid="session-pack-panel">
      <div role="group" aria-label="Starter packs" className="px-3 py-2 flex gap-2 overflow-x-auto">
        {SESSION_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={PACK_BUTTON}
            onClick={() => onLoadPack(pack.id)}
            aria-label={`Load starter pack ${pack.name}`}
            title={pack.description}
          >
            {pack.name}
          </button>
        ))}
        {actions && LIBRARY_PACKS.map((pack) => (
          <button
            key={pack.id}
            type="button"
            className={PACK_BUTTON}
            disabled={flow.busy}
            onClick={() => void flow.loadLibraryPack(pack.id)}
            aria-label={`Load starter pack ${pack.name}`}
            title={pack.description}
          >
            {pack.name}
          </button>
        ))}
      </div>

      {actions && (
        <div role="group" aria-label="Pack files" className="px-3 pb-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            hidden
            data-testid="session-pack-file-input"
            accept={`${SESSION_PACK_FILE_EXTENSION},.json,application/json`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // picking the same file again must fire another change
              void flow.pickFile(file);
            }}
          />
          <button
            ref={importButtonRef}
            type="button"
            className={FILE_BUTTON}
            disabled={flow.busy}
            aria-label="Import a session pack file. It is shown for review before anything is loaded."
            onClick={() => fileInputRef.current?.click()}
          >
            IMPORT PACK…
          </button>
          {actions.imported.map((pack) => (
            <button
              key={pack.id}
              type="button"
              className={PACK_BUTTON}
              disabled={flow.busy}
              onClick={() => void flow.previewImported(pack.id)}
              aria-label={`Review imported pack ${pack.name}`}
            >
              {pack.name}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1">
            <label htmlFor={nameId} className="text-[10px] uppercase text-gray-500">Pack name</label>
            <input
              id={nameId}
              type="text"
              maxLength={PACK_LIMITS.maxNameLength}
              value={flow.packName}
              onChange={(e) => flow.setPackName(e.target.value)}
              className={`w-40 h-7 px-1 text-[11px] bg-zinc-900 border border-zinc-700 text-cyan-100 rounded ${FOCUS_RING}`}
            />
            <button
              type="button"
              className={FILE_BUTTON}
              disabled={flow.busy}
              aria-label={`Export the current session as ${SESSION_PACK_FILE_EXTENSION}`}
              onClick={() => void flow.exportPack()}
            >
              EXPORT PACK
            </button>
          </span>
        </div>
      )}

      {flow.status && (
        <p role="status" className="px-3 pb-2 text-[11px] text-cyan-300" data-testid="session-pack-status">{flow.status}</p>
      )}

      {flow.problems.length > 0 && (
        <div role="alert" className="mx-3 mb-2 p-2 border border-red-700 bg-red-950/40 rounded text-[11px] text-red-200" data-testid="session-pack-problems">
          <p className="font-bold">
            {flow.preview ? 'The pack could not be loaded.' : 'The pack could not be used.'} Your session was not changed.
          </p>
          <ul className="list-disc pl-4 mt-1">
            {flow.problems.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>{issue.message}</li>
            ))}
          </ul>
          <button type="button" className={`mt-1 underline ${FOCUS_RING}`} onClick={flow.dismissProblems}>Dismiss</button>
        </div>
      )}

      {flow.preview && <PackPreviewCard preview={flow.preview} flow={flow} />}
    </div>
  );
});

function slotLabel(track: PackPreview['collisions'][number]['track'], slot: number): string {
  return `${SESSION_TRACK_LABELS[track]} slot ${slot + 1}`;
}

function PackPreviewCard({ preview, flow }: { preview: PackPreview; flow: PackFlow }) {
  const { summary, collisions } = preview;
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the preview so a keyboard or screen-reader user lands on it, not on the button they left.
  useEffect(() => {
    headingRef.current?.focus();
  }, [preview]);

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className="mx-3 mb-2 border border-cyan-900/60 bg-black/30 rounded max-h-[46vh] flex flex-col text-[11px] text-gray-300"
      data-testid="session-pack-preview"
    >
      {/* The details scroll; the choice and the Load / Cancel buttons below always stay in view. */}
      <div className="p-3 overflow-auto custom-scrollbar min-h-0 flex-1" role="group" aria-label="Pack details" tabIndex={0}>
        <h3 id={titleId} ref={headingRef} tabIndex={-1} className="font-orbitron text-cyan-300 text-xs tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
          {summary.name}
        </h3>
        <p className="text-gray-400">
          {summary.author ? `by ${summary.author} · ` : ''}
          {plural(summary.scenes.length, 'scene')}, {plural(summary.totalClips, 'clip')}, {plural(summary.totalNotes, 'note')}.
          Nothing is loaded until you choose Load pack.
        </p>
        {summary.description && <p className="mt-1">{summary.description}</p>}
        {preview.renamedFrom && (
          <p className="mt-1 text-amber-300">
            The id “{preview.renamedFrom}” was already in use, so this pack is imported as “{summary.id}”.
          </p>
        )}
        {preview.warnings.map((w) => <p key={w} className="mt-1 text-amber-300">{w}</p>)}

        <h4 className="mt-2 font-bold text-gray-200">Scenes</h4>
        {summary.scenes.length === 0 ? <p>No scenes launch any clips.</p> : (
          <ol className="list-decimal pl-5">
            {summary.scenes.map((scene, i) => (
              <li key={i}>{scene.name} — {plural(scene.clips, 'clip')}</li>
            ))}
          </ol>
        )}
        {summary.emptyScenes > 0 && <p className="text-gray-500">{plural(summary.emptyScenes, 'unused scene')} not listed.</p>}

        <table className="mt-2 text-left">
          <caption className="text-left font-bold text-gray-200">Tracks</caption>
          <thead>
            <tr className="text-gray-500">
              <th scope="col" className="font-normal pr-6">Track</th>
              <th scope="col" className="font-normal pr-6">Clips</th>
              <th scope="col" className="font-normal pr-6">Patterns</th>
              <th scope="col" className="font-normal">Notes</th>
            </tr>
          </thead>
          <tbody>
            {summary.tracks.map((t) => (
              <tr key={t.track}>
                <th scope="row" className="font-normal pr-6">{t.label}</th>
                <td className="pr-6">{t.clips}</td>
                <td className="pr-6">{t.patterns}</td>
                <td>{t.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="mt-2 font-bold text-gray-200">Instruments</h4>
        {summary.instruments.length === 0 ? (
          <p>None — your current synth settings are kept.</p>
        ) : (
          <ul className="list-disc pl-5">
            {summary.instruments.map((inst) => (
              <li key={inst.part}>
                {inst.part}: {inst.waveform} ({inst.engine}){inst.settings > 0 ? `, ${plural(inst.settings, 'setting')}` : ''}
                {inst.requirement ? ` — needs the ${inst.requirement}` : ''}
              </li>
            ))}
          </ul>
        )}
        {summary.notices.map((n) => <p key={n} className="mt-1 text-gray-400">{n}</p>)}
      </div>

      <div className="shrink-0 border-t border-cyan-900/40 p-3">
        {collisions.length > 0 && (
          <fieldset className="mb-2 border border-amber-700/60 rounded p-2">
            <legend className="px-1 text-amber-300">
              {plural(collisions.length, 'pattern slot')} in your song would collide with this pack
            </legend>
            <p className="text-gray-400">{collisions.map((c) => slotLabel(c.track, c.slot)).join(', ')}</p>
            <label className="flex items-start gap-2 mt-1">
              <input type="radio" name="pack-collision" checked={flow.policy === 'relocate'} onChange={() => flow.setPolicy('relocate')} />
              <span>Keep my patterns; put the pack’s patterns in free slots</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="pack-collision" checked={flow.policy === 'overwrite'} onChange={() => flow.setPolicy('overwrite')} />
              <span>Replace my {plural(collisions.length, 'pattern')} with the pack’s</span>
            </label>
          </fieldset>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className={`h-7 px-3 text-[10px] font-orbitron border border-cyan-400 bg-cyan-900/40 text-cyan-100 rounded ${FOCUS_RING} hover:bg-cyan-800/50 disabled:opacity-50`}
            disabled={flow.busy}
            aria-label={`Load pack ${summary.name} into the session`}
            onClick={() => void flow.confirm()}
          >
            LOAD PACK
          </button>
          <button
            type="button"
            className={`h-7 px-3 text-[10px] font-orbitron border border-zinc-600 text-gray-200 rounded ${FOCUS_RING} hover:bg-zinc-800`}
            aria-label="Cancel and discard this pack preview"
            onClick={flow.cancel}
          >
            CANCEL
          </button>
        </div>
      </div>
    </section>
  );
}
