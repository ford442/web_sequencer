const fs = require('fs');
const code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');
const lines = code.split('\n');

let duplicateStart = -1;
let duplicateEnd = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const playBufferSource =') && i > 1500) {
        duplicateStart = i;
    }
    if (lines[i].includes('// Main playSampler function with harmonizer support') && duplicateStart > -1) {
        duplicateEnd = i;
        break;
    }
}
if (duplicateStart > -1 && duplicateEnd > -1) {
    console.log('deleting duplicate buffer logic lines', duplicateStart, duplicateEnd);
    lines.splice(duplicateStart, duplicateEnd - duplicateStart, '            };');
    fs.writeFileSync('src/hooks/useAudioEngine.ts', lines.join('\n'));
}
