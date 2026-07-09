const fs = require('fs');

function fix() {
    let content = fs.readFileSync('src/types.ts', 'utf8');
    if (!content.includes('interface SamplerNoteParams extends')) {
        return; // we don't know where to insert
    }
}
fix();
