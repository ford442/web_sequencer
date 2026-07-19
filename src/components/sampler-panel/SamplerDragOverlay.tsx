import React from 'react';

interface SamplerDragOverlayProps {
  isDragging: boolean;
  activeBankIdx: number;
}

export const SamplerDragOverlay = React.memo(function SamplerDragOverlay({
  isDragging,
  activeBankIdx,
}: SamplerDragOverlayProps) {
  if (!isDragging) return null;

  return (
    <div className="absolute inset-0 z-50 bg-purple-900/80 backdrop-blur-sm flex items-center justify-center border-2 border-purple-400 m-2 rounded-xl pointer-events-none">
      <div className="text-center animate-pulse">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-purple-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <h3 className="text-2xl font-bold text-white font-orbitron tracking-widest">DROP AUDIO FILE</h3>
        <p className="text-purple-200 mt-2 font-mono text-sm">Load sample into Bank {activeBankIdx + 1}</p>
      </div>
    </div>
  );
});
