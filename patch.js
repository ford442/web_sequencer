const fs = require('fs');
const file = 'src/hooks/useAudioEngine.ts';
let code = fs.readFileSync(file, 'utf-8');

code = code.replace(
    /const overdriveNode = new AudioWorkletNode\(context, 'vocal-overdrive-processor', \{\n\s*parameterData: \{\n\s*drive: driveAmount\n\s*\}\n\s*\}\);/g,
    `const overdriveNode = new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                        parameterData: {
                                            drive: driveAmount,
                                            crossoverFrequency: 1000
                                        }
                                    });`
);

fs.writeFileSync(file, code);
