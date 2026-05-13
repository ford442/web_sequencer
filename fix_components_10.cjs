const fs = require('fs');

let noteSelectorCode = fs.readFileSync('src/components/NoteSelector.tsx', 'utf8');

noteSelectorCode = noteSelectorCode.replace(/    currentGateRate\?: number;    onPropertyChange/g, `    currentGateRate?: number;
    onPropertyChange`);

fs.writeFileSync('src/components/NoteSelector.tsx', noteSelectorCode);
