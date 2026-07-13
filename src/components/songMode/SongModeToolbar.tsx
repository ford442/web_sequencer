import React, { memo } from 'react';

interface SongModeToolbarProps {
    selectionCount: number;
    canUndo: boolean;
    canRedo: boolean;
    onClear: () => void;
    onCycleUp: () => void;
    onCycleDown: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onDuplicateMeasure: () => void;
    onInsertMeasure: () => void;
    onRemoveMeasureAt: () => void;
    compact?: boolean;
}

export const SongModeToolbar = memo(function SongModeToolbar({
    selectionCount,
    canUndo,
    canRedo,
    onClear,
    onCycleUp,
    onCycleDown,
    onCopy,
    onPaste,
    onUndo,
    onRedo,
    onDuplicateMeasure,
    onInsertMeasure,
    onRemoveMeasureAt,
    compact = false,
}: SongModeToolbarProps) {
    const btn =
        'px-2 py-1 text-[10px] rounded border font-mono transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed';
    const activeBtn = `${btn} bg-gray-800 text-cyan-300 border-cyan-900/50 hover:bg-gray-700`;
    const mutedBtn = `${btn} bg-gray-900/60 text-gray-400 border-gray-700 hover:bg-gray-800`;

    return (
        <div
            className={`flex flex-wrap items-center gap-1 ${compact ? 'px-2 py-1' : 'px-3 py-1.5'} bg-gray-900/40 border border-gray-800 rounded-lg`}
            role="toolbar"
            aria-label="Song arrangement editing tools"
        >
            <button type="button" className={mutedBtn} onClick={onUndo} disabled={!canUndo} aria-label="Undo song edit">
                Undo
            </button>
            <button type="button" className={mutedBtn} onClick={onRedo} disabled={!canRedo} aria-label="Redo song edit">
                Redo
            </button>
            <span className="w-px h-4 bg-gray-700 mx-1" aria-hidden />
            <button
                type="button"
                className={activeBtn}
                onClick={onClear}
                disabled={selectionCount === 0}
                aria-label="Clear selected cells"
            >
                Clear
            </button>
            <button
                type="button"
                className={activeBtn}
                onClick={onCycleUp}
                disabled={selectionCount === 0}
                aria-label="Cycle pattern up in selection"
            >
                Pat+
            </button>
            <button
                type="button"
                className={activeBtn}
                onClick={onCycleDown}
                disabled={selectionCount === 0}
                aria-label="Cycle pattern down in selection"
            >
                Pat−
            </button>
            <button type="button" className={activeBtn} onClick={onCopy} disabled={selectionCount === 0} aria-label="Copy selection">
                Copy
            </button>
            <button type="button" className={activeBtn} onClick={onPaste} aria-label="Paste at selection anchor">
                Paste
            </button>
            <span className="w-px h-4 bg-gray-700 mx-1" aria-hidden />
            <button type="button" className={mutedBtn} onClick={onInsertMeasure} aria-label="Insert measure after selection">
                Ins
            </button>
            <button type="button" className={mutedBtn} onClick={onDuplicateMeasure} aria-label="Duplicate measure at selection">
                Dup
            </button>
            <button type="button" className={mutedBtn} onClick={onRemoveMeasureAt} aria-label="Remove measure at selection">
                Del
            </button>
            {selectionCount > 0 && (
                <span className="text-[10px] text-gray-500 ml-1" aria-live="polite">
                    {selectionCount} sel
                </span>
            )}
        </div>
    );
});
