const fs = require('fs');
let lines = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8').split('\n');

let attackOffsetLine = lines.findIndex(l => l.includes('const attackOffset = noteParams?.harmonyAttack'));
if (attackOffsetLine !== -1) {
    lines.splice(attackOffsetLine, 1);
}

let playSamplerIdx = lines.findIndex(l => l.includes('            // Main playSampler function with harmonizer support'));

for (let i = playSamplerIdx; i < playSamplerIdx + 50; i++) {
    if (lines[i].includes('                        setTimeout(() => {')) {
        let insertIdx = i;
        lines.splice(insertIdx, 0,
            '                        const attackOffset = noteParams?.harmonyAttack ? noteParams.harmonyAttack * voice.index * 0.05 : 0;'
        );
        break;
    }
}

fs.writeFileSync('src/hooks/useAudioEngine.ts', lines.join('\n'), 'utf8');
