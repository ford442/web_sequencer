import React, { memo } from 'react'
import type { AiImportStage } from '../hooks/useSongStorage'

interface AISongImportOverlayProps {
    isImportingAISong: boolean
    aiImportStage: AiImportStage
    aiImportProgress: number
    aiImportError: string | null
    setIsImportingAISong: React.Dispatch<React.SetStateAction<boolean>>
    setAiImportStage: React.Dispatch<React.SetStateAction<AiImportStage>>
    setAiImportProgress: React.Dispatch<React.SetStateAction<number>>
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void
}

export const AISongImportOverlay = memo(function AISongImportOverlay({
    isImportingAISong,
    aiImportStage,
    aiImportProgress,
    aiImportError,
    setIsImportingAISong,
    setAiImportStage,
    setAiImportProgress,
    showToast,
}: AISongImportOverlayProps) {
    if (!isImportingAISong) return null;

    const stageOrder = ['parsing', 'validating', 'converting', 'uploading', 'loading'];
    const currentIdx = aiImportStage ? stageOrder.indexOf(aiImportStage) : -1;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="AI Song Import Progress" tabIndex={-1}>
            <div className="bg-[#0f1115] border border-emerald-500/30 rounded-xl shadow-[0_0_60px_rgba(16,185,129,0.3)] p-8 max-w-md w-full mx-4">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                        {aiImportStage === 'error' ? (
                            <span className="text-2xl text-red-400">⚠️</span>
                        ) : aiImportStage === 'complete' ? (
                            <span className="text-2xl text-emerald-400">✓</span>
                        ) : (
                            <span className="text-2xl animate-pulse">🤖</span>
                        )}
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">
                            {aiImportStage === 'error' ? 'Import Failed' : 
                             aiImportStage === 'complete' ? 'Import Complete' : 
                             'Importing AI Song'}
                        </h3>
                        <p className="text-sm text-gray-400">
                            {aiImportStage === 'parsing' && 'Parsing JSON...'}
                            {aiImportStage === 'validating' && 'Validating song structure...'}
                            {aiImportStage === 'converting' && 'Converting to Hyphon format...'}
                            {aiImportStage === 'uploading' && 'Uploading to cloud...'}
                            {aiImportStage === 'loading' && 'Loading into sequencer...'}
                            {aiImportStage === 'complete' && 'Successfully imported!'}
                            {aiImportStage === 'error' && aiImportError || 'Processing...'}
                        </p>
                    </div>
                </div>
                
                {/* Progress Bar */}
                <div
                    className="relative h-2 bg-gray-800 rounded-full overflow-hidden"
                    role="progressbar"
                    aria-valuenow={Math.round(aiImportProgress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="AI Song Import Progress"
                >
                    <div 
                        className={`absolute top-0 left-0 h-full rounded-full transition-all duration-300 ${
                            aiImportStage === 'error' ? 'bg-red-500' :
                            aiImportStage === 'complete' ? 'bg-emerald-500' :
                            'bg-gradient-to-r from-emerald-500 to-cyan-500'
                        }`}
                        style={{ width: `${aiImportProgress}%` }}
                    />
                    {/* Animated shimmer effect during processing */}
                    {aiImportStage !== 'error' && aiImportStage !== 'complete' && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" 
                             style={{ 
                                 animation: 'shimmer 1.5s infinite',
                                 backgroundSize: '200% 100%'
                             }} 
                        />
                    )}
                </div>
                
                {/* Progress Steps */}
                <div className="mt-4 grid grid-cols-5 gap-1">
                    {stageOrder.map((stage, idx) => {
                        const isComplete = currentIdx > idx;
                        const isActive = aiImportStage === stage;
                        
                        return (
                            <div 
                                key={stage}
                                className={`h-1 rounded-full transition-all duration-300 ${
                                    isComplete ? 'bg-emerald-500' :
                                    isActive ? 'bg-yellow-400 animate-pulse' :
                                    'bg-gray-800'
                                }`}
                            />
                        );
                    })}
                </div>
                
                {/* Stage Labels */}
                <div className="mt-4 flex justify-between text-[10px] text-gray-500 uppercase tracking-wider">
                    <span className={aiImportStage === 'parsing' ? 'text-emerald-400' : ''}>Parse</span>
                    <span className={aiImportStage === 'validating' ? 'text-emerald-400' : ''}>Validate</span>
                    <span className={aiImportStage === 'converting' ? 'text-emerald-400' : ''}>Convert</span>
                    <span className={aiImportStage === 'uploading' ? 'text-emerald-400' : ''}>Cloud</span>
                    <span className={aiImportStage === 'loading' ? 'text-emerald-400' : ''}>Load</span>
                </div>
                
                {/* Error Message */}
                {aiImportError && (
                    <div className="mt-4 p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
                        <p className="text-xs text-red-400">{aiImportError}</p>
                    </div>
                )}
                
                {/* Cancel Button (only during non-critical stages) */}
                {aiImportStage && !['complete', 'error', 'loading'].includes(aiImportStage) && (
<<<<<<< HEAD
                    <button
=======
                    <button type="button"
>>>>>>> origin/main
                        onClick={() => {
                            setIsImportingAISong(false);
                            setAiImportStage(null);
                            setAiImportProgress(0);
                            showToast('Import cancelled', 'info');
                        }}
                        aria-label="Cancel AI Song Import"
                        title="Cancel AI Song Import"
                        className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1115] hover:scale-105 active:scale-95"
                    >
                        Cancel Import
                    </button>
                )}
            </div>
        </div>
    );
});
