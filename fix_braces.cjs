const fs = require('fs');
let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');
const lines = code.split('\n');
lines.splice(2874, 1, '        };');
fs.writeFileSync('src/hooks/useAudioEngine.ts', lines.join('\n'));
