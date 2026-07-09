const fs = require('fs');

function fix() {
    let content = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');
    content = content.replace(
        `spectralResynthesis?: number\n                },`,
        `spectralResynthesis?: number,\n                    vocoderFormantShift?: number,\n                    vocoderPreservation?: number,\n                    vocoderAttack?: number,\n                    vocoderRelease?: number\n                },`
    );
    fs.writeFileSync('src/hooks/useAudioEngine.ts', content);
}
fix();
