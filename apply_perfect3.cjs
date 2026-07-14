const fs = require('fs');
let code = fs.readFileSync('src/hooks/useAudioEngine.ts', 'utf8');

// The original file is exactly `474ead0` which is known good.
// I will apply the VoiceFXStrip optimization using carefully constructed String.replace.

// 1. Add fxStripPoolRef
let vIdx = code.indexOf('const vocoderPoolRef = useRef<AudioNodePool | null>(null);');
if (vIdx !== -1) {
    code = code.substring(0, vIdx) + "const vocoderPoolRef = useRef<AudioNodePool | null>(null);\n    const fxStripPoolRef = useRef<any[]>([]);" + code.substring(vIdx + 'const vocoderPoolRef = useRef<AudioNodePool | null>(null);'.length);
}

// 2. PlaySamplerVoice VoiceFXStrip inside "Stretch Mode"
const filterOrig1 = `                            // Apply Per-Step Filter if present, or fallback to global filter settings
                            if (noteParams?.filterCutoff !== undefined || noteParams?.filterResonance !== undefined || params.filterCutoff !== undefined || params.filterResonance !== undefined) {
                                const filter = context.createBiquadFilter();
                                filter.type = 'lowpass';

                                const cutoff = noteParams?.filterCutoff !== undefined
                                    ? Math.max(20, noteParams.filterCutoff * 20000)
                                    : (params.filterCutoff ?? 20000);
                                filter.frequency.value = cutoff;

                                const resonance = noteParams?.filterResonance !== undefined
                                    ? noteParams.filterResonance * 20
                                    : (params.filterResonance ?? 0);
                                filter.Q.value = resonance;

                                filter.connect(finalDest);
                                finalDest = filter;
                            }`;

const filterNew1 = `                            let fxStrip: any = null;
                            // Apply Per-Step Filter if present, or fallback to global filter settings
                            if (noteParams?.filterCutoff !== undefined || noteParams?.filterResonance !== undefined || params.filterCutoff !== undefined || params.filterResonance !== undefined) {
                                fxStrip = fxStripPoolRef.current.pop() || new (VoiceFXStrip as any)(context);
                                const cutoff = noteParams?.filterCutoff !== undefined ? Math.max(20, noteParams.filterCutoff * 20000) : ((params.filterCutoff as any) ?? 20000);
                                const resonance = noteParams?.filterResonance !== undefined ? noteParams.filterResonance * 20 : (params.filterResonance ?? 0);
                                fxStrip.updateFilter(cutoff, resonance, triggerTime);

                                const spectralPanDepth = (noteParams as any)?.spectralPanDepth !== undefined ? (noteParams as any).spectralPanDepth : (params as any).spectralPanDepth;
                                const spectralPanRate = (noteParams as any)?.spectralPanRate !== undefined ? (noteParams as any).spectralPanRate : (params as any).spectralPanRate;
                                const spectralPanLfoRate = (spectralPanRate || 1) * (tempo / 60);

                                fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, triggerTime);

                                const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                                const currentReverbType = (noteParams as any)?.reverbType || reverbTypeRef.current;
                                const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];

                                fxStrip.updateReverbSend(reverbSendAmount, 0.1, 0, 6000, triggerTime);
                                fxStrip.connectReverb(targetReverbNode || null);

                                const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);
                                fxStrip.updateDelaySend(delaySendAmount, triggerTime);
                                fxStrip.connectDelay(delayNodeRef.current);

                                fxStrip.output.connect(finalDest);
                                voice.connectOutput(fxStrip.input);
                            }`;

code = code.replace(filterOrig1, filterNew1);

// 3. Remove Stretch Reverb/Delay
let idx1 = code.indexOf('// Setup Reverb Send (Formant-Aware)');
let idx2 = code.indexOf('// Apply Timbre Modulation (Formant Shift)');
if (idx1 !== -1 && idx2 !== -1) {
    let replacedBlock = code.substring(idx1, idx2);
    if (replacedBlock.includes('voice.connectOutput(delayGain);')) {
        let dummy = "{\n".repeat(4) + "}\n".repeat(4);
        code = code.substring(0, idx1) + "// Reverb, Delay and Spectral panning handled by VoiceFXStrip\n" + dummy + "\n                            " + code.substring(idx2);
    }
}

// 4. Teardown stretch
const tdOrig1 = `                                voice.noteOff();
                                if (expressiveVoiceNode) {`;
const tdNew1 = `                                voice.noteOff();
                                if (typeof fxStrip !== 'undefined' && fxStrip) {
                                    try { fxStrip.output.disconnect(); } catch (e) {}
                                    fxStrip.connectReverb(null);
                                    fxStrip.connectDelay(null);
                                    fxStripPoolRef.current.push(fxStrip);
                                }
                                if (expressiveVoiceNode) {`;
code = code.replaceAll(tdOrig1, tdNew1);

const tdOrig2 = `                                    voice.noteOff();
                                    if (expressiveVoiceNode) {`;
const tdNew2 = `                                    voice.noteOff();
                                    if (typeof fxStrip !== 'undefined' && fxStrip) {
                                        try { fxStrip.output.disconnect(); } catch (e) {}
                                        fxStrip.connectReverb(null);
                                        fxStrip.connectDelay(null);
                                        fxStripPoolRef.current.push(fxStrip);
                                    }
                                    if (expressiveVoiceNode) {`;
