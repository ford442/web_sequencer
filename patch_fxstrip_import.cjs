const fs = require('fs');
const path = 'src/hooks/useAudioEngine.ts';
let code = fs.readFileSync(path, 'utf8');

const lines = code.split('\n');
const idx = lines.findIndex(l => l.includes("import { VoiceFXStrip } from '../engines/audio-fx/VoiceFXStrip';"));
if (idx !== -1) {
    lines.splice(idx, 1);
    // insert it properly above the import { createAmbianceControls...
    const importIdx = lines.findIndex(l => l.includes("createAmbianceControls,"));
    lines.splice(importIdx - 1, 0, "import { VoiceFXStrip } from '../engines/audio-fx/VoiceFXStrip';");
    fs.writeFileSync(path, lines.join('\n'));
}
console.log('Fixed import');
