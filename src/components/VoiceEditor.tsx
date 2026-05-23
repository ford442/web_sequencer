import React, { useRef, useEffect, useState } from 'react';
import { VoiceDesigner } from '../services/VoiceDesigner';
import { SupertonicService } from '../services/Supertonic';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface VoiceEditorProps {
    onClose: () => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const VoiceEditor: React.FC<VoiceEditorProps> = React.memo(({ onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const designerRef = useRef<VoiceDesigner | null>(null);
    const [status, setStatus] = useState("Ready");
    const [isApplying, setIsApplying] = useState(false);

    // Initialize focus trap
    const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);

    useEffect(() => {
        if (!canvasRef.current) return;

        const initDesigner = () => {
            designerRef.current = new VoiceDesigner();
            const service = SupertonicService.getInstance();
            
            if (!service.isServiceReady()) {
                setStatus("TTS Service Not Ready");
                return;
            }

            const currentStyle = service.getStyle();

            if (currentStyle) {
                designerRef.current.setCanvas(canvasRef.current!);
                designerRef.current.loadFromStyle(currentStyle);
                setStatus("Voice Loaded");
            } else {
                setStatus("No Voice Loaded");
            }
        };

        initDesigner();
    }, []);

    // Dev-only: expose purge action on window.__devtools
    useEffect(() => {
        if (import.meta.env.DEV) {
            const service = SupertonicService.getInstance();
            (window as any).__devtools = (window as any).__devtools || {};
            (window as any).__devtools.purgeTTSCache = () => {
                service.purgeCache();
            };
        }
    }, []);

    const handlePurgeCache = () => {
        const service = SupertonicService.getInstance();
        service.purgeCache();
        setStatus("ONNX cache purged");
    };

    const handleOp = async (op: keyof VoiceDesigner) => {
        const d = designerRef.current;
        if (d && typeof d[op] === 'function') {
            await (d[op] as () => Promise<void>)();
            setStatus(`Applied: ${op}`);
        }
    };

    const handleApply = () => {
        if (!designerRef.current) return;
        
        const service = SupertonicService.getInstance();
        if (!service.isServiceReady()) {
            setStatus("Cannot apply: TTS not ready");
            return;
        }

        const raw = designerRef.current.getRawData();
        if (raw.ttl && raw.dp) {
            setIsApplying(true);
            setStatus("Applying...");
            service.updateStyleFromRaw(raw.ttl, raw.dp, raw.ttlDims, raw.dpDims);
            setStatus("Style Applied to Engine!");
            setTimeout(onClose, 500);
        }
    };

    const btnClass = "text-xs py-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 transition-colors";

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
                    <button onClick={onClose} className="text-gray-400 hover:text-white focus-visible:ring-2 focus-visible:ring-purple-400 rounded" aria-label="Close Voice Designer" title="Close Voice Designer"><span aria-hidden="true">✕</span></button>
                </div>

                {/* Heatmap Area */}
                <div className="border border-gray-700 bg-black mb-4 h-48 relative rounded overflow-hidden">
                    <canvas
                        ref={canvasRef}
                        className="w-full h-full block"
                        style={{ imageRendering: 'pixelated' }}
                        role="img"
                        aria-label="Voice Heatmap Visualization - Interactive Canvas"
                    />
                </div>

                {/* Controls */}
                <div className="grid grid-cols-4 gap-2 mb-6 font-mono">
                    <button onClick={() => handleOp('mirrorX')} className={`${btnClass} bg-gray-800 hover:bg-gray-700 text-gray-300`} aria-label="Mirror the voice pattern horizontally" title="Mirror the voice pattern horizontally">Mirror X</button>
                    <button onClick={() => handleOp('mirrorY')} className={`${btnClass} bg-gray-800 hover:bg-gray-700 text-gray-300`} aria-label="Mirror the voice pattern vertically" title="Mirror the voice pattern vertically">Mirror Y</button>
                    <button onClick={() => handleOp('invertSign')} className={`${btnClass} bg-gray-800 hover:bg-gray-700 text-gray-300`} aria-label="Invert the phase of the voice pattern" title="Invert the phase of the voice pattern">Invert</button>
                    <button onClick={() => handleOp('randomShift')} className={`${btnClass} bg-gray-800 hover:bg-gray-700 text-gray-300`} aria-label="Randomly shift voice characteristics" title="Randomly shift voice characteristics">Rand Shift</button>

                    <button onClick={() => handleOp('dspSharpen')} className={`${btnClass} bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-900/50`} aria-label="Enhance contrast in voice features" title="Enhance contrast in voice features">Sharpen</button>
                    <button onClick={() => handleOp('dspTremolo')} className={`${btnClass} bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-900/50`} aria-label="Apply amplitude modulation" title="Apply amplitude modulation">Tremolo</button>
                    <button onClick={() => handleOp('dspEcho')} className={`${btnClass} bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-900/50`} aria-label="Add delay/echo effect" title="Add delay/echo effect">Echo</button>
                    <button onClick={() => handleOp('reset')} className={`${btnClass} bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-900/50`} aria-label="Reset to original voice style" title="Reset to original voice style">Reset</button>
                </div>

                <div className="flex justify-between items-center">
                    <span
                        className="text-xs text-gray-500 font-mono"
                        role="status"
                        aria-live="polite"
                    >
                        {status}
                    </span>
                    <button
                        onClick={handleApply}
                        disabled={isApplying}
                        className={`px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-[0_0_15px_rgba(34,197,94,0.3)] font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-wait`}
                        aria-busy={isApplying}
                    >
                        {isApplying ? (
                           <span className="flex items-center gap-2">
                               <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                               </svg>
                               APPLYING...
                           </span>
                        ) : "APPLY TO ENGINE"}
                    </button>
                </div>

                {import.meta.env.DEV && (
                    <div className="mt-4 pt-4 border-t border-red-900/30">
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-red-400/70 font-mono">Dev Tools</span>
                            <button
                                onClick={handlePurgeCache}
                                className="px-4 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-300 border border-red-900/40 rounded font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 transition-colors"
                                aria-label="Purge ONNX TTS cache"
                                title="Purge ONNX TTS cache"
                            >
                                Purge ONNX Cache (Dev)
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});
