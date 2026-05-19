const fs = require('fs');
const file = 'src/audio-worklets/vocal-overdrive-processor.ts';
let code = fs.readFileSync(file, 'utf-8');

// Ensure sampleRate is declared for typescript
if (!code.includes('declare const sampleRate')) {
    code = code.replace(
        /declare function registerProcessor\(name: string, processorCtor: new \(\) => AudioWorkletProcessor\): void;/,
        `declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void;\ndeclare const sampleRate: number;`
    );
    fs.writeFileSync(file, code);
}
