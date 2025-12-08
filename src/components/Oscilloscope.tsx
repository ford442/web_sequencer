import React, { useRef } from 'react';
import type { SynthParams } from '../types';
import { useWebGPUScope } from '../hooks/useWebGPUScope';

interface OscilloscopeProps {
    params: SynthParams;
    accentColor: 'cyan' | 'pink';
}

export const Oscilloscope: React.FC<OscilloscopeProps> = ({ params, accentColor }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Initialize the WebGPU bridge
    useWebGPUScope(canvasRef, params, accentColor);

    return (
        <div className="w-full h-24 bg-black rounded-md overflow-hidden border border-gray-700 relative shadow-inner">
            {/* Fallback text if WebGPU isn't supported/enabled */}
            <div className="absolute inset-0 flex items-center justify-center text-gray-800 text-xs font-mono pointer-events-none -z-10">
                WGSL SCOPE
            </div>
            <canvas
                ref={canvasRef}
                width={600}
                height={200}
                className="w-full h-full block"
            />
            {/* Overlay grid lines */}
            <div className="absolute inset-0 border-t border-b border-gray-800/50 pointer-events-none" style={{ top: '50%', height: '1px' }}></div>
        </div>
    );
};
