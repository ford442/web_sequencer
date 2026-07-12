import sys

def modify_file():
    filepath = "src/components/NoteSelector.tsx"
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Add currentFormantPitchLink to NoteSelectorProps
    search_1 = "currentVocoderFormantShift?: number;"
    replace_1 = "currentVocoderFormantShift?: number;\n  currentFormantPitchLink?: number;"
    if search_1 in content:
        content = content.replace(search_1, replace_1)

    # 2. Add currentFormantPitchLink to destructured props
    search_2 = "currentVocoderFormantShift,"
    replace_2 = "currentVocoderFormantShift,\n    currentFormantPitchLink,"
    if search_2 in content:
        content = content.replace(search_2, replace_2)

    # 3. Add to Types
    search_str = '| "formantShift"'
    replace_str = search_str + '\n      | "formantPitchLink"'
    if search_str in content:
        content = content.replace(search_str, replace_str)

    # 4. Add UI
    search_ui = """                    <input
                      id="note-vocoder-formant-shift"
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={currentVocoderFormantShift ?? 0}
                      onChange={(e) =>
                        onPropertyChange?.(
                          "vocoderFormantShift",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all border border-indigo-900/30"
                      aria-label="Vocoder Formant Shift Override"
                    />
                  </div>"""

    replace_ui = """                    <input
                      id="note-vocoder-formant-shift"
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={currentVocoderFormantShift ?? 0}
                      onChange={(e) =>
                        onPropertyChange?.(
                          "vocoderFormantShift",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all border border-indigo-900/30"
                      aria-label="Vocoder Formant Shift Override"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-indigo-200/70 font-bold uppercase">
                      <label htmlFor="note-formant-pitch-link">Fmt Link</label>
                      <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">
                        {currentFormantPitchLink?.toFixed(2) ?? '0.00'}
                      </span>
                    </div>
                    <input
                      id="note-formant-pitch-link"
                      type="range"
                      min="-1"
                      max="1"
                      step="0.01"
                      value={currentFormantPitchLink ?? 0}
                      onChange={(e) =>
                        onPropertyChange?.(
                          "formantPitchLink",
                          parseFloat(e.target.value),
                        )
                      }
                      className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 hover:accent-indigo-300 transition-all border border-indigo-900/30"
                      aria-label="Formant Pitch Link Override"
                    />
                  </div>"""

    if search_ui in content:
        content = content.replace(search_ui, replace_ui)

    with open(filepath, 'w') as f:
        f.write(content)

    print("Patch applied")

if __name__ == "__main__":
    modify_file()
