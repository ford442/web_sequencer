/**
 * The project's edit history (#1597 P2): every labelled step of this tab's
 * user and of the co-producer, oldest first, with jump-to.
 *
 * Clicking a step puts the song back to how it was right after that step:
 * later steps of the same editor are undone, or undone ones redone. Steps of
 * the other editor, and of other tabs, are left alone — Ctrl/Cmd+Z only ever
 * walks the user's own steps; the co-producer's are undone here (or by the
 * co-producer itself).
 */

import { useEffect, useRef } from 'react';
import type { HistoryEntry } from '../collab/history';
import { liveProject, redoHuman, undoHuman, useProjectHistory } from '../collab/liveProject';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function EntryRow({ entry, current }: { entry: HistoryEntry; current: boolean }) {
    const who = entry.editor === 'agent' ? 'co-producer' : 'you';
    return (
        <li>
            <button
                type="button"
                onClick={() => liveProject.jumpTo(entry.id)}
                aria-current={current ? 'step' : undefined}
                aria-label={`${entry.label}, ${who}${entry.done ? '' : ', undone'}. Jump here.`}
                className={`w-full flex items-center gap-2 px-2 py-1 text-left text-[11px] font-mono rounded
                    hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
                    ${current ? 'bg-cyan-950/60 text-cyan-200' : entry.done ? 'text-gray-200' : 'text-gray-500 line-through'}`}
            >
                <span className="flex-1 truncate">{entry.label}</span>
                <span className={`px-1 rounded text-[9px] uppercase ${entry.editor === 'agent' ? 'bg-violet-900/60 text-violet-200' : 'bg-zinc-700 text-gray-300'}`}>
                    {who}
                </span>
                <time className="text-[9px] text-gray-500" dateTime={new Date(entry.at).toISOString()}>
                    {timeFormat.format(entry.at)}
                </time>
            </button>
        </li>
    );
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
    const { entries, canUndo, canRedo } = useProjectHistory();
    const panelRef = useRef<HTMLDivElement>(null);
    let lastDone = -1;
    entries.forEach((entry, i) => {
        if (entry.done) lastDone = i;
    });

    useEffect(() => {
        panelRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const button = 'h-6 px-2 text-[10px] font-mono font-bold border rounded bg-zinc-800 border-zinc-600 text-gray-300 hover:bg-zinc-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500';
    return (
        <div
            ref={panelRef}
            role="dialog"
            aria-label="Edit history"
            tabIndex={-1}
            data-testid="history-panel"
            className="fixed right-4 bottom-12 z-[60] w-80 max-h-[60vh] flex flex-col bg-[#111418] border border-zinc-700 rounded-lg shadow-2xl focus:outline-none"
        >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700">
                <h2 className="flex-1 text-xs font-bold tracking-wider text-gray-200">HISTORY</h2>
                <button type="button" className={button} onClick={undoHuman} disabled={!canUndo} aria-label="Undo (Ctrl/Cmd+Z)">UNDO</button>
                <button type="button" className={button} onClick={redoHuman} disabled={!canRedo} aria-label="Redo (Ctrl/Cmd+Shift+Z)">REDO</button>
                <button type="button" className={button} onClick={onClose} aria-label="Close history">×</button>
            </div>
            <ol className="flex-1 overflow-y-auto p-1 space-y-px" aria-label="Steps, oldest first">
                <li>
                    <button
                        type="button"
                        onClick={() => liveProject.jumpTo('start')}
                        aria-current={lastDone < 0 ? 'step' : undefined}
                        className={`w-full px-2 py-1 text-left text-[11px] font-mono rounded hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${lastDone < 0 ? 'bg-cyan-950/60 text-cyan-200' : 'text-gray-400'}`}
                    >
                        Start (undo all of your steps)
                    </button>
                </li>
                {entries.map((entry, i) => <EntryRow key={entry.id} entry={entry} current={i === lastDone} />)}
            </ol>
            {entries.length === 0 && (
                <p className="px-3 pb-3 text-[10px] text-gray-500">No edits yet. Every edit you make (and every co-producer tool call) shows up here.</p>
            )}
        </div>
    );
}

export default HistoryPanel;
