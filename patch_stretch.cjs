const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

// 4. Stretch mode routing refactor
const stretchRegex = /const filter = context\.createBiquadFilter\(\);\n\s*filter\.type = 'lowpass';\n\n\s*const cutoff = noteParams\?\.filterCutoff !== undefined\n\s*\? Math\.max\(20, noteParams\.filterCutoff \* 20000\)\n\s*: \(params\.filterCutoff \?\? 20000\);\n\s*filter\.frequency\.value = cutoff;\n\n\s*const resonance = noteParams\?\.filterResonance !== undefined\n\s*\? noteParams\.filterResonance \* 20\n\s*: \(params\.filterResonance \?\? 0\);\n\s*filter\.Q\.value = resonance;\n\n\s*filter\.connect\(finalDest\);\n\s*finalDest = filter;/;

code = code.replace(stretchRegex, `// --- ACQUIRE VoiceFXStrip ---
                                const fxStrip = fxStripPoolRef.current.pop() || new VoiceFXStrip(context);

                                const cutoff = noteParams?.filterCutoff !== undefined ? Math.max(20, noteParams.filterCutoff * 20000) : (params.filterCutoff ?? 20000);
                                const resonance = noteParams?.filterResonance !== undefined ? noteParams.filterResonance * 20 : (params.filterResonance ?? 0);
                                fxStrip.updateFilter(cutoff, resonance, triggerTime);

                                fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, triggerTime);
                                fxStrip.updateReverbSend(reverbSendAmount, revLfoRate, revLfoDepth, reverbEqCutoff, triggerTime);
                                fxStrip.connectReverb(targetReverbNode || null);
                                fxStrip.updateDelaySend(delaySendAmount, triggerTime);
                                fxStrip.connectDelay(delayNodeRef.current);`);

// 5. Stretch mode routing connect
const stretchRoutingRegex = /let spectralFinalDest = finalDest;\n\s*let wetGain: GainNode \| null = null;\n\s*\/\/ Apply Spectral Panning\n\s*if \(spectralPanDepth !== undefined && spectralPanDepth > 0\) \{[\s\S]*?setTimeout\(stopOscillators, targetDuration \* 1000 \+ 100\);\n\s*\} else \{\n\s*if \(finalDest\) voice\.connectOutput\(finalDest\);\n\s*\}/;

code = code.replace(stretchRoutingRegex, `fxStrip.output.connect(finalDest);
                            voice.connectOutput(fxStrip.input);`);

// 6. Stretch Mode Reverb/Delay teardown
const stretchTeardownRegex = /\/\/ Setup Reverb Send \(Formant-Aware\)[\s\S]*?\/\/ Setup Delay Send\n\s*if \(delaySendAmount > 0 && delayNodeRef\.current\) \{[\s\S]*?voice\.connectOutput\(delayGain\);\n\s*\}/;

code = code.replace(stretchTeardownRegex, `// Reverb, Delay and Spectral panning handled by VoiceFXStrip`);

const noteOffRegex1 = /setTimeout\(\(\) => \{\n\s*voice\.noteOff\(\);\n\s*\}, delayMs\);/g;

code = code.replace(noteOffRegex1, `setTimeout(() => {
                                    voice.noteOff();

                                    try { fxStrip.output.disconnect(); } catch (e) {}
                                    fxStrip.connectReverb(null);
                                    fxStrip.connectDelay(null);
                                    fxStripPoolRef.current.push(fxStrip);
                                }, delayMs);`);

const noteOffRegex2 = /\} else \{\n\s*voice\.noteOff\(\);\n\s*\}/g;

code = code.replace(noteOffRegex2, `} else {
                                voice.noteOff();
                                try { fxStrip.output.disconnect(); } catch (e) {}
                                fxStrip.connectReverb(null);
                                fxStrip.connectDelay(null);
                                fxStripPoolRef.current.push(fxStrip);
                            }`);

fs.writeFileSync('src/hooks/useAudioEngine.ts', code);
