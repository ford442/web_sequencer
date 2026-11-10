import React, { useCallback, useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { VoiceDesignerSurface } from './VoiceDesignerSurface';

interface VoiceEditorProps {
    onClose: () => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const VoiceEditor: React.FC<VoiceEditorProps> = React.memo(({ onClose }) => {
    // Initialize focus trap
    const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    }, []);

    const handleApplied = useCallback(() => {
        closeTimerRef.current = setTimeout(onClose, 500);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
        >
            <div
                className="absolute inset-0 z-0"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                ref={trapRef}
                className="relative z-10 bg-gray-900 border border-purple-500 rounded-xl p-6 w-[600px] shadow-2xl outline-none"
                role="dialog"
                aria-modal="true"
                aria-labelledby="voice-designer-title"
                tabIndex={-1}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 id="voice-designer-title" className="text-xl font-orbitron text-purple-400">VOICE DESIGNER <span className="text-xs text-gray-500 ml-2">(WebGPU)</span></h2>
                    <button type="button" onClick={onClose} className="text-gray-400 hover:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:ring-purple-400 rounded" aria-label="Close Voice Designer" title="Close Voice Designer"><span aria-hidden="true">✕</span></button>
                </div>

                <VoiceDesignerSurface onApplied={handleApplied} showDevTools />
            </div>
        </div>
    );
});
