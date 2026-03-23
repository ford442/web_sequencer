const fs = require('fs');

const code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

// Replace the missing imports for Open303Manager
let modified = code;
if (!modified.includes('import { Open303Manager }')) {
    modified = modified.replace("import { Open303Oscillator } from '../engines/Open303Oscillator';", "import { Open303Oscillator } from '../engines/Open303Oscillator';\nimport { Open303Manager } from '../engines/Open303Manager';");
}

fs.writeFileSync('src/hooks/useAudioEngine.ts', modified);
