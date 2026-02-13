import React, { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShortcutsHelpProps {
  onClose: () => void;
}

export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Focus trap will focus the close button initially
  const modalRef = useFocusTrap<HTMLDivElement>(true, onClose, closeButtonRef);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative bg-[#0f1215] border border-cyan-900/50 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.15)] max-w-2xl w-full mx-4 p-6 outline-none overflow-y-auto max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="flex justify-between items-start mb-6 border-b border-gray-800 pb-4">
          <h2 id="shortcuts-title" className="text-xl font-orbitron font-bold text-cyan-400 tracking-widest flex items-center gap-2">
            <span className="text-2xl">⌨</span> KEYBOARD SHORTCUTS
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded p-1"
            aria-label="Close Shortcuts Help"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 font-mono text-sm">
          {/* Section 1: Sequencer */}
          <div>
            <h3 className="text-purple-400 font-bold mb-3 uppercase tracking-wider border-b border-purple-900/30 pb-1">
              Sequencer Grid
            </h3>
            <ul className="space-y-2 text-gray-300">
              <li className="flex justify-between">
                <span>Toggle Step</span>
                <span className="text-gray-500">Click / Enter</span>
              </li>
              <li className="flex justify-between">
                <span>Pitch Shift</span>
                <span className="text-gray-500">Right-Click + Drag</span>
              </li>
              <li className="flex justify-between">
                <span>Add Chord</span>
                <span className="text-gray-500">Ctrl + Click</span>
              </li>
              <li className="flex justify-between">
                <span>Toggle Slide</span>
                <span className="text-gray-500">Alt + Click</span>
              </li>
              <li className="flex justify-between">
                <span>Edit Length</span>
                <span className="text-gray-500">Shift + Drag (Active)</span>
              </li>
              <li className="flex justify-between">
                <span>Select Range</span>
                <span className="text-gray-500">Shift + Drag (Empty)</span>
              </li>
            </ul>
          </div>

          {/* Section 2: Global & Edit */}
          <div>
            <h3 className="text-green-400 font-bold mb-3 uppercase tracking-wider border-b border-green-900/30 pb-1">
              Global & Edit
            </h3>
            <ul className="space-y-2 text-gray-300">
              <li className="flex justify-between">
                <span>Copy Selection</span>
                <span className="text-gray-500">Ctrl + C</span>
              </li>
              <li className="flex justify-between">
                <span>Paste Selection</span>
                <span className="text-gray-500">Ctrl + V</span>
              </li>
              <li className="flex justify-between">
                <span>Clear Selection</span>
                <span className="text-gray-500">Delete / Backspace</span>
              </li>
              <li className="flex justify-between">
                <span>Play / Stop</span>
                <span className="text-gray-500">Space (if focused)</span>
              </li>
            </ul>
          </div>

          {/* Section 3: Knobs & Controls */}
          <div>
            <h3 className="text-cyan-400 font-bold mb-3 uppercase tracking-wider border-b border-cyan-900/30 pb-1">
              Knobs & Controls
            </h3>
            <ul className="space-y-2 text-gray-300">
              <li className="flex justify-between">
                <span>Adjust Value</span>
                <span className="text-gray-500">Drag Up/Down</span>
              </li>
              <li className="flex justify-between">
                <span>Fine Tune</span>
                <span className="text-gray-500">Arrow Keys</span>
              </li>
              <li className="flex justify-between">
                <span>Coarse Tune</span>
                <span className="text-gray-500">Shift + Arrows</span>
              </li>
              <li className="flex justify-between">
                <span>Reset (Vol/Pan)</span>
                <span className="text-gray-500">Delete</span>
              </li>
            </ul>
          </div>

           {/* Section 4: Performance */}
           <div>
            <h3 className="text-yellow-400 font-bold mb-3 uppercase tracking-wider border-b border-yellow-900/30 pb-1">
              Live Performance
            </h3>
            <ul className="space-y-2 text-gray-300">
              <li className="flex justify-between">
                <span>White Keys</span>
                <span className="text-gray-500">F1 - F8</span>
              </li>
              <li className="flex justify-between">
                <span>Black Keys</span>
                <span className="text-gray-500">1 - 8</span>
              </li>
              <li className="flex justify-between">
                <span>Octave Shift</span>
                <span className="text-gray-500">Page Up / Down</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 text-center">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-cyan-400 border border-cyan-900/50 rounded font-orbitron text-xs tracking-wider transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          >
            CLOSE GUIDE
          </button>
        </div>
      </div>
    </div>
  );
};
