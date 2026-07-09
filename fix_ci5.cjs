const fs = require('fs');

function fix() {
    let content = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');
    content = content.replace(
        `export interface SynthNoteParams {`,
        `export interface SynthNoteParams {\n    vocoderFormantShift?: number;\n    vocoderPreservation?: number;\n    vocoderAttack?: number;\n    vocoderRelease?: number;`
    );
    fs.writeFileSync('src/hooks/useAudioEngine.ts', content);
}
fix();
