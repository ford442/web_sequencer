const fs = require('fs');
const path = 'src/hooks/useAudioEngine.ts';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('const fxStripPoolRef = useRef<VoiceFXStrip[]>')) {
    // find where other refs are declared
    code = code.replace('const playbackRefs = useRef<PlaybackRefs>', 'const fxStripPoolRef = useRef<VoiceFXStrip[]>([]);\n    const playbackRefs = useRef<PlaybackRefs>');
    fs.writeFileSync(path, code);
}
console.log('Done');
