import re

with open('src/hooks/useAudioEngine.ts', 'r') as f:
    content = f.read()


search = """                    let expressiveNode: AudioWorkletNode | null = null;
                    try {
                        expressiveNode = expressiveVoicePoolRef.current?.acquire({
                                vibratoRate: expressiveConfig.vibratoRate,
                                vibratoDepth: expressiveConfig.vibratoDepth,
                                tremoloRate: params.tremoloRate ?? 5.0,
                                tremoloDepth: expressiveConfig.tremoloDepth,
                                breathAmount: expressiveConfig.breathAmount,
                                attack: params.attack ?? 0,
                                decay: params.decay ?? 0,
                                sustain: params.sustain ?? 1,
                                release: params.release ?? 0.1,
                                gate: 1,
                            }) || new AudioWorkletNode(context, 'expressive-voice', {
                                numberOfInputs: 1,
                                numberOfOutputs: 1,
                                outputChannelCount: [1],
                                parameterData: {
                                    vibratoRate: expressiveConfig.vibratoRate,
                                    vibratoDepth: expressiveConfig.vibratoDepth,
                                    tremoloRate: params.tremoloRate ?? 5.0,
                                    tremoloDepth: expressiveConfig.tremoloDepth,
                                    breathAmount: expressiveConfig.breathAmount,
                                    attack: params.attack ?? 0,
                                    decay: params.decay ?? 0,
                                    sustain: params.sustain ?? 1,
                                    release: params.release ?? 0.1,
                                    gate: 1,
                                }
                            });
                        expressiveNode.connect(finalDestination);
                        finalDestination = expressiveNode;
                    } catch (_err) {
                        expressiveNode = null;
                    }"""

replace = """"""

if search in content:
    content = content.replace(search, replace)
else:
    print("search not found")


search2 = """                let expressiveNode: AudioWorkletNode | null = null;
                try {
                    expressiveNode = expressiveVoicePoolRef.current?.acquire({
                            vibratoRate: expressiveConfig.vibratoRate,
                            vibratoDepth: expressiveConfig.vibratoDepth,
                            tremoloRate: params.tremoloRate ?? 5.0,
                            tremoloDepth: expressiveConfig.tremoloDepth,
                            breathAmount: expressiveConfig.breathAmount,
                            attack: params.attack ?? 0,
                            decay: params.decay ?? 0,
                            sustain: params.sustain ?? 1,
                            release: params.release ?? 0.1,
                            gate: 1,
                        }) || new AudioWorkletNode(context, 'expressive-voice', {
                            numberOfInputs: 1,
                            numberOfOutputs: 1,
                            outputChannelCount: [1],
                            parameterData: {
                                vibratoRate: expressiveConfig.vibratoRate,
                                vibratoDepth: expressiveConfig.vibratoDepth,
                                tremoloRate: params.tremoloRate ?? 5.0,
                                tremoloDepth: expressiveConfig.tremoloDepth,
                                breathAmount: expressiveConfig.breathAmount,
                                attack: params.attack ?? 0,
                                decay: params.decay ?? 0,
                                sustain: params.sustain ?? 1,
                                release: params.release ?? 0.1,
                                gate: 1,
                            }
                        });
                } catch (_err) {
                    expressiveNode = null;
                }

                if (expressiveNode) {
                    source.connect(expressiveNode);
                    expressiveNode.connect(gain);
                } else {
                    source.connect(gain);
                }"""


replace2 = """                source.connect(gain);"""

if search2 in content:
    content = content.replace(search2, replace2)
else:
    print("search2 not found")


with open('src/hooks/useAudioEngine.ts', 'w') as f:
    f.write(content)
