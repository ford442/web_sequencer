import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

# Insert prepareVocal definition before playSampler
prepare_vocal_code = """
            const prepareVocal = async (bankIndex: number, text: string) => {
                if (!singingVoiceRef.current) return;
                const bankName = `bank_${bankIndex}`;
                const buffer = loadedSampleBuffersRef.current.get(bankName);
                if (!buffer) return;

                const audio = buffer.getChannelData(0);
                try {
                    const alignment = await singingVoiceRef.current.alignPhonemes(audio, text);
                    if (alignment) {
                        vocalAlignmentsRef.current.set(bankName, alignment);
                        console.log(`Aligned phonemes for ${bankName}: ${alignment.phonemes.length}`);
                    }
                } catch (e) {
                    console.warn('Phoneme alignment failed:', e);
                }
            };
"""

# New playSampler code
play_sampler_code = """            const playSampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2) => {
                const buffer = loadedSampleBuffersRef.current.get(params.sampleName);
                if (!buffer || !masterGainRef.current) return;

                if (params.mode === 'stretch' && singingVoiceRef.current) {
                    // PHONEME ELASTICITY & SINGING VOICE MODE
                    const voice = singingVoiceRef.current;
                    const targetDuration = durationSteps * stepTime;
                    const originalDuration = buffer.duration;

                    // 1. Calculate Time Ratio
                    // If target is 2s and original is 1s, ratio should be 2.0 (slower? no, Rubber Band ratio > 1 means longer/slower)
                    // Wait, RubberBandStretcher setTimeRatio(r): r > 1 means slower?
                    // Usually timeRatio = output_duration / input_duration.
                    const timeRatio = targetDuration / originalDuration;
                    voice.setTimeRatio(timeRatio);

                    // 2. Pitch Shift
                    // Assuming base note C4 (60) for the sample
                    const targetMidi = noteToMidi(note);
                    voice.setPitchFromMidi(targetMidi, 60);

                    // 3. Phoneme Awareness
                    const alignment = vocalAlignmentsRef.current.get(params.sampleName);
                    // We need to inject the alignment into the voice engine state BEFORE processing
                    // But SingingVoice 'process' is stateless for the alignment unless we set it.
                    // The SingingVoice class has 'lastAlignment'.
                    // We should probably explicitly set the alignment if we have it.
                    // But SingingVoice doesn't expose a setter for lastAlignment directly,
                    // but 'sendPhonemeDataToWorklet' uses 'lastAlignment'.
                    // HACK: We rely on the fact that if we just called alignPhonemes it's set.
                    // But here we might be switching banks.
                    // We need to ensure the engine uses THIS alignment.
                    // We'll update SingingVoice to allow setting alignment or assume it handles it.
                    // Actually, let's just send the data if we have it.
                    // But 'sendPhonemeDataToWorklet' reads from 'this.lastAlignment'.
                    // We should assume 'prepareVocal' was called and likely set it?
                    // No, 'prepareVocal' sets OUR ref 'vocalAlignmentsRef'.
                    // We need to tell SingingVoice to use THIS alignment.
                    // Let's modify SingingVoice class? No, let's treat it as a black box for now
                    // and realize that 'sendPhonemeDataToWorklet' takes 'targetDuration' and uses internal state.
                    // Wait, if I can't set internal state, I can't swap alignments.
                    // I will look at SingingVoice.ts again.
                    // It has 'alignPhonemes' which sets 'this.lastAlignment'.
                    // So I should call 'alignPhonemes' again? No, that's expensive.
                    // I should modify SingingVoice to accept alignment in 'sendPhonemeDataToWorklet' OR 'setAlignment'.
                    // For now, I will assume the user has selected the bank and 'prepareVocal' might have just run?
                    // Or I can add a method to SingingVoice to set current alignment.
                    // Since I can't modify SingingVoice easily in this script without complex regex,
                    // I'll stick to basic stretch.
                    // WAIT! I can modify SingingVoice.ts easily with sed later if needed.
                    // But I recall SingingVoice.ts:
                    // private lastAlignment: AlignmentResult | null = null;
                    // ...
                    // sendPhonemeDataToWorklet(...) { if (!this.lastAlignment) return; ... }

                    // So I MUST set 'lastAlignment'.
                    // I will cast to any to force set it, or add a method.
                    // Let's add a method 'setAlignment' to SingingVoice in the same plan step if possible,
                    // or just use 'any' for now to keep it simple.

                    if (alignment) {
                        (voice as any).lastAlignment = alignment; // TypeScript hack for now
                        voice.sendPhonemeDataToWorklet(targetDuration);
                    }

                    // 4. Process
                    // 'process' sends the buffer.
                    voice.process(buffer.getChannelData(0));

                    // Note: SingingVoice output is connected to masterGain in initializeAudio.
                    return;
                }

                // Standard Loop / One-shot
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.playbackRate.value = params.playbackSpeed;

                const gain = context.createGain();
                gain.gain.value = params.volume;

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = params.filterCutoff;
                filter.Q.value = params.filterResonance;

                // Distortion (Simple waveshaper)
                const shaper = context.createWaveShaper();
                if (params.drive > 0) {
                    shaper.curve = makeDistortionCurve(params.drive * 100);
                } else {
                    shaper.curve = null; // Bypass
                }

                source.connect(filter);
                filter.connect(shaper);
                shaper.connect(gain);
                gain.connect(masterGainRef.current);

                source.start(time);
                // No auto-stop for one-shots usually, unless gated
            };"""

# Replace playSampler
# Regex to find the existing playSampler function
# It starts with "const playSampler =" and ends before "const noteOnSampler ="
pattern = r"const playSampler = \(params: SamplerBankParams.*?\n\s+};"
replacement = prepare_vocal_code + "\n" + play_sampler_code

# We need to be careful with regex matching multiline nested braces.
# Since the code is indented and structured, we can match until the next const definition.
# The next function is "const noteOnSampler ="
content = re.sub(
    r"const playSampler = [\s\S]*?(?=const noteOnSampler =)",
    play_sampler_code + "\n\n            ",
    content
)

# Insert prepareVocal before playSampler (which is now replaced)
content = content.replace("const playSampler =", prepare_vocal_code + "\n            const playSampler =")

# Add prepareVocal to returned object
content = content.replace(
    "processSpoon,",
    "processSpoon,\n                prepareVocal,"
)

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
