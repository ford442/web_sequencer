import React from 'react';

interface StartOverlayProps {
    onStart: () => void;
    isReady: boolean;
}

export const StartOverlay: React.FC<StartOverlayProps> = ({ onStart, isReady }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827] bg-opacity-95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="start-overlay-title">
            <div className="text-center p-8 bg-[#1f2937] border-2 border-cyan-500 rounded-2xl shadow-2xl max-w-lg w-full">
                <h1 id="start-overlay-title" className="text-4xl font-bold font-orbitron text-cyan-400 mb-2 tracking-widest drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]">HYPHON</h1>
                <p className="text-gray-400 mb-8 font-mono text-sm tracking-wide">BROWSER AUDIO WORKSTATION</p>
                <div className="mb-8 p-4 bg-gray-800 rounded-lg border border-gray-700 text-left font-mono text-xs text-gray-300" role="status" aria-live="polite">
                    <p className="mb-2 text-cyan-500 font-bold">SYSTEM CHECK:</p>
                    <div className="flex justify-between mb-1"><span>AUDIO ENGINE:</span><span className="text-green-400">READY</span></div>
                    <div className="flex justify-between mb-1"><span>WEBGPU:</span><span className="text-green-400">DETECTED</span></div>
                    <div className="flex justify-between"><span>CORE (PYODIDE):</span>{isReady ? <span className="text-green-400">LOADED</span> : <span className="text-yellow-400 animate-pulse">LOADING...</span>}</div>
                </div>
                <button 
                    aria-label="Initialize System"
                    onClick={onStart} 
                    disabled={!isReady} 
                    aria-busy={!isReady} 
                    title={isReady ? 'Start Application' : 'Please wait, loading system resources...'}
                    className={`w-full py-4 rounded-xl font-orbitron text-xl font-bold tracking-widest transition-all duration-300 flex items-center justify-center gap-3 ${
                        isReady 
                            ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.6)] hover:shadow-[0_0_30px_rgba(6,182,212,0.8)] border border-cyan-400 cursor-pointer transform hover:scale-[1.02]' 
                            : 'bg-gray-700 text-gray-500 cursor-wait border border-gray-600'
                    }`}
                >
                    {!isReady && (
                        <svg className="animate-spin h-6 w-6 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    )}
                    {isReady ? 'INITIALIZE SYSTEM' : 'LOADING RESOURCES...'}
                </button>
            </div>
        </div>
    );
};
