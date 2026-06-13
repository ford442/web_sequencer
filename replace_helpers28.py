import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()

search = """                            if (noteParams?.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(noteParams.vibratoDepth, triggerTime);
                            } else {
                                // SingingVoice setters use legacy percentage depth (0-100).
                                voice.setVibratoDepth(expressiveConfig.vibratoDepth * 100, triggerTime);
                            }
                            voice.setVibratoRate(expressiveConfig.vibratoRate, triggerTime);

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (noteParams.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (params.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            }
                            // SingingVoice setters use legacy percentage depth (0-100).
                            voice.setTremoloDepth(expressiveConfig.tremoloDepth * 100, triggerTime);
                            if (params.tremoloRate !== undefined) voice.setTremoloRate(params.tremoloRate, triggerTime);

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                voice.setGateRate(noteParams.gateRate, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                voice.setGateRate(params.gateRate, triggerTime);
                            }

                            if (noteParams?.breathIntensity !== undefined) {
                                voice.setBreathIntensity(noteParams.breathIntensity, triggerTime);
                            } else {
                                voice.setBreathIntensity(expressiveConfig.breathAmount, triggerTime);
                            }"""

replace = """                            if (noteParams?.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(noteParams.vibratoDepth, triggerTime);
                            }
                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (noteParams.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (params.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            }

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                voice.setGateRate(noteParams.gateRate, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                voice.setGateRate(params.gateRate, triggerTime);
                            }"""


if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")

with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
