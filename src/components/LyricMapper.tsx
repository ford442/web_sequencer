import React, { useState, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LyricMapperProps {
    isOpen: boolean;
    onClose: () => void;
    onApply: (text: string, mapToSelection: boolean) => void;
    initialText: string;
    isGenerating: boolean;
    hasSelection: boolean;
}

export const LyricMapper: React.FC<LyricMapperProps> = ({
    isOpen,
    onClose,
    onApply,
    initialText,
    isGenerating,
    hasSelection
}) => {
    const [text, setText] = useState(initialText);
    const containerRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);

    useEffect(() => {
        if (isOpen) {
            setText(initialText);
        }
    }, [isOpen, initialText]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div
                ref={containerRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="lyric-mapper-title"
                className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl flex flex-col gap-4"
            >
                <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                    <h2 id="lyric-mapper-title" className="text-xl font-bold font-orbitron text-cyan-400">LYRIC MAPPER</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>

                <p className="text-sm text-gray-400">
                    Enter lyrics below. "Map to Selection" will assign consecutive phonemes (slices) to your selected notes.
                </p>

                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="w-full h-32 bg-gray-800 border border-gray-700 rounded p-2 text-white font-mono text-sm focus:border-cyan-500 outline-none resize-none"
                    placeholder="Enter lyrics here..."
                    aria-label="Lyrics Input"
                />

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        onClick={() => onApply(text, false)}
                        disabled={isGenerating}
                        className="px-4 py-2 bg-gray-800 text-cyan-400 border border-gray-700 rounded hover:bg-gray-700 disabled:opacity-50 text-xs font-bold font-orbitron"
                    >
                        {isGenerating ? 'GENERATING...' : 'GENERATE ONLY'}
                    </button>
                    <button
                        onClick={() => onApply(text, true)}
                        disabled={isGenerating || !hasSelection}
                        className="px-4 py-2 bg-cyan-900 text-cyan-100 border border-cyan-700 rounded hover:bg-cyan-800 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold font-orbitron"
                        title={!hasSelection ? "Select notes in the sequencer first" : "Generate audio and map phonemes to selection"}
                    >
                        GENERATE & MAP
                    </button>
                </div>
            </div>
        </div>
    );
};
