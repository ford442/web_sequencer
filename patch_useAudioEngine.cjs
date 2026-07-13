const fs = require('fs');
let lines = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8').split('\n');

let noteParamsStart = lines.findIndex(l => l.includes('                noteParams?: { '));
if (noteParamsStart !== -1) {
    lines.splice(noteParamsStart + 1, 0,
        '                    vocoderFormantShift?: number;',
        '                    vocoderPreservation?: number;',
        '                    vocoderAttack?: number;',
        '                    vocoderRelease?: number;',
        '                    harmonyAttack?: number;',
        '                    harmonyRelease?: number;'
    );
}

fs.writeFileSync('src/hooks/useAudioEngine.ts', lines.join('\n'), 'utf8');
