import React from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShortcutsHelpProps {
    onClose: () => void;
}

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = React.memo(({ onClose }) => {
    const modalRef = useFocusTrap(true, onClose);

    const sections = [
        {
            title: 'Global',
            items: [
                { key: 'Space', desc: 'Play / Stop' },
                { key: 'Ctrl + C', desc: 'Copy Selection' },
                { key: 'Ctrl + V', desc: 'Paste Selection' },
                { key: 'Delete', desc: 'Clear Selection / Reset Knobs' },
            ]
        },
        {
            title: 'Sequencer',
            items: [
                { key: 'Click', desc: 'Toggle Step' },
                { key: 'Shift + Click', desc: 'Select Range / Edit Length' },
                { key: 'Alt + Click', desc: 'Toggle Slide (Gliss)' },
                { key: 'Ctrl + Click', desc: 'Toggle Chord (Major/Minor)' },
                { key: 'Right Click', desc: 'Note Properties Menu' },
            ]
        },
        {
            title: 'Knobs & Controls',
            items: [
                { key: 'Drag', desc: 'Adjust Value' },
                { key: 'Arrows', desc: 'Fine Tune Value' },
                { key: 'Shift + Arrows', desc: 'Coarse Tune Value' },
                { key: 'Double Click', desc: 'Reset to Default' },
            ]
        },
        {
            title: 'Navigation',
            items: [
                { key: 'Tab', desc: 'Focus Next Element' },
                { key: 'Shift + Tab', desc: 'Focus Previous Element' },
                { key: 'Esc', desc: 'Close Modals' },
            ]
        },
        {
            title: 'Engine Selection & Formant Synths',
            items: [
                { key: 'SYNTH B / BASS 2', desc: 'Use 303 waveforms to route into per-voice Open303/JC303 engines' },
                { key: 'engine303', desc: '303 voices can switch between open303 and authentic jc303 DSP' },
                { key: 'prophecy-*', desc: 'Formant synth waveforms are available for partA/partB (UI surfacing in progress)' },
            ]
        }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div
                className="absolute inset-0 z-0"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                ref={modalRef}
                className="w-full max-w-2xl z-10 bg-[#0f1215] border border-cyan-900/50 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden flex flex-col max-h-[80vh]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcuts-title" aria-describedby="shortcuts-desc"
                tabIndex={-1}
            >
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-800 bg-gray-900/50">
                    <h2 id="shortcuts-title" className="text-xl font-orbitron font-bold text-cyan-400 tracking-widest">
                        KEYBOARD SHORTCUTS
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded p-1"
                        aria-label="Close Shortcuts"
                        title="Close Shortcuts"
                    ><span aria-hidden="true">✕</span></button>
                </div>

                {/* Content */}
                <div id="shortcuts-desc" className="p-6 overflow-y-auto custom-scrollbar" aria-label="List of available keyboard shortcuts grouped by section">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {sections.map((section) => (
                            <div key={section.title} className="bg-gray-800/20 rounded-lg p-4 border border-gray-800">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 border-b border-gray-700 pb-2">
                                    {section.title}
                                </h3>
                                <ul className="space-y-2">
                                    {section.items.map((item) => (
                                        <li key={item.key} className="flex justify-between items-center text-sm">
                                            <span className="text-gray-300">{item.desc}</span>
                                            <kbd className="bg-gray-900 border border-gray-700 px-2 py-1 rounded text-xs font-mono text-cyan-500 font-bold min-w-[20px] text-center shadow-sm">
                                                {item.key}
                                            </kbd>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-800 bg-gray-900/50 text-center">
                    <button
                        onClick={onClose}
                        className="bg-cyan-900/30 text-cyan-400 border border-cyan-800/50 hover:bg-cyan-900/50 px-6 py-2 rounded font-orbitron text-xs font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                        aria-label="Acknowledge and close shortcuts"
                        title="Acknowledge and close shortcuts"
                    >
                        GOT IT
                    </button>
                </div>
            </div>
        </div>
    );
});