code = code.replaceAll(tdOrig2, tdNew2);

// 5. Legacy Filter
const filterOrig2 = `                    // 1) Apply per-step or global lowpass filter
                    if (noteParams?.filterCutoff !== undefined || noteParams?.filterResonance !== undefined || params.filterCutoff !== undefined || params.filterResonance !== undefined) {
                        const filter = context.createBiquadFilter();
                        filter.type = 'lowpass';
                        const cutoff = noteParams?.filterCutoff !== undefined
                            ? Math.max(20, noteParams.filterCutoff * 20000)
                            : (params.filterCutoff ?? 20000);
                        filter.frequency.value = cutoff;
                        const resonance = noteParams?.filterResonance !== undefined
                            ? noteParams.filterResonance * 20
                            : (params.filterResonance ?? 0);
                        filter.Q.value = resonance;
                        filter.connect(finalDestination);
                        finalDestination = filter;
                    }`;
const filterNew2 = `                    let fxStrip: any = null;
                    // 1) Apply per-step or global lowpass filter
                    if (noteParams?.filterCutoff !== undefined || noteParams?.filterResonance !== undefined || params.filterCutoff !== undefined || params.filterResonance !== undefined) {
                        fxStrip = fxStripPoolRef.current.pop() || new (VoiceFXStrip as any)(context);
                        const cutoff = noteParams?.filterCutoff !== undefined ? Math.max(20, noteParams.filterCutoff * 20000) : ((params.filterCutoff as any) ?? 20000);
                        const resonance = noteParams?.filterResonance !== undefined ? noteParams.filterResonance * 20 : (params.filterResonance ?? 0);
                        fxStrip.updateFilter(cutoff, resonance, time);

                        const spectralPanDepth = (noteParams as any)?.spectralPanDepth !== undefined ? (noteParams as any).spectralPanDepth : (params as any).spectralPanDepth;
                        const spectralPanRate = (noteParams as any)?.spectralPanRate !== undefined ? (noteParams as any).spectralPanRate : (params as any).spectralPanRate;
                        const spectralPanLfoRate = (spectralPanRate || 1) * (tempo / 60);

                        fxStrip.updateSpectralPanning(spectralPanDepth || 0, spectralPanLfoRate, time);

                        const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                        const currentReverbType = (noteParams as any)?.reverbType || reverbTypeRef.current;
                        const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];

                        fxStrip.updateReverbSend(reverbSendAmount, 0.1, 0, 6000, time);
                        fxStrip.connectReverb(targetReverbNode || null);

                        const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);
                        fxStrip.updateDelaySend(delaySendAmount, time);
                        fxStrip.connectDelay(delayNodeRef.current);

                        fxStrip.output.connect(finalDestination);
                        finalDestination = fxStrip.input;
                    }`;
code = code.replace(filterOrig2, filterNew2);

// 6. Remove Legacy Reverb
let idx3 = code.indexOf('if (reverbSendAmount > 0 && targetReverbNode) {');
let idx4 = code.indexOf('if (params.pan !== undefined && params.pan !== 0) {'); // next block in legacy mode
if (idx3 !== -1 && idx4 !== -1 && idx4 > idx3) {
    let replacedBlock = code.substring(idx3, idx4);
    let dummy = "{\n".repeat(4) + "}\n".repeat(4);
    if (replacedBlock.includes('gain.connect(delayGain);')) {
        code = code.substring(0, idx3) + "// Reverb, Delay and Spectral panning handled by VoiceFXStrip\n" + dummy + "\n                    " + code.substring(idx4);
    }
}

// 7. Legacy Teardown
const legacyTeardownOrig = `                    note.source.stop(now + 0.1);
                    activeSamplerNotes.current.delete(id);`;
const legacyTeardownNew = `                    note.source.stop(now + ((note as any).releaseTime || 0.1));
                    activeSamplerNotes.current.delete(id);
                    if ((note as any).fxStrip) {
                        try { (note as any).fxStrip.output.disconnect(); } catch (e) {}
                        (note as any).fxStrip.connectReverb(null);
                        (note as any).fxStrip.connectDelay(null);
                        fxStripPoolRef.current.push((note as any).fxStrip);
                    }`;
code = code.replace(legacyTeardownOrig, legacyTeardownNew);

// 8. Legacy Note Map
const legacyNoteMapOrig = `activeSamplerNotes.current.set(id, { source, envGain: gain });`;
const legacyNoteMapNew = `activeSamplerNotes.current.set(id, { source, envGain: gain, releaseTime: params.release ?? 0.1, fxStrip: typeof fxStrip !== 'undefined' ? fxStrip : null } as any);`;
code = code.replace(legacyNoteMapOrig, legacyNoteMapNew);

// 9. Fix Types
code = code.replaceAll('filter.frequency', 'fxStrip.filterNode.frequency');
code = code.replaceAll('filter.Q', 'fxStrip.filterNode.Q');

if (!code.includes("VoiceFXStrip")) {
    code = "import { VoiceFXStrip } from '../engines/audio-fx/VoiceFXStrip';\n" + code;
}

fs.writeFileSync('src/hooks/useAudioEngine.ts', code);
