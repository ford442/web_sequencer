const fs = require('fs');

let useStepHandlerCode = fs.readFileSync('src/hooks/useStepHandler.ts', 'utf8');

useStepHandlerCode = useStepHandlerCode.replace(/    samplerVoiceParamsRef: React\.MutableRefObject<\{/g, `    samplerVoiceParamsRef: React.MutableRefObject<{
        drive: number;`);

useStepHandlerCode = useStepHandlerCode.replace(/                rootNote: voiceParams\.rootNote,/g, `                drive: voiceParams.drive,
                rootNote: voiceParams.rootNote,`);

fs.writeFileSync('src/hooks/useStepHandler.ts', useStepHandlerCode);
