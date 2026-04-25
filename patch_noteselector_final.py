import re

with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

reverb_replace = """                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-reverbsend">Reverb Send</label>
                                        <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-reverbsend"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentReverbSend !== undefined ? currentReverbSend : 0}
                                        onChange={(e) => onPropertyChange?.('reverbSend', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%`}
                                        aria-label="Reverb Send"
                                    />
                                    <div className="flex justify-between items-center mt-1">
                                        <span className="text-[9px] text-indigo-200/50 uppercase font-bold">Space</span>
                                        <select
                                            value={currentReverbType || ''}
                                            onChange={(e) => onPropertyChange?.('reverbType', e.target.value)}
                                            className="bg-gray-800/80 text-[10px] text-indigo-200 rounded border border-indigo-900/30 px-1 py-0.5 outline-none focus:border-indigo-500 transition-colors"
                                            aria-label="Reverb Type Override"
                                        >
                                            <option value="">Global</option>
                                            <option value="room">Room</option>
                                            <option value="plate">Plate</option>
                                            <option value="hall">Hall</option>
                                        </select>
                                    </div>
                                </div>"""

content = re.sub(
    r'                                <div className="flex flex-col gap-1 mt-2">\n                                    <div className="flex justify-between text-\[10px\] text-cyan-200/70 font-bold uppercase">\n                                        <label htmlFor="note-reverbsend">Reverb Send</label>\n                                        <span className="text-indigo-400 font-mono text-\[10px\] drop-shadow-\[0_0_5px_rgba\(129,140,248,0\.5\)\]">\{currentReverbSend !== undefined \? Math\.round\(currentReverbSend \* 100\) : 0\}%</span>\n                                    </div>\n                                    <input\n                                        id="note-reverbsend"\n                                        type="range"\n                                        min="0"\n                                        max="1"\n                                        step="0\.01"\n                                        value=\{currentReverbSend !== undefined \? currentReverbSend : 0\}\n                                        onChange=\{\(e\) => onPropertyChange\(\'reverbSend\', parseFloat\(e\.target\.value\)\)\}\n                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"\n                                        aria-valuetext=\{`\$\{currentReverbSend !== undefined \? Math\.round\(currentReverbSend \* 100\) : 0\}%`\}\n                                        aria-label="Reverb Send"\n                                    />\n                                </div>',
    reverb_replace,
    content
)

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)
