const fs = require('fs');

// Looks like the legacy section wasn't replaced properly. The legacy filter and reverb weren't replaced.
// I will just use string replacement on the exact code from `orig.ts`!

let useAudioEngine = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

const filterOrig2 = `                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    fxStrip.filterNode.frequency.value = pFilterCutoff;
                    fxStrip.filterNode.Q.value = pFilterResonance;`;

const filterNew2 = `                    let fxStrip: any = fxStripPoolRef.current.pop() || new (VoiceFXStrip as any)(context);
                    fxStrip.updateFilter(pFilterCutoff, pFilterResonance, startTime);

                    let spectralPanDepth = (noteParams as any)?.spectralPanDepth !== undefined ? (noteParams as any).spectralPanDepth : (params as any).spectralPanDepth;
                    let spectralPanRate = (noteParams as any)?.spectralPanRate !== undefined ? (noteParams as any).spectralPanRate : (params as any).spectralPanRate;
                    let spectralPanLfoRate = (spectralPanRate || 1) * (tempo / 60);

                    fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, startTime);

                    const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                    const currentReverbType = (noteParams as any)?.reverbType || reverbTypeRef.current;
                    const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];

                    fxStrip.updateReverbSend(reverbSendAmount, 0.1, 0, 6000, startTime);
                    fxStrip.connectReverb(targetReverbNode || null);

                    const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);
                    fxStrip.updateDelaySend(delaySendAmount, startTime);
                    fxStrip.connectDelay(delayNodeRef.current);`;

useAudioEngine = useAudioEngine.replace(filterOrig2, filterNew2);

useAudioEngine = useAudioEngine.replace(/source\.connect\(filter\);/g, 'source.connect(fxStrip.input);');
useAudioEngine = useAudioEngine.replace(/filter\.connect\(finalShaperDest\);/g, 'fxStrip.output.connect(finalShaperDest);');
useAudioEngine = useAudioEngine.replace(/filter\.connect\(gain\);/g, 'fxStrip.output.connect(gain);');

let idx3 = useAudioEngine.indexOf('if (reverbSendAmount > 0 && targetReverbNode) {');
let idx4 = useAudioEngine.indexOf('if (startFormantShift !== undefined && (noteParams?.slideFromMidi !== undefined || noteParams?.slideFromFormant !== undefined)) {');
if (idx3 !== -1 && idx4 !== -1 && idx4 > idx3) {
    let replacedBlock = useAudioEngine.substring(idx3, idx4);
    let o = (replacedBlock.match(/\{/g) || []).length;
    let c = (replacedBlock.match(/\}/g) || []).length;
    let dummy = "/* { */".repeat(o) + "/* } */".repeat(c);

    if (replacedBlock.includes('gain.connect(delayGain);')) {
        useAudioEngine = useAudioEngine.substring(0, idx3) + "// Reverb, Delay and Spectral panning handled by VoiceFXStrip\n" + dummy + "\n                    " + useAudioEngine.substring(idx4);
    }
}

fs.writeFileSync('src/hooks/useAudioEngine.ts', useAudioEngine);
