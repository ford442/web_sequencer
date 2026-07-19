import re

with open("src/hooks/useAudioEngine.ts", "r") as f:
    content = f.read()

# Make the edits for harmonizer config cleanly using string replacement
search_str = """
                        // Create modified params for this harmony voice
                        const voiceParams: SamplerBankParams = {
                            ...params,
                            pan: voice.pan,
                            volume: params.volume * voice.gain * 0.85,
                            formantShift: (params.formantShift || 0) + voice.formantShift,
                            fineTune: (params.fineTune || 0) + voice.detuneCents
                        };
"""

replace_str = """
                        // Create modified params for this harmony voice
                        const config = harmonizer.getConfig();
                        const voiceParams: SamplerBankParams = {
                            ...params,
                            pan: Math.max(-1, Math.min(1, (params.pan || 0) + (voice.pan || 0))),
                            volume: params.volume * voice.gain * 0.85,
                            formantShift: (params.formantShift || 0) + voice.formantShift,
                            fineTune: (params.fineTune || 0) + voice.detuneCents
                        };
                        if (config.harmonyAttack !== undefined) {
                            voiceParams.attack = config.harmonyAttack;
                        }
                        if (config.harmonyRelease !== undefined) {
                            voiceParams.release = config.harmonyRelease;
                        }
"""

if search_str in content:
    content = content.replace(search_str, replace_str)

search_str2 = """
                        // Play this voice with pitch offset and slight delay for natural ensemble effect
                        const delayMs = voice.index * 5;
                        setTimeout(() => {
                            playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, undefined, voice.pitchOffset, tuning);
                        }, delayMs);
"""

replace_str2 = """
                        // Play this voice with pitch offset and slight delay for natural ensemble effect
                        const delayMs = voice.index * 5;
                        setTimeout(() => {
                            playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, undefined, voice.pitchOffset, tuning);
                        }, delayMs);
"""

if search_str2 in content:
    content = content.replace(search_str2, replace_str2)

with open("src/hooks/useAudioEngine.ts", "w") as f:
    f.write(content)
