const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

const regex1 = /const filter = context\.createBiquadFilter\(\);\n\s*filter\.type = 'lowpass';\n\s*const cutoff = noteParams\?\.filterCutoff !== undefined\n\s*\? Math\.max\(20, noteParams\.filterCutoff \* 20000\)\n\s*: params\.filterCutoff;\n\s*filter\.frequency\.value = cutoff;\n\n\s*const resonance = noteParams\?\.filterResonance !== undefined\n\s*\? noteParams\.filterResonance \* 20\n\s*: params\.filterResonance;\n\s*filter\.Q\.value = resonance;/;

code = code.replace(regex1, `// --- ACQUIRE VoiceFXStrip ---
                    const fxStrip = fxStripPoolRef.current.pop() || new VoiceFXStrip(context);

                    const cutoff = noteParams?.filterCutoff !== undefined ? Math.max(20, noteParams.filterCutoff * 20000) : params.filterCutoff;
                    const resonance = noteParams?.filterResonance !== undefined ? noteParams.filterResonance * 20 : params.filterResonance;
                    fxStrip.updateFilter(cutoff, resonance, startTime);`);

const regex2 = /source\.connect\(filter\);\n\s*filter\.connect\(shaper\);\n\s*shaper\.connect\(gain\);\n\s*gain\.connect\(finalDestination\);/;

code = code.replace(regex2, `source.connect(shaper);
                    shaper.connect(gain);
                    gain.connect(fxStrip.input);
                    fxStrip.output.connect(finalDestination);

                    const spectralPanDepth = noteParams?.spectralPanDepth !== undefined ? noteParams.spectralPanDepth : (params as any).spectralPanDepth;
                    const spectralPanRate = noteParams?.spectralPanRate !== undefined ? noteParams.spectralPanRate : (params as any).spectralPanRate;
                    const spectralPanLfoRate = (spectralPanRate || 1) * (tempo / 60);

                    fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, startTime);

                    const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                    const currentReverbType = (noteParams as any)?.reverbType || reverbTypeRef.current;
                    const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];

                    fxStrip.updateReverbSend(reverbSendAmount, 0.1, 0, 6000, startTime);
                    fxStrip.connectReverb(targetReverbNode || null);

                    const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);
                    fxStrip.updateDelaySend(delaySendAmount, startTime);
                    fxStrip.connectDelay(delayNodeRef.current);

                    source.onended = () => {
                        try { fxStrip.output.disconnect(); } catch (e) {}
                        fxStrip.connectReverb(null);
                        fxStrip.connectDelay(null);
                        fxStripPoolRef.current.push(fxStrip);
                    };`);


fs.writeFileSync('src/hooks/useAudioEngine.ts', code);
