import React, { useRef, useEffect, useState } from 'react';
import { VoiceDesigner } from '../services/VoiceDesigner';
import { SupertonicService } from '../services/Supertonic';

interface VoiceEditorProps {
    onClose: () => void;
}

export const VoiceEditor: React.FC<VoiceEditorProps> = ({ onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const designerRef = useRef<VoiceDesigner | null>(null);
    const [status, setStatus] = useState("Ready");

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
            service.updateStyleFromRaw(raw.ttl, raw.dp, raw.ttlDims, raw.dpDims);
            setStatus("Style Applied to Engine!");
            setTimeout(onClose, 500);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="bg-gray-900 border border-purple-500 rounded-xl p-6 w-[600px] shadow-2xl">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-orbitron text-purple-400">VOICE DESIGNER <span className="text-xs text-gray-500 ml-2">(WebGPU)</span></h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>

                {/* Heatmap Area */}
                <div className="border border-gray-700 bg-black mb-4 h-48 relative rounded overflow-hidden">
                    <canvas
                        ref={canvasRef}
                        className="w-full h-full block"
                        style={{ imageRendering: 'pixelated' }}
                    />
                </div>

                {/* Controls */}
                <div className="grid grid-cols-4 gap-2 mb-6 font-mono">
                    <button onClick={() => handleOp('mirrorX')} className="bg-gray-800 text-xs py-2 hover:bg-gray-700 text-gray-300 rounded">Mirror X</button>
                    <button onClick={() => handleOp('mirrorY')} className="bg-gray-800 text-xs py-2 hover:bg-gray-700 text-gray-300 rounded">Mirror Y</button>
                    <button onClick={() => handleOp('invertSign')} className="bg-gray-800 text-xs py-2 hover:bg-gray-700 text-gray-300 rounded">Invert</button>
                    <button onClick={() => handleOp('randomShift')} className="bg-gray-800 text-xs py-2 hover:bg-gray-700 text-gray-300 rounded">Rand Shift</button>

                    <button onClick={() => handleOp('dspSharpen')} className="bg-purple-900/30 text-xs py-2 hover:bg-purple-900/50 text-purple-300 rounded border border-purple-900/50">Sharpen</button>
                    <button onClick={() => handleOp('dspTremolo')} className="bg-purple-900/30 text-xs py-2 hover:bg-purple-900/50 text-purple-300 rounded border border-purple-900/50">Tremolo</button>
                    <button onClick={() => handleOp('dspEcho')} className="bg-purple-900/30 text-xs py-2 hover:bg-purple-900/50 text-purple-300 rounded border border-purple-900/50">Echo</button>
                    <button onClick={() => handleOp('reset')} className="bg-red-900/30 text-xs py-2 hover:bg-red-900/50 text-red-300 rounded border border-red-900/50">Reset</button>
                </div>

                <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500 font-mono">{status}</span>
                    <button
                        onClick={handleApply}
                        className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-[0_0_15px_rgba(34,197,94,0.3)] font-mono text-sm"
                    >
                        APPLY TO ENGINE
                    </button>
                </div>
            </div>
        </div>
    );
};
