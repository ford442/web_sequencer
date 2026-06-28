import React, { useEffect, useState, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

// A visual debugger for the gamepad states
// Ports the logic from the standalone HTML tester

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const GamepadDebugger: React.FC<{ onClose: () => void }> = React.memo(({ onClose }) => {
  const [gamepads, setGamepads] = useState<Gamepad[]>([]);
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const reqRef = useRef<number | null>(null);

  useEffect(() => {
    const loop = () => {
      const gps = navigator.getGamepads();
      // Filter out nulls for state, but keep indices for display accuracy if needed
      // Here we just grab all non-nulls to show what the browser sees
      setGamepads(Array.from(gps).filter((gp): gp is Gamepad => gp !== null));
      reqRef.current = requestAnimationFrame(loop);
    };

    loop();
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={onClose}>
      <div aria-hidden="true" className="absolute inset-0 z-0"></div>
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-5xl p-6 relative" role="dialog" aria-modal="true" aria-labelledby="gamepad-debugger-title" aria-describedby="gamepad-debugger-desc" tabIndex={-1} ref={modalRef} onClick={e => e.stopPropagation()}>
        <button type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 rounded p-1.5"
          aria-label="Close Debugger"
          title="Close Debugger"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 id="gamepad-debugger-title" className="text-2xl font-bold text-cyan-400 mb-6 flex items-center gap-2">
          <span>🎮</span> Gamepad Debugger
        </h2>

        {gamepads.length === 0 ? (
           <div id="gamepad-debugger-desc" className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-800 rounded-lg">
             No Gamepads Detected. Press a button to wake them up.
           </div>
        ) : (
          <>
            <div id="gamepad-debugger-desc" className="sr-only">Displays real-time state of connected gamepads including buttons and axes.</div>
            <div className="grid grid-cols-1 gap-6">
            {gamepads.map((gp) => (
              <GamepadCard key={gp.index} gamepad={gp} />
            ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
const GamepadCard: React.FC<{ gamepad: Gamepad }> = React.memo(({ gamepad }) => {
  const isGhost = gamepad.buttons.length === 0;

  return (
    <div className={`bg-slate-800/50 rounded-lg p-4 border ${isGhost ? 'border-red-900/30 opacity-60' : 'border-slate-700'}`}>
      <div className="flex justify-between items-start mb-4 border-b border-slate-700/50 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">Index {gamepad.index}</span>
            {isGhost && <span className="text-xs bg-red-900 text-red-200 px-2 py-0.5 rounded">GHOST?</span>}
          </div>
          <div className="text-xs text-slate-500 font-mono truncate max-w-md">{gamepad.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Axes */}
        <div>
           <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Left Stick (Axes 0/1)</h4>
           <div className="relative w-32 h-32 bg-slate-900 rounded-full border border-slate-700 mx-auto">
              <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
                 <div className="w-full h-px bg-slate-400"></div>
                 <div className="h-full w-px bg-slate-400 absolute"></div>
              </div>
              <div
                className="absolute w-4 h-4 bg-cyan-400 rounded-full shadow-[0_0_10px_#22d3ee] transition-all duration-75"
                style={{
                  left: `${50 + (gamepad.axes[0] || 0) * 50}%`,
                  top: `${50 + (gamepad.axes[1] || 0) * 50}%`,
                  transform: 'translate(-50%, -50%)'
                }}
              />
           </div>
           <div className="text-center font-mono text-xs text-cyan-400 mt-1">
             {gamepad.axes[0]?.toFixed(2)}, {gamepad.axes[1]?.toFixed(2)}
           </div>
        </div>

        {/* Buttons */}
        <div>
          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Buttons</h4>
          <div className="grid grid-cols-4 gap-2">
            {gamepad.buttons.map((btn, i) => (
              <div
                key={i}
                className={`
                  aspect-square rounded flex items-center justify-center text-xs font-bold border transition-all duration-75
                  ${btn.pressed
                    ? 'bg-green-500 border-green-400 text-green-900 shadow-[0_0_10px_#4ade80] scale-95'
                    : 'bg-slate-700/50 border-slate-600 text-slate-500'}
                `}
              >
                {i}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
