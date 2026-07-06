import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Fix the noteToMidi hoisting bug
# Search for the block starting with:
# const isArray = Array.isArray(notes);
# const firstNote = isArray && notes.length > 0 ? notes[0] : notes;
# const noteMidiValue = firstNote ? noteToMidi(firstNote as string) + pitchOffsetSemitones : 0;

old_str = """
                // ⚡ Bolt: Hoist string parsing and noteToMidi out of polyphonic playback loop
                const isArray = Array.isArray(notes);
                const firstNote = isArray && notes.length > 0 ? notes[0] : notes;
                const noteMidiValue = firstNote ? noteToMidi(firstNote as string) + pitchOffsetSemitones : 0;

                notes.forEach(noteStr => {
                    const midi = noteMidiValue;

                    if (shouldGlitch) {
"""

new_str = """
                notes.forEach(noteStr => {
                    const midi = noteToMidi(noteStr) + pitchOffsetSemitones;

                    if (shouldGlitch) {
"""

content = content.replace(old_str, new_str)

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
