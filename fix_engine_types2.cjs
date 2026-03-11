const fs = require('fs');

const code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

// Replace the missing imports for Bass2Params
let modified = code;
if (!modified.includes('Bass2Params')) {
    modified = modified.replace("DrumSound, PartSequence, MultisampleBank", "DrumSound, PartSequence, MultisampleBank, Bass2Params");
}

fs.writeFileSync('src/hooks/useAudioEngine.ts', modified);
