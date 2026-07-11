import sys

def modify_file():
    filepath = "src/hooks/useAudioEngine.ts"
    with open(filepath, 'r') as f:
        lines = f.readlines()

    out_lines = []

    # 1. Add pFormantPitchLink
    search_str_1 = "const revLfoDepth = noteParams?.reverbLfoDepth !== undefined ? noteParams.reverbLfoDepth : (params.reverbLfoDepth || 0);"

    for i in range(len(lines)):
        out_lines.append(lines[i])
        if search_str_1 in lines[i]:
            out_lines.append("                const pFormantPitchLink = noteParams?.formantPitchLink !== undefined ? noteParams.formantPitchLink : (params.formantPitchLink || 0);\n")

    # 2. Add calculation and replace formantShift logic

    # Let's find the exact lines
    search_start = -1
    search_end = -1
    for i in range(len(out_lines)):
        if "if (startFormantShift !== undefined && (noteParams?.slideFromMidi !== undefined || noteParams?.slideFromFormant !== undefined)) {" in out_lines[i]:
            if "voice.setFormantGlide(startFormantShift, targetFormantShift, triggerTime, glideDuration);" in out_lines[i+2]:
                search_start = i
                search_end = i + 4
                break

    if search_start != -1:
        replace_block = [
            "                            // Formant Pitch Link\n",
            "                            const targetMidiNote = noteToMidi(noteStr) + pitchOffsetSemitones;\n",
            "                            const pitchShiftForFormant = targetMidiNote - 60;\n",
            "                            const linkedTargetFormantShift = targetFormantShift + (pitchShiftForFormant * pFormantPitchLink);\n",
            "                            \n",
            "                            if (startFormantShift !== undefined && (noteParams?.slideFromMidi !== undefined || noteParams?.slideFromFormant !== undefined)) {\n",
            "                                const startMidiNote = (noteParams?.slideFromMidi !== undefined ? noteParams.slideFromMidi : 60) + pitchOffsetSemitones;\n",
            "                                const startPitchShiftForFormant = startMidiNote - 60;\n",
            "                                const linkedStartFormantShift = startFormantShift + (startPitchShiftForFormant * pFormantPitchLink);\n",
            "                            \n",
            "                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);\n",
            "                                voice.setFormantGlide(linkedStartFormantShift, linkedTargetFormantShift, triggerTime, glideDuration);\n",
            "                            } else {\n",
            "                                voice.setFormantShift(linkedTargetFormantShift, triggerTime);\n",
            "                            }\n"
        ]

        out_lines = out_lines[:search_start] + replace_block + out_lines[search_end+1:]
    else:
        print("Could not find second block")

    with open(filepath, 'w') as f:
        f.writelines(out_lines)

    print("Patch applied carefully")

if __name__ == "__main__":
    modify_file()
