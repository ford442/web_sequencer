const fs = require('fs');
const code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

const playSamplerVoice1 = code.indexOf("const playSamplerVoice =");
const playSamplerVoice2 = code.indexOf("const playSamplerVoice =", playSamplerVoice1 + 1);

const playBufferSource = code.indexOf("const playBufferSource =");
const playBufferSource2 = code.indexOf("const playBufferSource =", playBufferSource + 1);

console.log('playSamplerVoice1:', playSamplerVoice1);
console.log('playSamplerVoice2:', playSamplerVoice2);
console.log('playBufferSource:', playBufferSource);
console.log('playBufferSource2:', playBufferSource2);
