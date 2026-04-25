import re

with open('src/components/NoteSelector.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    "'formantLfoRate' | 'formantLfoDepth' | 'vibratoDepth'",
    "'formantLfoRate' | 'formantLfoDepth' | 'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'vibratoDepth'"
)

content = content.replace(
    "currentFormantLfoRate = 0, currentFormantLfoDepth = 0,",
    "currentFormantLfoRate = 0, currentFormantLfoDepth = 0, currentFormantEnvAttack = 0.1, currentFormantEnvDecay = 0.5, currentFormantEnvAmount = 0,"
)

block = """
                        {/* Formant LFO Depth Control */}
                        {trackType === 'synth' && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-gray-400 font-mono tracking-wider">
                                    <span>FMT LFO DEPTH</span>
                                    <span className="text-indigo-300">{(currentFormantLfoDepth * 100).toFixed(0)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentFormantLfoDepth}
                                    onChange={(e) => onPropertyChange && onPropertyChange('formantLfoDepth', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                    aria-valuetext={`${(currentFormantLfoDepth * 100).toFixed(0)} percent`}
                                    aria-label="Formant LFO Depth"
                                />
                            </div>
                        )}
"""

new_block = block + """
                        {/* Formant Env Amount Control */}
                        {trackType === 'synth' && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-gray-400 font-mono tracking-wider">
                                    <span>FMT ENV AMT</span>
                                    <span className="text-indigo-300">{currentFormantEnvAmount > 0 ? '+' : ''}{currentFormantEnvAmount.toFixed(0)} st</span>
                                </div>
                                <input
                                    type="range"
                                    min="-24"
                                    max="24"
                                    step="1"
                                    value={currentFormantEnvAmount}
                                    onChange={(e) => onPropertyChange && onPropertyChange('formantEnvAmount', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                    aria-valuetext={`${currentFormantEnvAmount} semitones`}
                                    aria-label="Formant Envelope Amount"
                                />
                            </div>
                        )}
"""

content = content.replace(block, new_block)

with open('src/components/NoteSelector.tsx', 'w') as f:
    f.write(content)
