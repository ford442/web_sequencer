const fs = require('fs');

function fix() {
    let content = fs.readFileSync('src/hooks/audioEngine/audioPlayback.ts', 'utf8');
    if (!content.includes('vocoderFormantShift')) {
        content = content.replace(
            `export interface SynthNoteParams {`,
            `export interface SynthNoteParams {\n    vocoderFormantShift?: number;\n    vocoderPreservation?: number;\n    vocoderAttack?: number;\n    vocoderRelease?: number;`
        );
        fs.writeFileSync('src/hooks/audioEngine/audioPlayback.ts', content);
    }
}
fix();
