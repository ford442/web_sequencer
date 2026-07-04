const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

const legacyRegex = /const filter = context\.createBiquadFilter\(\);\n\s*filter\.type = 'lowpass';\n\s*filter\.frequency\.value = pFilterCutoff;\n\s*filter\.Q\.value = pFilterResonance;\n\n\s*let finalShaperDest: AudioNode \| null = null;/;

code = code.replace(legacyRegex, `// --- ACQUIRE VoiceFXStrip ---
                    const fxStrip = fxStripPoolRef.current.pop() || new VoiceFXStrip(context);
                    fxStrip.updateFilter(pFilterCutoff, pFilterResonance, startTime);

                    let finalShaperDest: AudioNode | null = null;`);

const legacyRegex2 = /let spectralFinalDest = finalDestination;\n\s*let wetGain: GainNode \| null = null;\n\s*if \(spectralPanDepth !== undefined && spectralPanDepth > 0\) \{[\s\S]*?try \{ highLfo\.stop\(\); \} catch\(e\)\{\}\n\s*\}\);\n\s*\}/;

code = code.replace(legacyRegex2, `fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, startTime);
                    fxStrip.output.connect(finalDestination);`);

const legacyRegex3 = /source\.connect\(filter\);\n\s*if \(finalShaperDest\) \{\n\s*filter\.connect\(finalShaperDest\);\n\s*finalShaperDest\.connect\(gain\);\n\s*\} else \{\n\s*filter\.connect\(gain\);\n\s*\}\n\n\s*if \(wetGain\) \{\n\s*gain\.connect\(spectralFinalDest\);\n\s*gain\.connect\(wetGain\);\n\s*\} else \{\n\s*gain\.connect\(spectralFinalDest\);\n\s*\}/;

code = code.replace(legacyRegex3, `if (finalShaperDest) {
                        source.connect(finalShaperDest);
                        finalShaperDest.connect(gain);
                    } else {
                        source.connect(gain);
                    }
                    gain.connect(fxStrip.input);

                    fxStrip.updateReverbSend(reverbSendAmount, revLfoRate, revLfoDepth, reverbEqCutoff, startTime);
                    fxStrip.connectReverb(targetReverbNode || null);

                    fxStrip.updateDelaySend(delaySendAmount, startTime);
                    fxStrip.connectDelay(delayNodeRef.current);

                    source.addEventListener('ended', () => {
                        try { fxStrip.output.disconnect(); } catch (e) {}
                        fxStrip.connectReverb(null);
                        fxStrip.connectDelay(null);
                        fxStripPoolRef.current.push(fxStrip);
                    });`);

fs.writeFileSync('src/hooks/useAudioEngine.ts', code);
