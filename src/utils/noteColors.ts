
// Base hues for the 12 chromatic notes (0-360 degrees)
// C = Red (0), G = Blue (240), etc. - Standard-ish association or custom cycle
const NOTE_HUES: Record<string, number> = {
    'C': 0,    // Red
    'C#': 30,  // Orange
    'D': 60,   // Yellow
    'D#': 90,  // Chartreuse
    'E': 120,  // Green
    'F': 150,  // Spring Green
    'F#': 180, // Cyan
    'G': 210,  // Azure
    'G#': 240, // Blue
    'A': 270,  // Violet
    'A#': 300, // Magenta
    'B': 330   // Rose
};

export const getNoteColor = (note: string): string => {
    // Parse note string "C#4" -> noteName "C#", octave 4
    const match = note.match(/^([A-G]#?)(\d)$/);
    if (!match) return '#8fa394'; // Default grey for unknown/invalid

    const [_, noteName, octaveStr] = match;
    const octave = parseInt(octaveStr, 10);

    const hue = NOTE_HUES[noteName];

    // Lightness varies by octave
    // Octave 2 = Darker (40%)
    // Octave 3 = Normal (50%)
    // Octave 4 = Brighter (60%)
    const lightness = 30 + (octave * 10);

    // Saturation is high for "music"
    return `hsl(${hue}, 80%, ${Math.min(lightness, 80)}%)`;
};
