import React from 'react';

export interface LadderButtonProps {
    note: string;
    isActive: boolean;
    onClick: () => void;
}

export const LadderButton: React.FC<LadderButtonProps> = ({ note, isActive, onClick }) => (
    <button
        onClick={onClick}
        aria-label={`Select Note ${note}`}
        aria-pressed={isActive}
        className={`w-8 h-5 text-[9px] font-mono font-bold rounded transition-all relative overflow-hidden ${
            isActive
                ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
        }`}
    >
        {/* LED indicator for active state */}
        {isActive && (
            <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
        )}
        <span className={isActive ? 'pl-1.5' : ''}>{note}</span>
    </button>
);
