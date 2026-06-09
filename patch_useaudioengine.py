import sys

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. Import AudioNodePool
    if "import { AudioNodePool } from '../utils/AudioNodePool';" not in content:
        content = content.replace("import { Engine303Manager } from '../engines/Engine303Manager';",
                                  "import { Engine303Manager } from '../engines/Engine303Manager';\nimport { AudioNodePool } from '../utils/AudioNodePool';")

    # 2. Add refs for the pools
    if "const expressiveVoicePoolRef = useRef<AudioNodePool | null>(null);" not in content:
        content = content.replace("const vocalAlignmentsRef = useRef<Map<string, AlignmentResult>>(new Map());",
                                  "const vocalAlignmentsRef = useRef<Map<string, AlignmentResult>>(new Map());\n    const expressiveVoicePoolRef = useRef<AudioNodePool | null>(null);\n    const vocalOverdrivePoolRef = useRef<AudioNodePool | null>(null);\n    const expressiveVoiceProcessorPoolRef = useRef<AudioNodePool | null>(null);")

    # 3. Initialize pools in initializeAudio
    if "expressiveVoiceProcessorPoolRef.current = new AudioNodePool" not in content:
        init_block = """
            await context.audioWorklet.addModule('/audio-worklets/expressive-voice-processor.js');

            expressiveVoiceProcessorPoolRef.current = new AudioNodePool(context, 'expressive-voice-processor');
"""
        content = content.replace("await context.audioWorklet.addModule('/audio-worklets/expressive-voice-processor.js');", init_block)

        content = content.replace("await context.audioWorklet.addModule('/audio-worklets/expressive-voice.js');", "await context.audioWorklet.addModule('/audio-worklets/expressive-voice.js');\n            expressiveVoicePoolRef.current = new AudioNodePool(context, 'expressive-voice');")
        content = content.replace("await context.audioWorklet.addModule('/audio-worklets/vocal-overdrive-processor.js');", "await context.audioWorklet.addModule('/audio-worklets/vocal-overdrive-processor.js');\n            vocalOverdrivePoolRef.current = new AudioNodePool(context, 'vocal-overdrive-processor');")

    # 4. Replace AudioWorkletNode creations

    # 4.1. Track overdrive and expressive Node in noteOnSampler
    content = content.replace("let finalShaperDest: AudioNode | null = null;", "let finalShaperDest: AudioNode | null = null;\n                    let overdriveNodeRef: AudioWorkletNode | null = null;")

    content = content.replace("""const overdriveNode = new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                parameterData: {
                                    drive: driveAmount
                                }
                            });""", """const overdriveNode = overdriveNodeRef = vocalOverdrivePoolRef.current?.acquire({ drive: driveAmount }) || new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                parameterData: { drive: driveAmount }
                            });""")

    content = content.replace("""const expressiveNode = new AudioWorkletNode(context, 'expressive-voice-processor', {
                                parameterData: { pitchShift: pitchOffsetSemitones }
                            });""", """const expressiveNode = expressiveVoiceProcessorPoolRef.current?.acquire({ pitchShift: pitchOffsetSemitones }) || new AudioWorkletNode(context, 'expressive-voice-processor', {
                                parameterData: { pitchShift: pitchOffsetSemitones }
                            });""")

    content = content.replace("""expressiveNode = new AudioWorkletNode(context, 'expressive-voice', {
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
                        });""", """expressiveNode = expressiveVoicePoolRef.current?.acquire({
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
                            });""")

    content = content.replace("""expressiveNode = new AudioWorkletNode(context, 'expressive-voice', {
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
                    });""", """expressiveNode = expressiveVoicePoolRef.current?.acquire({
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
                        });""")

    # 5. Fix noteOnSampler node release
    content = content.replace("setTimeout(() => { if (expressiveNode) { expressiveNode.port.postMessage({ type: 'TEARDOWN' }); } }, releaseMs);", "setTimeout(() => { if (expressiveNode) { expressiveNode.port.postMessage({ type: 'TEARDOWN' }); expressiveVoicePoolRef.current?.release(expressiveNode); } if (overdriveNodeRef) { vocalOverdrivePoolRef.current?.release(overdriveNodeRef); } }, releaseMs);")

    # 6. Track expressive and overdrive node in triggerVoice
    content = content.replace("let expressiveVoiceNode: AudioWorkletNode | null = null;", "let expressiveVoiceNode: AudioWorkletNode | null = null;\n                            let overdriveNodeRef: AudioWorkletNode | null = null;")

    content = content.replace("""const node = new AudioWorkletNode(context, 'expressive-voice-processor', {
                                            parameterData: { pitchShift: pitchOffsetSemitones }
                                        });""", """const node = expressiveVoiceProcessorPoolRef.current?.acquire({ pitchShift: pitchOffsetSemitones }) || new AudioWorkletNode(context, 'expressive-voice-processor', {
                                            parameterData: { pitchShift: pitchOffsetSemitones }
                                        });""")

    content = content.replace("""const overdriveNode = new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                        parameterData: {
                                            drive: driveAmount
                                        }
                                    });""", """const overdriveNode = overdriveNodeRef = vocalOverdrivePoolRef.current?.acquire({ drive: driveAmount }) || new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                        parameterData: { drive: driveAmount }
                                    });""")

    # 7. Release in runVoices
    content = content.replace("""setTimeout(() => {
                                    voice.noteOff();
                                    expressiveVoiceNode?.port.postMessage({ type: 'TEARDOWN' });
                                }, delayMs);""", """setTimeout(() => {
                                    voice.noteOff();
                                    if (expressiveVoiceNode) {
                                        expressiveVoiceNode.port.postMessage({ type: 'TEARDOWN' });
                                        expressiveVoiceProcessorPoolRef.current?.release(expressiveVoiceNode);
                                    }
                                    if (overdriveNodeRef) {
                                        vocalOverdrivePoolRef.current?.release(overdriveNodeRef);
                                    }
                                }, delayMs);""")

    content = content.replace("""} else {
                                voice.noteOff();
                                expressiveVoiceNode?.port.postMessage({ type: 'TEARDOWN' });
                            }""", """} else {
                                voice.noteOff();
                                if (expressiveVoiceNode) {
                                    expressiveVoiceNode.port.postMessage({ type: 'TEARDOWN' });
                                    expressiveVoiceProcessorPoolRef.current?.release(expressiveVoiceNode);
                                }
                                if (overdriveNodeRef) {
                                    vocalOverdrivePoolRef.current?.release(overdriveNodeRef);
                                }
                            }""")

    content = content.replace("""expressiveNode.port.postMessage({ type: 'TEARDOWN' });
                            });""", """expressiveNode.port.postMessage({ type: 'TEARDOWN' });
                                expressiveVoiceProcessorPoolRef.current?.release(expressiveNode);
                            });""")

    with open(filepath, 'w') as f:
        f.write(content)

patch_file('src/hooks/useAudioEngine.ts')
