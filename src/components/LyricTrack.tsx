import React, { useState, useEffect } from 'react';

interface LyricTrackProps {
    isVisible: boolean;
    initialText: string;
    isGenerating: boolean;
    onApply: (text: string) => void;
    onClose: () => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const LyricTrack: React.FC<LyricTrackProps> = React.memo(({
    isVisible,
    initialText,
    isGenerating,
    onApply,
    onClose
}) => {
    const [text, setText] = useState(initialText);

    useEffect(() => {
        setText(initialText);
    }, [initialText]);

    if (!isVisible) return null;

    return (
        <div className="w-full bg-gray-900 border-b border-gray-700 flex items-center p-2 gap-2 h-12 shadow-inner px-4">
            <div className="text-cyan-400 font-orbitron text-xs font-bold whitespace-nowrap px-2">LYRIC TRACK</div>
            <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1 text-white font-mono text-sm focus:border-cyan-500 outline-none"
                placeholder="Enter full phrase to automatically map syllables to Sampler notes..."
                aria-label="Global Lyric Track Input"
                disabled={isGenerating}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        onApply(text);
                    }
                }}
            />
            <button type="button"
                onClick={() => onApply(text)}
                disabled={isGenerating || !text.trim()}
                aria-busy={isGenerating}
                className="px-4 py-1.5 bg-cyan-900 text-cyan-100 border border-cyan-700 rounded hover:bg-cyan-800 disabled:opacity-50 text-xs font-bold font-orbitron whitespace-nowrap"
            >
                {isGenerating ? 'GENERATING...' : 'APPLY TO TRACK'}
            </button>
            <button type="button"
                onClick={onClose}
                className="px-2 py-1.5 text-gray-500 hover:text-white"
                aria-label="Close Lyric Track"
                title="Close Lyric Track"
            ><span aria-hidden="true">✕</span></button>
        </div>
    );
});
