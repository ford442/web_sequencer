const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

// I am trying to figure out why pnpm lint is complaining about `try` expected at the end.
const errorLine = 2038; // in useAudioEngine.ts
const lines = code.split('\n');
console.log(lines.slice(errorLine - 10, errorLine + 10).join('\n'));
