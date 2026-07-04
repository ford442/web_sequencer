const fs = require('fs');
let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

// The original file is available in `useAudioEngine.ts.orig`
let origCode = fs.readFileSync('src/hooks/useAudioEngine.ts.orig', 'utf8');

console.log(code.substring(code.length - 2000, code.length));
