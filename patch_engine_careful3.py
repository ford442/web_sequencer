import sys

def modify_file():
    filepath = "src/hooks/useAudioEngine.ts"
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Add pFormantPitchLink
    search_str_1 = "const revLfoDepth = noteParams?.reverbLfoDepth !== undefined ? noteParams.reverbLfoDepth : (params.reverbLfoDepth || 0);"
    replace_str_1 = search_str_1 + "\n                const pFormantPitchLink = noteParams?.formantPitchLink !== undefined ? noteParams.formantPitchLink : (params.formantPitchLink || 0);"
    content = content.replace(search_str_1, replace_str_1)

    # 2. Add calculation and replace formantShift logic

    search_str_2 = """                            if (startFormantShift !== undefined && (noteParams?.slideFromMidi !== undefined || noteParams?.slideFromFormant !== undefined)) {
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);
                                voice.setFormantGlide(startFormantShift, targetFormantShift, triggerTime, glideDuration);
                            } else {
                                voice.setFormantShift(targetFormantShift, triggerTime);
                            }"""

    replace_str_2 = """                            // Formant Pitch Link
                            const targetMidiNote = noteToMidi(noteStr) + pitchOffsetSemitones;
                            const pitchShiftForFormant = targetMidiNote - 60;
                            const linkedTargetFormantShift = targetFormantShift + (pitchShiftForFormant * pFormantPitchLink);

                            if (startFormantShift !== undefined && (noteParams?.slideFromMidi !== undefined || noteParams?.slideFromFormant !== undefined)) {
                                const startMidiNote = (noteParams?.slideFromMidi !== undefined ? noteParams.slideFromMidi : 60) + pitchOffsetSemitones;
                                const startPitchShiftForFormant = startMidiNote - 60;
                                const linkedStartFormantShift = startFormantShift + (startPitchShiftForFormant * pFormantPitchLink);

                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);
                                voice.setFormantGlide(linkedStartFormantShift, linkedTargetFormantShift, triggerTime, glideDuration);
                            } else {
                                voice.setFormantShift(linkedTargetFormantShift, triggerTime);
                            }"""

    if search_str_2 in content:
        content = content.replace(search_str_2, replace_str_2)
    else:
        print("Could not find second block")

    with open(filepath, 'w') as f:
        f.write(content)

    print("Patch applied carefully")

if __name__ == "__main__":
    modify_file()
