const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAudioEngine.ts.orig', 'utf8');

// 1. Imports
code = code.replace(
    "import { VoiceManager } from '../engines/VoiceManager';",
    "import { VoiceManager } from '../engines/VoiceManager';\nimport { VoiceFXStrip } from '../engines/audio-fx/VoiceFXStrip';"
);

// 2. fxStripPoolRef
code = code.replace(
    "    const vocoderPoolRef = useRef<AudioNodePool | null>(null);",
    "    const vocoderPoolRef = useRef<AudioNodePool | null>(null);\n    const fxStripPoolRef = useRef<VoiceFXStrip[]>([]);"
);

// 3. Pool initialization
code = code.replace(
    "            isAudioInitialized.current = true;",
    "            isAudioInitialized.current = true;\n\n            const POOL_SIZE = 32;\n            for (let i = 0; i < POOL_SIZE; i++) {\n                fxStripPoolRef.current.push(new VoiceFXStrip(context));\n            }"
);

fs.writeFileSync('src/hooks/useAudioEngine.ts', code);
